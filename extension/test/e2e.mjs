import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const serverURL = process.env.SPK_SERVER;
assert(serverURL, 'SPK_SERVER is required');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SPK_SHOTS || path.join(os.homedir(), 'tmp/spk-shots-real');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'spk-e2e-'));
const copy = path.join(temporary, 'extension');
let context;
const fixtures = path.join(extension, 'fixtures');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(fixtures, '.' + pathname);
    if (!file.startsWith(fixtures + path.sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
try {
  await mkdir(shots, { recursive: true });
  await cp(extension, copy, { recursive: true, filter: source => !['node_modules', 'test', 'fixtures'].includes(path.relative(extension, source).split(path.sep)[0]) });
  const manifestFile = path.join(copy, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
  await writeFile(manifestFile, JSON.stringify(manifest));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`, '--host-resolver-rules=MAP *.bahn.de ~NOTFOUND, MAP bahn.de ~NOTFOUND']
  });
  await context.route(/bahn\.de/, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/src/options.html`);
  await options.locator('#server').fill(serverURL);
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  await options.getByText('Saved', { exact: true }).waitFor();
  const page = await context.newPage();
  await page.goto(base + '/e2e.html#sts=true&so=Frankfurt(Main)Hbf&zo=M%C3%BCnchen%20Hbf&hd=2026-11-21T05:00:00');
  await page.waitForFunction(() => document.querySelectorAll('spk-badge').length === 5);
  assert.equal(await page.locator('spk-badge').count(), 5);
  assert.equal(await page.locator('spk-badge[data-kurt="true"]').count(), 1);
  const buttons = page.getByRole('button', { name: 'Weiter', exact: true });
  assert(await buttons.count() > 0, 'Fixture has booking controls');
  for (const button of await buttons.all()) {
    await button.scrollIntoViewIfNeeded();
    assert(await button.isVisible());
    assert(await button.evaluate(el => {
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top === el || el.contains(top);
    }), 'Weiter remains unobstructed');
    await button.click({ trial: true });
  }
  await page.screenshot({ path: path.join(shots, 'x-results.png'), fullPage: true });
  const kurt = page.locator('spk-badge[data-kurt="true"]');
  const kurtCard = kurt.locator('xpath=ancestor::*[self::li or self::article][1]');
  await (await kurtCard.count() ? kurtCard : kurt.locator('..')).screenshot({ path: path.join(shots, 'x-kurt.png') });
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, page.url());
  assert(Number.isInteger(tabId));
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${id}/src/popup.html?tab=${tabId}`);
  await popup.waitForFunction(() => document.getElementById('tab').textContent.includes('connections'));
  await popup.waitForFunction(() => !document.getElementById('health').textContent.includes('Checking') && document.getElementById('health').textContent.length > 0);
  assert((await popup.locator('#health').innerText()).includes('Reachable'), 'Service worker reaches server without CORS middleware');
  assert.equal(await popup.locator('#error').innerText(), '');
  await popup.screenshot({ path: path.join(shots, 'x-popup.png') });
  await options.screenshot({ path: path.join(shots, 'x-options.png') });
  const realFile = 'real/bahn-results-2026-11-14.html';
  const html = await readFile(path.join(fixtures, realFile), 'utf8');
  const header = html.match(/<!--[\s\S]*?-->/)?.[0] || '';
  const hash = header.match(/#[^\s<>"']+/)?.[0];
  assert(hash, 'Saved real fixture header must contain search hash');
  await page.goto(base + '/' + realFile + hash);
  await page.locator('spk-badge').first().waitFor({ timeout: 30000 });
  assert(await page.locator('spk-badge').count() >= 1);
  await page.screenshot({ path: path.join(shots, 'x-real.png'), fullPage: true });
  console.log(`Passed: 5 badges, one Kurt, booking controls, popup, options, real fixture and service-worker server access. Screenshots: ${shots}`);
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
