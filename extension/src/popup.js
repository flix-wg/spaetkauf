'use strict';
  const msg = (key, fallback, ...values) => globalThis.chrome?.i18n?.getMessage(key, values.map(String)) || fallback.replace(/\$(\d+)/g, (_, n) => String(values[Number(n) - 1] ?? ''));
document.documentElement.lang = globalThis.chrome?.i18n?.getUILanguage?.()?.startsWith('de') ? 'de' : 'en';
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = msg(element.dataset.i18n, element.textContent);

(async () => {
  const config = await chrome.storage.sync.get({ enabled: true, server: 'https://kurt-34y.pages.dev' });
  const toggle = document.getElementById('enabled');
  toggle.checked = config.enabled;
  toggle.addEventListener('change', () => chrome.storage.sync.set({ enabled: toggle.checked }));
  document.getElementById('server').textContent = msg("server", "Kurt server: $1", config.server);
  chrome.runtime.sendMessage({ type: 'health' }).then(health => {
    document.getElementById('health').textContent = health.ok ? msg('reachable', 'Reachable · history up to $1', health.dateTo || msg('dateUnknown', 'an unknown date')) : msg("unreachable", "Unreachable: no odds until the server is back");
  }).catch(() => { document.getElementById('health').textContent = msg("unreachable", "Unreachable: no odds until the server is back"); });
  const query = new URLSearchParams(location.search).get('tab');
  const tabs = query === null ? await chrome.tabs.query({ active: true, currentWindow: true }) : [];
  const tabId = query === null ? tabs[0]?.id : Number(query);
  const key = 'tab:' + tabId;
  function display(status) {
    if (!status) return;
    document.getElementById('tab').textContent = msg("connections", "$1 connections on this page, $2 long-distance", status.count, status.ldCount);
    document.getElementById('checked').textContent = status.at ? msg("checked", "Checked at $1", new Date(status.at).toLocaleTimeString(document.documentElement.lang === 'de' ? 'de-DE' : 'en-GB')) : '';
    document.getElementById('path').textContent = status.path ? msg("readBy", "Read by: $1", msg('path' + status.path[0].toUpperCase() + status.path.slice(1), status.path)) : '';
    document.getElementById('error').textContent = status.error || '';
    const sample = document.getElementById('sample');
    sample.replaceChildren();
    for (const card of status.sample || []) {
      const item = document.createElement('li');
      item.textContent = `${card.dep}–${card.arr} ${card.trains.join(', ')}`;
      sample.append(item);
    }
  }
  display((await chrome.storage.session.get(key))[key]);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[key]) display(changes[key].newValue);
  });
})().catch(error => { document.getElementById('error').textContent = error.message; });
