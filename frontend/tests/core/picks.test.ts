import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createTransitous, BudgetSpent, SourceUnavailable, OutsideTimetable, stationsSearch } from '../../src/core/transitous.ts'
import { getPicks, BadRequest } from '../../src/core/picks.ts'
import { computeClaim, timeline } from '../../src/core/claim.ts'

const root = new URL('../../public/data/odds/', import.meta.url)
const odds = {
  async index() { return JSON.parse(await readFile(new URL('index.json', root), 'utf8')) },
  async train(type: string, number: string) {
    try { return JSON.parse(await readFile(new URL(`trains/${type}-${number}.json`, root), 'utf8')) }
    catch (e) { if (e.code === 'ENOENT') return null; throw e }
  },
}
const golden = JSON.parse(await readFile(new URL('./golden/picks.json', import.meta.url), 'utf8'))
for (const c of golden.claims) test(`claim ${JSON.stringify(c.args)}`, () => assert.deepEqual(computeClaim(...c.args), c.expected))
test('timeline preserves crossings and cancellations', () => assert.deepEqual(timeline(golden.timeline.args), golden.timeline.expected))
for (const c of golden.picks) test(`picks golden ${c.query.mode}`, async () => {
  const tr = createTransitous({ storage: null, fetch: async () => Response.json(golden.plan) })
  assert.deepEqual(await getPicks({ tr, odds, now: new Date(golden.now) }, c.query), c.expected)
})
test('429 retries once, caches without spending and never sets User-Agent', async () => {
  let calls = 0
  const tr = createTransitous({ storage: null, planCap: 2, fetch: async (_url, init) => {
    assert.equal(new Headers(init?.headers).has('User-Agent'), false)
    return ++calls === 1 ? new Response('', { status: 429 }) : Response.json({ itineraries: [] })
  } })
  assert.deepEqual(await tr.plan({ from: 'a', to: 'b' }), { itineraries: [] })
  await tr.plan({ from: 'a', to: 'b' })
  assert.equal(calls, 2)
  await assert.rejects(tr.plan({ from: 'c', to: 'b' }), BudgetSpent)
})
test('source failure on a later page rejects the whole search', async () => {
  let calls = 0
  const tr = createTransitous({ storage: null, fetch: async () => ++calls === 1
    ? Response.json({ ...golden.plan, nextPageCursor: 'next' }) : new Response('', { status: 503 }) })
  await assert.rejects(getPicks({ tr, odds, now: new Date(golden.now) }, golden.picks[0].query), SourceUnavailable)
  assert.equal(calls, 3)
})
test('61st plan is blocked and budget resets at Berlin midnight across clients', async () => {
  const values = new Map<string, string>()
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } as Storage
  let now = Date.parse('2027-03-27T22:59:00Z'), calls = 0
  const opts = { storage, now: () => now, fetch: async () => { calls++; return Response.json({}) } }
  const tr = createTransitous(opts)
  for (let n = 0; n < 60; n++) await tr.plan({ from: String(n), to: 'b' })
  await assert.rejects(createTransitous(opts).plan({ from: '61', to: 'b' }), BudgetSpent)
  now += 60_000
  await createTransitous(opts).plan({ from: '61', to: 'b' })
  assert.equal(calls, 61)
  assert.ok([...values.keys()].every(k => k.startsWith('kurt.')))
})
test('outside timetable reports the inclusive date range', async () => {
  const tr = createTransitous({ storage: null, fetch: async () => Response.json({ error: 'query time 2027-01-01 is outside of loaded timetable window [2026-01-01 00:00, 2026-12-14 00:00[' }, { status: 400 }) })
  await assert.rejects(tr.plan({ from: 'a', to: 'b' }), e => e instanceof OutsideTimetable && e.message === 'Timetables only cover 2026-01-01 to 2026-12-13. Pick a date in that range')
})

test('storage write failure still enforces budget and caches in memory', async () => {
  const storage = { getItem: () => '0', setItem: () => { throw new Error('quota') } } as Storage
  let calls = 0
  const tr = createTransitous({ storage, planCap: 1, fetch: async () => { calls++; return Response.json({}) } })
  await tr.plan({ from: 'a', to: 'b' })
  await assert.rejects(tr.plan({ from: 'c', to: 'b' }), BudgetSpent)
  assert.equal(calls, 1)
})

test('persisted cache survives a new client and expires at Python TTLs', async () => {
  const values = new Map<string, string>()
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } as Storage
  let now = Date.parse('2027-01-01T12:00:00Z'), calls = 0
  const opts = { storage, now: () => now, fetch: async (_url, init) => {
    assert.ok(init?.signal instanceof AbortSignal)
    calls++; return Response.json({ value: calls })
  } }
  for (const [method, args, seconds] of [['plan', [{ from: 'a', to: 'b' }], 600], ['trip', ['id'], 60], ['stoptimes', ['stop'], 120], ['geocode', ['Hamburg'], 86400]] as const) {
    const first = await createTransitous(opts)[method](...args)
    assert.deepEqual(await createTransitous(opts)[method](...args), first)
    now += seconds * 1000
    assert.notDeepEqual(await createTransitous(opts)[method](...args), first)
  }
  assert.equal(calls, 8)
})

test('invalid search times reject before contacting the source; station search filters rail stops', async () => {
  let calls = 0
  const tr = createTransitous({ storage: null, fetch: async () => {
    calls++
    return Response.json([
      { type: 'STOP', id: 'rail', name: 'Hamburg', lat: 1, lon: 2, modes: ['REGIONAL_RAIL'] },
      { type: 'STOP', id: 'bus', modes: ['BUS'] }, { type: 'PLACE', modes: ['LONG_DISTANCE'] },
    ])
  } })
  for (const [query, message] of [
    [{ date: '2020-01-01' }, 'Date is in the past'],
    [{ time: '25:00' }, 'time must be HH:MM'],
    [{ mode: 'arrive', time: '' }, 'time (latest arrival, HH:MM) is required with mode=arrive'],
  ]) {
    await assert.rejects(getPicks({ tr, odds, now: new Date(golden.now) }, { ...golden.picks[0].query, ...query }), e => e instanceof BadRequest && e.message === message)
  }
  assert.deepEqual(await stationsSearch(tr, ' H '), [])
  assert.equal(calls, 0)
  assert.deepEqual(await stationsSearch(tr, ' Hamburg '), [{ id: 'rail', name: 'Hamburg', lat: 1, lon: 2 }])
})
