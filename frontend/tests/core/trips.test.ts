import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Pick } from '../../src/api.ts'
import type { Transitous } from '../../src/core/transitous.ts'
import { deleteTrip, getTrip, listTrips, saveTrip, StorageUnavailable, tripClaim, tripView, watchTrip } from '../../src/core/trips.ts'

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
