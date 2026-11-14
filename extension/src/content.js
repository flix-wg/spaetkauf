(function () {
  'use strict';
  let enabled = true;
  let timer;
  let pendingSince = null;
  let generation = 0;
  let lastKey = null;
  let lastResponse = null;
  let rendered = new Set();
  // async: once the extension is reloaded, sendMessage throws instead of rejecting.
  const send = async message => chrome.runtime.sendMessage(message);
  // After a reload or update the old script stays on the page with no extension behind it.
  const alive = () => Boolean(chrome.runtime?.id);
  function stop() {
    enabled = false;
    clearTimeout(timer);
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
    const words = [ctx.from, ctx.to].filter(Boolean).flatMap(name => name.split(/[^\p{L}]+/u)).filter(word => word.length >= 3);
    const saved = await chrome.storage.local.get({ specs: {}, failures: {} });
    let hash = null;
    let skeleton;
    let cards;
    let path = 'none';
    if (Object.keys(saved.specs).length) {
      skeleton = SpkSkeleton.build(document.body, { words });
      hash = await SpkSkeleton.hash(skeleton);
      if (saved.specs[hash]) {
        cards = SpkParse.applySpec(document, saved.specs[hash]);
        if (cards?.length) path = 'adapted';
      }
    }
    if (!cards?.length) {
      const parsed = SpkParse.parseCards(document);
      cards = parsed.cards;
      if (cards.length) path = 'heuristic';
      else if (parsed.looksLikeResults) {
        skeleton ??= SpkSkeleton.build(document.body, { words });
        hash ??= await SpkSkeleton.hash(skeleton);
        if (!(saved.failures[hash] > Date.now())) {
          const response = await send({ type: 'adapt', skeleton, hash });
          if (response.spec) {
            cards = SpkParse.applySpec(document, response.spec) || [];
            if (cards.length) path = 'adapted';
          }
        }
      }
    }
    cards = SpkParse.assignDates(cards || [], ctx.date);
    if (!enabled || token !== generation) return;
    const status = { path, count: cards.length, ldCount: cards.filter(c => c.ldTrains.length).length, to: ctx.to, date: cards[0]?.date || ctx.date, hash, sample: cards.slice(0, 3).map(({ dep, arr, trains }) => ({ dep, arr, trains })), error: null };
    const selected = cards.filter(c => c.ldTrains.length).slice(0, 30);
    const current = new Set(selected.map(c => c.el));
    for (const old of rendered) if (!current.has(old)) SpkOverlay.clear(old);
    rendered = current;
    if (!cards.length || !selected.length) { lastKey = null; lastResponse = null; await report(status); return; }
    if (!ctx.to) {
      for (const el of rendered) SpkOverlay.clear(el);
      status.error = 'No destination found on this page';
      await report(status);
      return;
    }
    const date = cards[0]?.date || ctx.date;
    const body = { from: ctx.from, to: ctx.to, to_eva: ctx.toEva, date, connections: selected.map(c => ({ dep: c.dep, arr: c.arr, trains: c.trains, ...(c.date && c.date !== date ? { date: c.date } : {}) })) };
    const config = await chrome.storage.sync.get({ server: 'https://65-108-33-75.sslip.io' });
    const key = JSON.stringify([config.server, body]);
    if (key !== lastKey) {
      const response = await send({ type: 'odds', body });
      if (!enabled || token !== generation) return;
      lastResponse = response;
      lastKey = key;
    }
    if (lastResponse?.ok) {
      for (const result of lastResponse.data.results) {
        const card = selected[result.i];
        if (card) SpkOverlay.render(card, result, { link: lastResponse.data.link, server: config.server });
      }
    } else {
      for (const el of rendered) SpkOverlay.clear(el);
      status.error = lastResponse?.error || 'Odds unavailable';
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
    if (changes.enabled || changes.server) {
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
