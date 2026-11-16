import type { Claim, Pick, Trip, TripState } from '../api'
import { tr, tx } from '../i18n-core.ts'
import { berlinDate } from './berlin.ts'
import { computeClaim, timeline } from './claim.ts'
import { minutes } from './picks.ts'
import type { Transitous } from './transitous'

// Trips live only in this browser. Constants follow backend trips.py and tracker.py.
export const TRIPS_KEY = 'kurt.trips.v1'
const STALE_AFTER = 10 * 60_000
const FINISH_AFTER = 45 * 60_000
const WINDOW_BEFORE = 3 * 3600_000
const WATCH_EVERY = 2 * 60_000
const MAX_SNAPS = 300
const THRESHOLDS = [[20, 'Ticket unlocked', 0], [60, '25 % back', 25], [120, '50 % back', 50]] as const
const LEVELS = ['20', '60', '120'] as const
export type Level = typeof LEVELS[number] | 'cancelled'
const WHERE = 'File it yourself with DB: online at bahn.de (Fahrgastrechte), in the DB Navigator app or at a DB travel centre. This app never submits a claim.'

export class StorageUnavailable extends Error {}
export interface Snapshot { at: string; delay_min: number | null; expected_arr: string | null; cancelled: boolean; connection_at_risk: boolean }
export interface SavedTrip { id: string; pick: Pick; price_eur: number | null; switched: boolean; snaps: Snapshot[]; alerted: Level[]; finished?: boolean }

