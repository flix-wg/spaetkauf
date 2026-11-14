'use strict';
const DEFAULT_SERVER = 'https://65-108-33-75.sslip.io';
const oddsCache = new Map();
const pending = new Map();
let specWrite = Promise.resolve();
async function settings() {
  return chrome.storage.sync.get({ enabled: true, server: DEFAULT_SERVER });
}
function serverURL(value) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/\.+$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /(^|\.)(bahn\.de|db\.de|bahn\.com|deutschebahn\.com)$/i.test(hostname)) throw new Error('Invalid Kurt server URL');
  return url.origin;
}
function nextBerlinMidnight(now = Date.now()) {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const parts = time => Object.fromEntries(format.formatToParts(time).map(p => [p.type, p.value]));
  const today = parts(now);
  const target = Date.UTC(+today.year, +today.month - 1, +today.day + 1);
  let midnight = target;
  for (let i = 0; i < 2; i++) {
    const local = parts(midnight);
    const offset = Date.UTC(+local.year, +local.month - 1, +local.day, +local.hour, +local.minute, +local.second) - midnight;
    midnight = target - offset;
  }
  return midnight;
}
async function request(server, path, body, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(server + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal, credentials: 'omit', redirect: 'error'
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? { ok: true, status: response.status, data } : { ok: false, status: response.status, error: typeof data.detail === 'string' ? data.detail : `Server returned ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, error: error.name === 'AbortError' ? 'Server request timed out' : 'Server unreachable' };
  } finally { clearTimeout(timer); }
}
async function handle(message, sender) {
  if (message.type === 'status') {
    if (sender.tab?.id !== undefined) {
      await chrome.storage.session.set({ ['tab:' + sender.tab.id]: message.status });
      await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#FD4F00' });
      await chrome.action.setBadgeText({ tabId: sender.tab.id, text: message.status.count ? String(message.status.count) : '' });
    }
    return { ok: true };
  }
  const config = await settings();
  const server = serverURL(config.server);
  if (message.type === 'health') {
    const response = await request(server, '/api/health', undefined, 5000);
    return { ok: response.ok && response.data?.ok !== false, version: response.data?.version, adapter: response.data?.sources?.adapter ?? response.data?.adapter, error: response.error };
  }
  if (!config.enabled) return { ok: false, status: 0, error: 'Extension disabled' };
  if (message.type === 'odds') {
    const key = JSON.stringify([server, message.body]);
    const cached = oddsCache.get(key);
    if (cached && cached.until > Date.now()) return cached.response;
    if (pending.has(key)) return pending.get(key);
    const work = request(server, '/api/ext/odds', message.body).then(response => {
      if (response.ok) {
        oddsCache.delete(key);
        oddsCache.set(key, { until: Date.now() + 600000, response });
        while (oddsCache.size > 100) oddsCache.delete(oddsCache.keys().next().value);
      }
      return response;
    }).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }
  if (message.type === 'adapt') {
    const { failures = {}, specs = {} } = await chrome.storage.local.get(['failures', 'specs']);
    if (specs[message.hash]) return { ok: true, status: 200, spec: specs[message.hash] };
    if (failures[message.hash] > Date.now()) return { ok: false, status: 422, error: 'Layout adaptation unavailable today' };
    const response = await request(server, '/api/ext/adapt', { skeleton: message.skeleton, hash: message.hash }, 60000);
    specWrite = specWrite.catch(() => {}).then(async () => {
      const saved = await chrome.storage.local.get({ specs: {}, failures: {} });
      if (response.ok && response.data.spec) {
        delete saved.specs[message.hash];
        saved.specs[message.hash] = response.data.spec;
        const entries = Object.entries(saved.specs).slice(-20);
        await chrome.storage.local.set({ specs: Object.fromEntries(entries) });
      } else if ([422, 429, 503].includes(response.status)) {
        saved.failures = Object.fromEntries(Object.entries(saved.failures).filter(([, until]) => until > Date.now()));
        saved.failures[message.hash] = nextBerlinMidnight();
        await chrome.storage.local.set({ failures: saved.failures });
      }
    });
    await specWrite;
    return response.ok ? { ok: true, status: response.status, spec: response.data.spec } : response;
  }
  return { ok: false, status: 0, error: 'Unknown message' };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(respond, error => respond({ ok: false, status: 0, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove('tab:' + tabId); });
