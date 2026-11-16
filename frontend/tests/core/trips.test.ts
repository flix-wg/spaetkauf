import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Pick } from '../../src/api.ts'
import type { Transitous } from '../../src/core/transitous.ts'
import { deleteTrip, getTrip, listTrips, saveTrip, StorageUnavailable, tripClaim, tripView, watchTrip, watchTrips } from '../../src/core/trips.ts'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: i => [...values.keys()][i] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: key => void values.delete(key),
    clear: () => values.clear(),
  }
}
const blocked = { getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('QuotaExceededError') } } as unknown as Storage

const pick: Pick = {
  id: 'p1', dep: '2026-11-20T09:00:00Z', arr: '2026-11-20T13:00:00Z', duration_min: 240, changes: 0,
  legs: [{ train: 'ICE 1003', from: 'Berlin Hbf', to: 'München Hbf', dep: '2026-11-20T09:00:00Z', arr: '2026-11-20T13:00:00Z', trip_id: 't1' }],
  odds: null, already_posted: false, is_kurts_pick: true, ride_instead: null, bahn_url: '',
}

test('save, list, get and delete a trip', async () => {
  const store = memoryStorage()
  const { id } = await saveTrip(pick, 59.9, store)
  assert.deepEqual(listTrips(store).map(t => t.id), [id])
  const view = tripView(getTrip(id, store)!, new Date('2026-11-20T08:00:00Z'))
  assert.equal(view.state, 'on_time')
  assert.deepEqual(view.thresholds.map(t => t.amount_eur), [null, 15, 29.95])
  deleteTrip(id, store)
  assert.equal(getTrip(id, store), undefined)
})

test('blocked storage: saving rejects, reading is empty', async () => {
  await assert.rejects(saveTrip(pick, undefined, blocked), StorageUnavailable)
  await assert.rejects(saveTrip(pick, undefined, null), StorageUnavailable)
  assert.deepEqual(listTrips(blocked), [])
})

test('watchTrip records snapshots and notifies once per threshold crossing', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const store = memoryStorage()
  const { id } = await saveTrip(pick, 80, store)
  const delays = [5, 25, 22, 70, 75]
  let call = 0
  const tr = {
    trip: async () => {
      const d = delays[Math.min(call++, delays.length - 1)]
      const arrival = new Date(Date.parse(pick.arr) + d * 60_000).toISOString()
      return { legs: [{ realTime: true, from: { name: 'Berlin Hbf', scheduledDeparture: pick.dep, departure: pick.dep },
        to: { name: 'München Hauptbahnhof', scheduledArrival: pick.arr, arrival }, intermediateStops: [] }] }
    },
  } as unknown as Transitous
  const alerts: string[] = []
  let updates = 0
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }
  const stop = watchTrip(id, () => updates++, { tr, store, now: () => new Date('2026-11-20T12:00:00Z'), notify: level => void alerts.push(level) })
  await settle()
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(120_000); await settle() }
  stop()
  t.mock.timers.tick(120_000); await settle()
  assert.equal(updates, 5)
  assert.deepEqual(alerts, ['20', '60'])
  const saved = getTrip(id, store)!
  assert.equal(saved.snaps.length, 5)
  const now = new Date('2026-11-20T12:01:00Z')
  assert.equal(tripView(saved, now).state, 'cash25')
  const claim = tripClaim(saved, now)
  assert.equal(claim.amount_eur, 20)
  assert.equal(claim.provisional, true)
  assert.deepEqual(claim.evidence?.observations.map(o => o.delay_min), [5, 25, 70, 75])
})

test('app watcher follows saved trips, visibility and backend window; posted delay still alerts cancellation', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const doc = new EventTarget() as EventTarget & { visibilityState: string }
  doc.visibilityState = 'visible'
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  })
  const store = memoryStorage()
  const first = await saveTrip({ ...pick, already_posted: true }, 80, store)
  let now = new Date('2026-11-20T05:59:59Z')
  let calls = 0, cancelled = false
  const tr = { trip: async () => {
    calls++
    return { legs: [{ realTime: true, cancelled,
      from: { name: 'Berlin Hbf', scheduledDeparture: pick.dep, departure: pick.dep },
      to: { name: 'München Hbf', scheduledArrival: pick.arr, arrival: '2026-11-20T14:00:00Z' } }] }
  } } as unknown as Transitous
  const alerts: string[] = []
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }
  const stop = watchTrips({ tr, store, now: () => now, notify: level => void alerts.push(level) })
  t.after(stop)
  await settle()
  assert.equal(calls, 0)
  now = new Date('2026-11-20T06:00:00Z')
  t.mock.timers.tick(120_000); await settle()
  assert.equal(calls, 1)
  assert.deepEqual(alerts, [])
  const second = await saveTrip(pick, 80, store)
  await settle()
  assert.equal(calls, 2)
  deleteTrip(second.id, store)
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'))
  t.mock.timers.tick(120_000); await settle()
  assert.equal(calls, 2)
  cancelled = true
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'))
  await settle()
  assert.equal(calls, 3)
  assert.deepEqual(alerts, ['60', 'cancelled'])
  t.mock.timers.tick(120_000); await settle()
  assert.deepEqual(alerts, ['60', 'cancelled'])
  now = new Date('2026-11-20T14:45:00Z')
  t.mock.timers.tick(120_000); await settle()
  assert.equal(getTrip(first.id, store)!.finished, false)
  now = new Date('2026-11-20T14:45:01Z')
  t.mock.timers.tick(120_000); await settle()
  assert.equal(getTrip(first.id, store)!.finished, true)
  const finalCalls = calls
  t.mock.timers.tick(120_000); await settle()
  assert.equal(calls, finalCalls)
  stop()
})

test('concurrent tab watchers serialize snapshots and alert once with Web Locks', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let queue = Promise.resolve(), requests = 0
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: (_name: string, work: () => Promise<void>) => {
      requests++
      const result = queue.then(work)
      queue = result.catch(() => undefined)
      return result
    },
  } } })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous)
    else Reflect.deleteProperty(globalThis, 'navigator')
  })
  const store = memoryStorage()
  const { id } = await saveTrip(pick, 80, store)
  const tr = { trip: async () => ({ legs: [{ realTime: true,
    from: { name: 'Berlin Hbf', scheduledDeparture: pick.dep, departure: pick.dep },
    to: { name: 'München Hbf', scheduledArrival: pick.arr, arrival: '2026-11-20T13:25:00Z' },
  }] }) } as unknown as Transitous
  const alerts: string[] = []
  const options = { tr, store, now: () => new Date('2026-11-20T12:00:00Z'), notify: (level: string) => void alerts.push(level) }
  const stops = [watchTrip(id, () => undefined, options), watchTrip(id, () => undefined, options)]
  t.after(() => stops.forEach(stop => stop()))
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests, 2)
  assert.equal(getTrip(id, store)!.snaps.length, 2)
  assert.deepEqual(alerts, ['20'])
})