export function localStore(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}
function read(store: Storage | null): SavedTrip[] {
  try {
    const list = JSON.parse(store?.getItem(TRIPS_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter(t => typeof t?.id === 'string' && t.pick?.legs?.length) : []
  } catch { return [] }
}
const listeners = new Set<() => void>()
export function subscribeTrips(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function write(store: Storage | null, list: SavedTrip[]) {
  try {
    if (!store) throw new Error('no localStorage')
    store.setItem(TRIPS_KEY, JSON.stringify(list))
  } catch (error) { throw new StorageUnavailable('Trips cannot be saved on this device', { cause: error }) }
  for (const listener of listeners) listener()
}

export async function saveTrip(pick: Pick, price?: number, store = localStore()): Promise<{ id: string }> {
  const trip: SavedTrip = { id: crypto.randomUUID(), pick, price_eur: price ?? null, switched: false, snaps: [], alerted: [] }
  write(store, [trip, ...read(store)])
  return { id: trip.id }
}
export const listTrips = (store = localStore()) => read(store)
export const getTrip = (id: string, store = localStore()) => read(store).find(t => t.id === id)
export function updateTrip(id: string, change: { price_eur?: number; switched?: boolean; snaps?: Snapshot[]; alerted?: Level[]; finished?: boolean }, store = localStore()) {
  const set = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined))
  write(store, read(store).map(t => t.id === id ? { ...t, ...set } : t))
}
export function deleteTrip(id: string, store = localStore()) {
  write(store, read(store).filter(t => t.id !== id))
}

interface TStop { name?: string; arrival?: string; scheduledArrival?: string; departure?: string; scheduledDeparture?: string; cancelled?: boolean }
interface TLeg { from?: TStop; to?: TStop; intermediateStops?: TStop[]; cancelled?: boolean; realTime?: boolean }
const norm = (name = '') => name.toLowerCase().replaceAll('hauptbahnhof', 'hbf').replace(/[^a-z0-9]/g, '')
function findStop(stops: TStop[], name: string, field: 'scheduledArrival' | 'scheduledDeparture', sched: string) {
  return (name ? stops.find(s => norm(s.name) === norm(name)) : undefined)
    ?? (sched ? stops.find(s => s[field] && Date.parse(s[field]!) === Date.parse(sched)) : undefined)
}
function readLeg(data: { legs?: TLeg[] }, leg: Pick['legs'][number]) {
  const legs = data.legs ?? []
  const stops = legs.flatMap(l => [l.from ?? {}, ...(l.intermediateStops ?? []), l.to ?? {}])
  const alight = findStop(stops, leg.to, 'scheduledArrival', leg.arr)
  if (!alight?.scheduledArrival) return null
  const board = findStop(stops, leg.from, 'scheduledDeparture', leg.dep)
  return {
    arr: alight.arrival || alight.scheduledArrival, sched: alight.scheduledArrival, dep: board?.departure ?? null,
    cancelled: legs.some(l => l.cancelled) || !!alight.cancelled || !!board?.cancelled, realtime: legs.some(l => l.realTime),
  }
}
// One reading for a booked pick: the delay at the last leg's alighting stop, null without live data.
export async function poll(tr: Transitous, pick: Pick, now = new Date()): Promise<Snapshot | null> {
  const reads: NonNullable<ReturnType<typeof readLeg>>[] = []
  for (const leg of pick.legs.filter(l => l.trip_id)) {
    const got = readLeg(await tr.trip(leg.trip_id) as { legs?: TLeg[] }, leg)
    if (!got) return null
    reads.push(got)
  }
  if (!reads.length || !reads.every(r => r.realtime)) return null
  const last = reads.at(-1)!
  return {
    at: now.toISOString().slice(0, 19) + 'Z', delay_min: minutes(last.sched, last.arr), expected_arr: last.arr,
    cancelled: reads.some(r => r.cancelled),
    connection_at_risk: reads.some((r, i) => !!(i + 1 < reads.length && r.arr && reads[i + 1].dep && Date.parse(r.arr) > Date.parse(reads[i + 1].dep!))),
  }
}

function deriveState(delay: number | null, cancelled: boolean): TripState {
  const d = delay ?? 0
  return cancelled ? 'cancelled' : d >= 120 ? 'cash50' : d >= 60 ? 'cash25' : d >= 20 ? 'unlocked' : 'on_time'
}
// Port of trips.trip_view. Switching alternatives need extra /plan calls, so the static app shows none.
export function tripView(t: SavedTrip, now = new Date()): Trip {
  const snap = t.snaps.at(-1), pick = t.pick
  const delay = snap?.delay_min ?? null, at = +now, arr = Date.parse(pick.arr), dep = Date.parse(pick.dep)
  const finished = !!t.finished || at > arr + Math.max(delay ?? 0, 0) * 60_000 + FINISH_AFTER
  const stale = snap ? at - Date.parse(snap.at) > STALE_AFTER && !finished : dep - WINDOW_BEFORE <= at && at <= arr + FINISH_AFTER
  const excluded = !!pick.already_posted
  const thresholds = THRESHOLDS.map(([line, label, pct]) => ({
    at: line, label, reached: !excluded && (delay ?? 0) >= line,
    amount_eur: t.price_eur !== null && pct && !excluded ? computeClaim(t.price_eur, line, false).amount_eur : null,
  }))
  const delays = t.snaps.map(s => s.delay_min).filter(d => d !== null)
  return {
    booking_delay_excluded: excluded, switching_before_departure_only: false, booked: pick, price_eur: t.price_eur,
    state: deriveState(excluded ? null : delay, !!snap?.cancelled), delay_min: delay,
    peak_delay_min: delays.length ? Math.max(...delays) : null, expected_arr: snap?.expected_arr ?? null,
    updated_at: snap?.at ?? null, stale, thresholds, alternatives: [],
    stay: { amount_at_60_eur: thresholds[1].amount_eur, amount_at_120_eur: thresholds[2].amount_eur },
    connection_at_risk: !!snap?.connection_at_risk, delay_basis: 'destination_forecast', at_stop: null,
    is_replay: false, replay_of: null, finished, final_delay_min: finished ? delay : null, switched: t.switched,
  }
}
// Port of trips.get_claim; the date field is the Berlin travel day.
export function tripClaim(t: SavedTrip, now = new Date()): Claim {
  const view = tripView(t, now), legs = t.pick.legs, switched = t.switched
  const result = view.booking_delay_excluded
    ? { due: false, pct: 0, amount_eur: null, reason: 'The delay was already posted when you booked; no compensation is due.' }
    : computeClaim(t.price_eur, view.delay_min, switched)
  const expected = view.expected_arr, seen = view.updated_at
  const provisional = !expected || !seen || Date.parse(seen) < Date.parse(expected)
  const delay = switched ? null : view.delay_min
  const observed = switched ? '' : expected ?? ''
  const fields = [
    { label: 'Date', value: berlinDate(t.pick.dep) },
    { label: 'Train', value: legs.map(l => l.train).join(', ') },
    { label: 'From', value: legs[0].from },
    { label: 'To', value: legs.at(-1)!.to },
    { label: 'Scheduled arrival', value: t.pick.arr },
    { label: provisional && !switched ? 'Expected arrival' : 'Actual arrival', value: observed },
    { label: 'Delay', value: delay !== null ? `${delay} min` : '' },
  ]
  const evidence = !switched && !view.booking_delay_excluded && delay !== null ? {
    scheduled_arr: t.pick.arr, observed_arr: observed || null, delay_min: delay,
    source: 'Real-time data from Transitous, not DB\'s own record.', observations: timeline(t.snaps),
  } : null
  return { ...result, fields, where: WHERE, evidence, switched, provisional, is_replay: false, replay_of: null }
}

async function notifyLocal(level: Level, t: SavedTrip) {
  if (globalThis.Notification?.permission !== 'granted') return
  const delay = t.snaps.at(-1)?.delay_min ?? 0
  const what = { '20': tr('thresholdUnlocked'), '60': tr('25Back501'), '120': tr('50Back502') }
  const body = level === 'cancelled' ? tr('yourTrainIsCancelledTicketUnlockedRide') : tx('tripAlert', t.pick.legs[0].train, delay, what[level])
  const options = { body, icon: '/icon-192.png', tag: `trip-${t.id}`, data: { url: `/trip/${t.id}` } }
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) await registration.showNotification(tr('kurt'), options)
    else new Notification(tr('kurt'), options)
  } catch { /* the screen shows the same alert */ }
}

