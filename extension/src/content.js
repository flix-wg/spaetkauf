(function () {
  'use strict';
  const msg = (key, fallback, ...values) => globalThis.chrome?.i18n?.getMessage(key, values.map(String)) || fallback.replace(/\$(\d+)/g, (_, n) => String(values[Number(n) - 1] ?? ''));

  let enabled = true;
  let timer;
  let retry;
  let pendingSince = null;
  let generation = 0;
  let lastKey = null;
  let lastResponse = null;
  let lastURL = location.href;
  const navigation = setInterval(() => {
    if (!alive()) return stop();
    if (location.href !== lastURL) { lastURL = location.href; for (const el of rendered) SpkOverlay.clear(el); schedule(); }
  }, 500);
  let rendered = new Set();
  // async: once the extension is reloaded, sendMessage throws instead of rejecting.
  const send = async message => chrome.runtime.sendMessage(message);
  // After a reload or update the old script stays on the page with no extension behind it.
  const alive = () => Boolean(chrome.runtime?.id);
  function stop() {
    enabled = false;
    clearTimeout(timer);
    clearTimeout(retry);
    clearInterval(navigation);
    observer.disconnect();
    removeEventListener('hashchange', schedule);
  }
  function schedule() {
    if (!alive()) return stop();
    generation++;
    clearTimeout(timer);
    if (enabled) {
      pendingSince ??= Date.now();
      timer = setTimeout(() => {
        pendingSince = null;
        run(generation).catch(error => alive() ? report({ path: 'none', count: 0, ldCount: 0, error: error.message }) : stop());
      }, Math.max(0, Math.min(400, pendingSince + 2000 - Date.now())));
    }
  }
  function report(status) {
    return send({ type: 'status', status: { ...status, at: new Date().toISOString() } }).catch(() => {});
  }
  async function run(token) {
    const ctx = SpkParse.pageContext(location, document);
    const cards = SpkParse.assignDates(SpkParse.parseCards(document).cards, ctx.date);
    if (!enabled || token !== generation) return;
    const status = { path: cards.length ? 'heuristic' : 'none', count: cards.length, ldCount: cards.filter(c => c.ldTrains.length).length, to: ctx.to, date: cards[0]?.date || ctx.date, sample: cards.slice(0, 3).map(({ dep, arr, trains }) => ({ dep, arr, trains })), error: null };
    const selected = cards.filter(c => c.ldTrains.length).slice(0, 30);
    const current = new Set(selected.map(c => c.el));
    for (const old of rendered) if (!current.has(old)) SpkOverlay.clear(old);
    rendered = current;
    if (!cards.length || !selected.length) { lastKey = null; lastResponse = null; await report(status); return; }
    if (!ctx.to) {
      for (const el of rendered) SpkOverlay.clear(el);
      status.error = msg("noDestination", "No destination found on this page");
      await report(status);
      return;
    }
    const date = cards[0]?.date || ctx.date;
    const config = await chrome.storage.sync.get({ server: 'https://kurtfaehrt.de', showOnTime: false });
    if (!enabled || token !== generation) return;
    const body = { from: ctx.from, to: ctx.to, to_eva: ctx.toEva, date, connections: selected.map(c => ({ dep: c.dep, arr: c.arr, trains: c.trains, posted: c.posted, ...(c.date && c.date !== date ? { date: c.date } : {}) })), ...(config.showOnTime === true ? { on_time: true } : {}) };
    const key = JSON.stringify([config.server, body]);
    if (key !== lastKey) {
      const response = await send({ type: 'odds', body });
      if (!enabled || token !== generation) return;
      lastResponse = response;
      lastKey = response?.ok ? key : null;
    }
    if (lastResponse?.ok) {
      for (const result of lastResponse.data.results) {
        const card = selected[result.i];
        if (card) SpkOverlay.render(card, result, { link: lastResponse.data.link, server: lastResponse.server || config.server });
      }
    } else {
      for (const el of rendered) SpkOverlay.clear(el);
      status.error = lastResponse?.error || msg("oddsUnavailable", "Odds unavailable");
      // A settled page fires no mutation that would run again, so retry on a timer.
      clearTimeout(retry);
      retry = setTimeout(schedule, 15000);
    }
    await report(status);
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => {
      if (record.target.closest?.('spk-badge')) return false;
      const nodes = [...record.addedNodes, ...record.removedNodes];
      return !nodes.length || nodes.some(node => node.nodeType !== 1 || node.localName !== 'spk-badge');
    })) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  addEventListener('hashchange', schedule);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
    if (changes.enabled || changes.server || changes.showOnTime) {
      generation++;
      lastKey = null;
      lastResponse = null;
      if (!enabled) {
        clearTimeout(timer);
        pendingSince = null;
        SpkOverlay.clear(document);
        rendered.clear();
        report({ path: 'none', count: 0, ldCount: 0, error: null });
      } else schedule();
    }
  });
  chrome.storage.sync.get({ enabled: true }).then(config => { enabled = config.enabled; schedule(); });
})();
