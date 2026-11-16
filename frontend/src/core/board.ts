import type { LateNow, LateTrain } from '../api'
import { minutes } from './picks.ts'
import { SourceUnavailable, stationsSearch, type Transitous } from './transitous.ts'
import { localStore } from './trips.ts'

// Port of board.py without auto-tracking: hub arrivals, worst delay per train, cached for 5 minutes.
export const HUBS = [
  'Hamburg Hbf', 'Berlin Hbf', 'Hannover Hbf', 'Köln Hbf', 'Frankfurt Hbf', 'Mannheim Hbf',
  'Stuttgart Hbf', 'München Hbf', 'Nürnberg Hbf', 'Leipzig Hbf', 'Dortmund Hbf', 'Karlsruhe Hbf',
]
const LATE_MIN = 20
const KEEP = 5 * 60_000
const KEY = 'kurt.late.v1'

interface StopTime {
  realTime?: boolean; cancelled?: boolean; routeShortName: string; headsign?: string
  place?: { arrival?: string; scheduledArrival?: string; cancelled?: boolean }
}
export function arrivals(station: string, data: { stopTimes?: StopTime[] }): LateTrain[] {
  return (data.stopTimes ?? []).flatMap(st => {
    const place = st.place ?? {}
    if (!st.realTime || st.cancelled || place.cancelled || !place.arrival || !place.scheduledArrival) return []
    return [{ train: st.routeShortName, station, sched: place.scheduledArrival, expected: place.arrival,
      delay_min: minutes(place.scheduledArrival, place.arrival), headsign: st.headsign || '' }]
  })
}
export function dedupe(rows: LateTrain[]): LateTrain[] {
  const best = new Map<string, LateTrain>()
  for (const r of rows) if (!best.has(r.train) || r.delay_min > best.get(r.train)!.delay_min) best.set(r.train, r)
  return [...best.values()]
}

export async function lateNow(tr: Transitous, o: { store?: Storage | null; now?: () => number } = {}): Promise<LateNow> {
  const store = o.store === undefined ? localStore() : o.store
  const now = (o.now ?? Date.now)()
  let cached: Omit<LateNow, 'stale'> | null = null
  try { cached = JSON.parse(store?.getItem(KEY) ?? 'null') } catch { /* no cache */ }
  if (cached && now - Date.parse(cached.checked_at!) < KEEP) return { ...cached, stale: false }
  const rows: LateTrain[] = []
  let read = 0
  for (const hub of HUBS) {
    try {
      const [stop] = await stationsSearch(tr, hub)
      if (!stop) continue
      rows.push(...arrivals(hub, await tr.stoptimes(stop.id) as { stopTimes?: StopTime[] }))
      read++
    } catch (error) { if (!(error instanceof SourceUnavailable)) throw error }
  }
  if (!read) {
    if (cached) return { ...cached, stale: true }
    throw new SourceUnavailable('no hub board could be read')
  }
  const trains = dedupe(rows)
  const board = { checked_at: new Date(now).toISOString().slice(0, 19) + 'Z', checked: trains.length,
    late: trains.filter(r => r.delay_min >= LATE_MIN).sort((a, b) => b.delay_min - a.delay_min) }
  try { store?.setItem(KEY, JSON.stringify(board)) } catch { /* shown without a cache */ }
  return { ...board, stale: false }
}
