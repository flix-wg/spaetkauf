import type { TripRef, Created } from './api'

const KEY = 'spaetkauf.trips'

export function loadTrips(): TripRef[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((t) => t && typeof t.id === 'string' && typeof t.secret === 'string') : []
  } catch {
    return []
  }
}
function save(list: TripRef[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage blocked: the trip still opens this session via the URL */
  }
}
export function addTrip(c: Created): TripRef {
  const ref = { id: c.trip_id, secret: c.secret }
  save([ref, ...loadTrips().filter((t) => t.id !== ref.id)])
  return ref
}
export function removeTrip(id: string) {
  save(loadTrips().filter((t) => t.id !== id))
}
export function findTrip(id: string): TripRef | undefined {
  return loadTrips().find((t) => t.id === id)
}
