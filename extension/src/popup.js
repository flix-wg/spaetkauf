'use strict';
(async () => {
  const config = await chrome.storage.sync.get({ enabled: true, server: 'https://65-108-33-75.sslip.io' });
  const toggle = document.getElementById('enabled');
  toggle.checked = config.enabled;
  toggle.addEventListener('change', () => chrome.storage.sync.set({ enabled: toggle.checked }));
  document.getElementById('server').textContent = 'Kurt server: ' + config.server;
  chrome.runtime.sendMessage({ type: 'health' }).then(health => {
    document.getElementById('health').textContent = health.ok ? `Reachable · history up to ${health.dateTo || 'an unknown date'}` : 'Unreachable: no odds until the server is back';
  }).catch(() => { document.getElementById('health').textContent = 'Unreachable: no odds until the server is back'; });
  const query = new URLSearchParams(location.search).get('tab');
  const tabs = query === null ? await chrome.tabs.query({ active: true, currentWindow: true }) : [];
  const tabId = query === null ? tabs[0]?.id : Number(query);
  const key = 'tab:' + tabId;
  function display(status) {
    if (!status) return;
    document.getElementById('tab').textContent = `${status.count} connections on this page, ${status.ldCount} long-distance`;
    document.getElementById('checked').textContent = status.at ? 'Checked at ' + new Date(status.at).toLocaleTimeString() : '';
    document.getElementById('path').textContent = status.path ? 'Read by: ' + status.path : '';
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