// Polls the trip every 2 minutes while the page is visible and alerts once per newly crossed level.
export function watchTrip(id: string, onUpdate: (t: SavedTrip) => void, o: {
  tr: Transitous; store?: Storage | null; now?: () => Date; notify?: (level: Level, t: SavedTrip) => void
}): () => void {
  const store = o.store === undefined ? localStore() : o.store
  const now = o.now ?? (() => new Date()), notify = o.notify ?? notifyLocal
  const doc = globalThis.document
  let timer: ReturnType<typeof setInterval> | undefined, busy = false, stopped = false
  async function tick() {
    if (busy) return
    busy = true
    try {
      const saved = getTrip(id, store)
      if (!saved || saved.finished || +now() < Date.parse(saved.pick.dep) - WINDOW_BEFORE) return
      if (tripView(saved, now()).finished) { updateTrip(id, { finished: true }, store); return }
      const snap = await poll(o.tr, saved.pick, now()).catch(() => null)
      const fresh = getTrip(id, store)
      if (stopped || !fresh) return
      if (!snap) {
        if (tripView(fresh, now()).finished) updateTrip(id, { finished: true }, store)
        return
      }
      const reached: Level[] = [...LEVELS.filter(l => !fresh.pick.already_posted && (snap.delay_min ?? 0) >= Number(l)), ...(snap.cancelled ? ['cancelled' as const] : [])]
      const fresher = reached.filter(l => !fresh.alerted.includes(l))
      const next = { ...fresh, snaps: [...fresh.snaps, snap].slice(-MAX_SNAPS), alerted: [...fresh.alerted, ...fresher] }
      updateTrip(id, { snaps: next.snaps, alerted: next.alerted, finished: tripView(next, now()).finished }, store)
      if (fresher.length) notify(fresher.at(-1)!, next)
      onUpdate(next)
    } catch { /* keep the last reading; the view marks it stale */ }
    finally { busy = false }
  }
  const start = () => {
    if (timer !== undefined) return
    void tick()
    timer = setInterval(tick, WATCH_EVERY)
  }
  const pause = () => { clearInterval(timer); timer = undefined }
  const onVisibility = () => doc.visibilityState === 'hidden' ? pause() : start()
  if (doc?.visibilityState !== 'hidden') start()
  doc?.addEventListener('visibilitychange', onVisibility)
  return () => { stopped = true; pause(); doc?.removeEventListener('visibilitychange', onVisibility) }
}

export function watchTrips(o: Parameters<typeof watchTrip>[2]): () => void {
  const active = new Map<string, () => void>()
  const sync = () => {
    const trips = listTrips(o.store === undefined ? localStore() : o.store).filter(t => !t.finished)
    for (const [id, stop] of active) {
      if (!trips.some(t => t.id === id)) { stop(); active.delete(id) }
    }
    for (const trip of trips) {
      if (!active.has(trip.id)) active.set(trip.id, watchTrip(trip.id, () => undefined, o))
    }
  }
  const unsubscribe = subscribeTrips(sync)
  globalThis.addEventListener?.('storage', sync)
  sync()
  return () => {
    unsubscribe()
    globalThis.removeEventListener?.('storage', sync)
    for (const stop of active.values()) stop()
    active.clear()
  }
}
