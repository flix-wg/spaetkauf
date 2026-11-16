'use strict';
importScripts('../dist/odds.js');
const msg = (key, fallback, ...values) => globalThis.chrome?.i18n?.getMessage(key, values.map(String)) || fallback.replace(/\$(\d+)/g, (_, n) => String(values[Number(n) - 1] ?? ''));

const DEFAULT_SERVER = 'https://kurt-34y.pages.dev';
const oddsCache = new Map();
const pending = new Map();
const sources = new Map();
let budget;
let transitous;
// Extension requests carry no useful Referer, so Transitous asks for a User-Agent instead.
const userAgent = chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'User-Agent', operation: 'set', value: `kurt-extension/${chrome.runtime.getManifest().version} (+https://github.com/flix-wg/spaetkauf)` }] },
    condition: { requestDomains: ['api.transitous.org'], initiatorDomains: [chrome.runtime.id], tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ['xmlhttprequest'] }
  }]
});
async function settings() {
  const config = await chrome.storage.sync.get({ enabled: true, server: DEFAULT_SERVER });
  if (config.server === 'https://65-108-33-75.sslip.io') {
    config.server = DEFAULT_SERVER;
    await chrome.storage.sync.set({ server: DEFAULT_SERVER });
  }
  return config;
}
function serverURL(value) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/\.+$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /(^|\.)(bahn\.de|db\.de|bahn\.com|deutschebahn\.com)$/i.test(hostname)) throw new Error(msg("invalidServer", "Invalid Kurt server URL"));
  return url.origin;
}
function oddsSource(server) {
  if (!sources.has(server)) sources.set(server, KurtOdds.httpOddsSource(server + '/data', { credentials: 'omit', redirect: 'error' }, 8000));
  return sources.get(server);
}
// The daily /plan cap needs to outlive the service worker, but the Transitous client reads it synchronously.
function planBudget() {
  return budget ??= chrome.storage.local.get({ planBudget: {} }).then(saved => {
    const values = new Map(Object.entries(saved.planBudget));
    const save = () => chrome.storage.local.set({ planBudget: Object.fromEntries(values) });
    return {
      get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: key => values.get(key) ?? null,
      setItem(key, value) { values.set(key, String(value)); save(); }, removeItem(key) { values.delete(key); save(); }
    };
  });
}
async function route() {
  await userAgent;
  return transitous ??= KurtOdds.createTransitous({ storage: await planBudget(), cacheStorage: null });
}
function within(work, ms, message) {
  let timer;
  return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
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
    try {
      const index = await within(oddsSource(server).index(), 5000, msg("timeout", "Server request timed out"));
      return { ok: true, dateTo: index.meta?.date_to };
    } catch (error) { return { ok: false, error: error.message }; }
  }
  if (!config.enabled) return { ok: false, status: 0, error: msg("disabled", "Extension disabled") };
  if (message.type === 'odds') {
    const key = JSON.stringify([server, message.body]);
    const cached = oddsCache.get(key);
    if (cached && cached.until > Date.now()) return cached.response;
    if (pending.has(key)) return pending.get(key);
    const source = oddsSource(server);
    const work = (async () => {
      const data = await within(KurtOdds.extensionOdds(message.body, { odds: source, tr: await route() }), 8000, msg("timeout", "Server request timed out"));
      // Odds degrade to "none" when files are missing; an unreachable server is an error the page retries.
      await source.index().catch(() => { throw new Error(msg("serverUnreachable", "Server unreachable")); });
      const response = { ok: true, status: 200, data };
      oddsCache.delete(key);
      oddsCache.set(key, { until: Date.now() + 600000, response });
      while (oddsCache.size > 100) oddsCache.delete(oddsCache.keys().next().value);
      return response;
    })().catch(error => ({ ok: false, status: 0, error: error.message })).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }
  return { ok: false, status: 0, error: 'Unknown message' };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(respond, error => respond({ ok: false, status: 0, error: error.message }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => { chrome.storage.local.remove(['specs', 'failures']); settings(); });
chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove('tab:' + tabId); });
