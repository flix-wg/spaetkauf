'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.SpkParse = require('../src/parse.js');
const { text, render, clear } = require('../src/overlay.js');
const { JSDOM } = require('jsdom');
const result = { p20: 0.41, late: 14, n: 34, weekday: 'Saturday', basis: 'history', kurt: false };
const card = { trains: ['ICE 599'] };
test('odds text, Kurt, changes and missing history', () => {
  assert.deepEqual(text(result, card), { line: '41 % chance of 20+ min late', kurt: false, detail: 'Late 14 of 34 Saturdays.' });
  assert.equal(text({ ...result, kurt: true }, card).line, 'Kurt’s pick: 41 % chance of 20+ min late');
  assert.equal(text({ ...result, p20: 0.416, basis: 'last_train', train: 'ICE 599' }, card).line, '42 % chance ICE 599 is 20+ min late');
  assert.deepEqual(text({ ...result, basis: 'estimate', train: 'ICE 599' }, card), { line: '41 % chance of 20+ min late', kurt: false, detail: 'Counts a missed change. ICE 599 alone: late 14 of 34 Saturdays.' });
  assert.equal(text({ ...result, p20: null, basis: 'none', train: 'ICE 599' }, card).line, 'Not enough history for odds');
  assert.deepEqual(text({ ...result, kurt: true }, { ...card, posted: true }), { line: 'Already posted: does not count', kurt: false, detail: null });
  for (const s of ['Verspätung aus vorheriger Fahrt', 'Zug fällt aus', 'Halt entfällt', 'Delayed by 12 min']) assert.ok(globalThis.SpkParse.posted(s), s);
  for (const s of ['Es liegen Meldungen vor.', 'Sitzplätze ausgebucht (1. Klasse)', 'Hohe Auslastung erwartet']) assert.ok(!globalThis.SpkParse.posted(s), s);
  assert.equal(text({ ...result, p20: NaN }, { trains: ['ICE 599', 'RE 4'] }).line, 'No odds: ends on a regional train');
});
test('closed badge stays outside interactive controls and clears after removal', () => {
  const dom = new JSDOM('<article><button><span>Train</span></button><button>Weiter</button></article>');
  const doc = dom.window.document;
  const card = { el: doc.querySelector('article'), core: doc.querySelector('span') };
  let clicks = 0;
  card.el.addEventListener('click', () => clicks++);
  const host = render(card, result, { server: 'https://example.test', link: '/' });
  assert.equal(host.previousElementSibling, doc.querySelector('button'));
  assert.equal(host.shadowRoot, null);
  host.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(clicks, 0);
  const stray = host.cloneNode(true);
  card.el.append(stray);
  render(card, result, { server: 'https://example.test', link: '/' });
  assert.equal(stray.isConnected, false);
  assert.equal(doc.querySelectorAll('spk-badge').length, 1);
  card.el.remove();
  clear(doc);
  assert.equal(card.el.querySelector('spk-badge'), null);
});
test('content retries failed odds on its own and caches success', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const dom = new JSDOM('<body><li>10:00 12:00 ICE 1 Delay</li></body>', { url: 'https://example.test/#zo=Munich&hd=2026-11-14T10:00' });
  let scheduled, changed, calls = 0, renders = 0;
  const messages = [];
  const context = {
    document: dom.window.document, location: dom.window.location,
    SpkParse: globalThis.SpkParse,
    SpkOverlay: { clear() {}, render() { renders++; } },
    MutationObserver: class { constructor(callback) { changed = callback; } observe() {} disconnect() {} },
    setTimeout(callback) { scheduled = callback; }, clearTimeout() {},
    addEventListener() {}, removeEventListener() {},
    chrome: {
      runtime: { id: 'test', async sendMessage(message) {
        messages.push(message);
        if (message.type === 'odds') return ++calls === 1 ? { ok: false, error: 'outage' } : { ok: true, data: { results: [{ i: 0 }], link: '/' } };
        return {};
      } },
      storage: { local: { async get(defaults) { return defaults; } }, sync: { async get(defaults) { return defaults; } }, onChanged: { addListener() {} } }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/content.js'), 'utf8'), context);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush(); scheduled(); await flush();
  assert.equal(calls, 1); assert.equal(renders, 0);
  assert.equal(messages.find(m => m.type === 'odds').body.connections[0].posted, true);
  scheduled(); // the retry timer, with no page change
  scheduled(); await flush();
  assert.equal(calls, 2); assert.equal(renders, 1);
  changed([{ target: context.document.body, addedNodes: [], removedNodes: [] }]);
  scheduled(); await flush();
  assert.equal(calls, 2); assert.equal(renders, 2);
});
