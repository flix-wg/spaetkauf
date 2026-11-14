'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { text, render, clear } = require('../src/overlay.js');
const { JSDOM } = require('jsdom');
const result = { p20: 0.41, late: 14, n: 34, weekday: 'Saturday', basis: 'history', kurt: false };
test('odds text, Kurt, changes and missing history', () => {
  assert.deepEqual(text(result), { line: '41 % ≥ +20 (late 14 of 34 Saturdays)', kurt: false });
  assert.equal(text({ ...result, kurt: true }).line, 'Kurt: 41 % ≥ +20 (late 14 of 34 Saturdays)');
  assert.equal(text({ ...result, p20: 0.416, basis: 'last_train' }).line, '42 % ≥ +20 (late 14 of 34 Saturdays) · last train only, changes not counted');
  assert.equal(text({ ...result, p20: null, basis: 'none', train: 'ICE 599' }).line, 'No history for this train yet');
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
  render(card, result, { server: 'https://example.test', link: '/' });
  assert.equal(doc.querySelectorAll('spk-badge').length, 1);
  card.el.remove();
  clear(doc);
  assert.equal(card.el.querySelector('spk-badge'), null);
});
