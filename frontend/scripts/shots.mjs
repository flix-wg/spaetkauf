// Screenshots in mock mode: VITE_MOCK=1 npm run dev, then node scripts/shots.mjs <outdir>
import { chromium } from 'playwright'

const out = process.argv[2] ?? 'shots'
const base = process.env.BASE ?? 'http://localhost:5710'
const trips = ['demo-live', 'demo-replay', 'demo-done', 'demo-claim', 'demo-stale'].map((id) => ({ id, secret: 'x' }))
const P = '/picks?from=8002549&to=8000261&fn=Hamburg%20Hbf&tn=M%C3%BCnchen%20Hbf&date=2026-11-20&time=15%3A00'

const browser = await chromium.launch()
async function ctx(w, h, seed = true, flags = {}) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  await c.addInitScript(([t, f, s]) => {
    if (s) localStorage.setItem('spaetkauf.trips', JSON.stringify(t))
    for (const [k, v] of Object.entries(f)) localStorage.setItem(`mock.${k}`, v)
  }, [trips, flags, seed])
  return c
}
async function shot(c, name, path, act) {
  const p = await c.newPage()
  p.on('pageerror', (e) => console.log('PAGEERROR', name, e.message))
  p.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', name, m.text()))
  await p.goto(base + path)
  await p.waitForTimeout(900)
  if (act) await act(p)
  await p.waitForTimeout(900)
  await p.screenshot({ path: `${out}/${name}.png` })
  await p.close()
}
const scrollMain = (y) => (p) => p.evaluate((y) => document.querySelector('main').scrollTo(0, y === 'end' ? 99999 : y), y)

const m = await ctx(390, 844)
await shot(m, '01-search', '/', async (p) => { await p.getByRole('button', { name: /Hamburg → München/ }).click() })
await shot(m, '02-picks', P)
await shot(m, '03-picks-more', P, async (p) => { await p.getByRole('button', { name: /18:24/ }).click(); await scrollMain(560)(p) })
await shot(m, '04-picks-signals', P, scrollMain('end'))
await shot(m, '05-book-sheet', P, async (p) => { await p.getByRole('button', { name: 'I booked this' }).first().click(); await p.locator('#price').fill('34.99') })
await shot(m, '06-trip-unlocked', '/trip/demo-live')
await shot(m, '07-trip-unlocked-switch', '/trip/demo-live', scrollMain('end'))
await shot(m, '08-trip-replay', '/trip/demo-replay')
await shot(m, '09-trip-done-ontime', '/trip/demo-done')
await shot(m, '10-trip-stale', '/trip/demo-stale')
await shot(m, '11-trips', '/trips')
await shot(m, '12-late', '/late')
await shot(m, '13-claim', '/trip/demo-claim/claim')
await shot(m, '14-backtest', '/late?sheet=backtest')
await shot(m, '15-sources', '/late?sheet=sources')
await shot(m, '16-claim-copied', '/trip/demo-claim/claim', async (p) => { await p.getByRole('button', { name: /Booked trains/ }).click() })
const e = await ctx(390, 844, false, { signals: 'empty' })
await shot(e, '17-trips-empty', '/trips')
await shot(e, '18-picks-signals-empty', P, scrollMain('end'))
const f = await ctx(390, 844, true, { fail: '1' })
await shot(f, '19-error', P)
const l = await ctx(390, 844, true, { late: 'stale' })
await shot(l, '20-late-stale', '/late')
const w = await ctx(1440, 900)
await shot(w, '21-laptop', P)
await browser.close()
