import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createTransitous, BudgetSpent, SourceUnavailable, OutsideTimetable, stationsSearch } from '../../src/core/transitous.ts'
import { getPicks, BadRequest, NotFound, resolve } from '../../src/core/picks.ts'
import { computeClaim, timeline } from '../../src/core/claim.ts'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: (n: number) => [...values.keys()][n] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } as Storage
}

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
  const tr = createTransitous({ storage: null, cacheStorage: null, fetch: async () => Response.json(golden.plan) })
  assert.deepEqual(await getPicks({ tr, odds, now: new Date(golden.now) }, c.query), c.expected)
})
test('429 retries spend once, cache hits spend nothing and User-Agent is absent', async () => {
  let calls = 0
  const tr = createTransitous({ storage: null, cacheStorage: null, planCap: 1, fetch: async (_url, init) => {
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
  const tr = createTransitous({ storage: null, cacheStorage: null, fetch: async () => ++calls === 1
    ? Response.json({ ...golden.plan, itineraries: golden.plan.itineraries.slice(0, 2), nextPageCursor: 'next' }) : new Response('', { status: 503 }) })
  await assert.rejects(getPicks({ tr, odds, now: new Date(golden.now) }, golden.picks[0].query), SourceUnavailable)
  assert.equal(calls, 3)
})
test('61st plan is blocked and budget resets at Berlin midnight across clients', async () => {
  const storage = memoryStorage()
  let now = Date.parse('2027-03-27T22:59:00Z'), calls = 0
  const opts = { storage, cacheStorage: null, now: () => now, fetch: async () => { calls++; return Response.json({}) } }
  const tr = createTransitous(opts)
  for (let n = 0; n < 60; n++) await tr.plan({ from: String(n), to: 'b' })
  await assert.rejects(createTransitous(opts).plan({ from: '61', to: 'b' }), BudgetSpent)
  now += 60_000
  await createTransitous(opts).plan({ from: '61', to: 'b' })
  assert.equal(calls, 61)
  assert.equal(storage.getItem('kurt.plan-budget.2027-03-27'), null)
  assert.equal(storage.getItem('kurt.plan-budget.2027-03-28'), '1')
})
test('outside timetable reports the inclusive date range', async () => {
  const tr = createTransitous({ storage: null, cacheStorage: null, fetch: async () => Response.json({ error: 'query time 2027-01-01 is outside of loaded timetable window [2026-01-01 00:00, 2026-12-14 00:00[' }, { status: 400 }) })
  await assert.rejects(tr.plan({ from: 'a', to: 'b' }), e => e instanceof OutsideTimetable && e.message === 'Timetables only cover 2026-01-01 to 2026-12-13. Pick a date in that range')
})

test('storage write failure still enforces budget and caches in memory', async () => {
  const storage = { getItem: () => '0', setItem: () => { throw new Error('quota') } } as Storage
  let calls = 0
  const tr = createTransitous({ storage, cacheStorage: null, planCap: 1, fetch: async () => { calls++; return Response.json({}) } })
  await tr.plan({ from: 'a', to: 'b' })
  await assert.rejects(tr.plan({ from: 'c', to: 'b' }), BudgetSpent)
  assert.equal(calls, 1)
})

test('persisted cache survives a new client and expires at Python TTLs', async () => {
  const storage = memoryStorage()
  let now = Date.parse('2027-01-01T12:00:00Z'), calls = 0
  const opts = { storage, cacheStorage: memoryStorage(), now: () => now, fetch: async (_url, init) => {
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
  const tr = createTransitous({ storage: null, cacheStorage: null, fetch: async () => {
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

test('quota cleanup retries only response keys and keeps the persistent budget', async () => {
  const storage = memoryStorage(), cacheStorage = memoryStorage()
  const now = Date.parse('2027-03-27T12:00:00Z')
  storage.setItem('kurt.plan-budget.2027-03-26', '60')
  storage.setItem('kurt.trips.v1', 'saved trips')
  cacheStorage.setItem('kurt.trips.v1', 'untouched')
  cacheStorage.setItem('kurt.http.expired', JSON.stringify({ expires_at: now - 1 }))
  cacheStorage.setItem('kurt.http.fresh', JSON.stringify({ expires_at: now + 1000 }))
  let writes = 0
  cacheStorage.setItem = () => {
    writes++
    assert.equal(cacheStorage.getItem('kurt.http.expired'), null)
    if (writes === 2) assert.equal(cacheStorage.getItem('kurt.http.fresh'), null)
    throw new DOMException('full', 'QuotaExceededError')
  }
  const opts = { storage, cacheStorage, now: () => now, planCap: 1, fetch: async () => Response.json({ ok: true }) }
  const tr = createTransitous(opts)
  assert.deepEqual(await tr.plan({ from: 'a', to: 'b' }), { ok: true })
  assert.deepEqual(await tr.plan({ from: 'a', to: 'b' }), { ok: true })
  assert.equal(writes, 2)
  assert.equal(storage.getItem('kurt.plan-budget.2027-03-26'), null)
  assert.equal(storage.getItem('kurt.plan-budget.2027-03-27'), '1')
  assert.equal(storage.getItem('kurt.trips.v1'), 'saved trips')
  assert.equal(cacheStorage.getItem('kurt.trips.v1'), 'untouched')
  assert.equal(storage.length, 2)
  await assert.rejects(createTransitous(opts).plan({ from: 'new', to: 'b' }), BudgetSpent)
})

test('plan timestamps truncate milliseconds and accept HH:MM:SS; unknown stations are typed', async () => {
  const times: string[] = []
  const tr = createTransitous({ storage: null, cacheStorage: null, fetch: async url => {
    const query = new URL(String(url))
    if (query.pathname.endsWith('/geocode')) return Response.json([])
    times.push(query.searchParams.get('time')!)
    return Response.json({ itineraries: [] })
  } })
  const query = { from: 'de_ham', to: 'de_muc', date: '2027-03-28' }
  const now = new Date('2027-03-28T00:00:12.345Z')
  await getPicks({ tr, odds, now }, query)
  await getPicks({ tr, odds, now }, { ...query, time: '03:15:42' })
  assert.deepEqual(times, ['2027-03-28T00:00:12Z', '2027-03-28T01:15:42Z'])
  await assert.rejects(resolve(tr, 'Nowhere'), e => e instanceof NotFound && e.message === 'Unknown station: Nowhere')
})
