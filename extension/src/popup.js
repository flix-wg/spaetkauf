'use strict';
(async () => {
  const config = await chrome.storage.sync.get({ enabled: true, server: 'https://65-108-33-75.sslip.io' });
  const toggle = document.getElementById('enabled');
  toggle.checked = config.enabled;
  toggle.addEventListener('change', () => chrome.storage.sync.set({ enabled: toggle.checked }));
  document.getElementById('server').textContent = config.server;
  chrome.runtime.sendMessage({ type: 'health' }).then(health => {
    const adapter = health.adapter === true || health.adapter?.configured === true || health.adapter === 'configured';
    document.getElementById('health').textContent = health.ok ? `Reachable · ${health.version || 'version unknown'} · adapter ${adapter ? 'configured' : 'missing'}` : 'Unreachable';
  }).catch(() => { document.getElementById('health').textContent = 'Unreachable'; });
  const query = new URLSearchParams(location.search).get('tab');
  const tabs = query === null ? await chrome.tabs.query({ active: true, currentWindow: true }) : [];
  const tabId = query === null ? tabs[0]?.id : Number(query);
  const key = 'tab:' + tabId;
  function display(status) {
    if (!status) return;
    document.getElementById('tab').textContent = `${status.count} connections (${status.ldCount} long-distance) · parser: ${status.path}`;
    document.getElementById('checked').textContent = status.at ? 'Last check: ' + new Date(status.at).toLocaleTimeString() : '';
    document.getElementById('hash').textContent = status.hash ? 'Layout: ' + status.hash.slice(0, 8) : '';
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
