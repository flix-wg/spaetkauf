import type { TripRef } from './api'
import { deleteTrip, listTrips } from './core/trips.ts'

// Trips saved by the old server version kept {id, secret} pairs here.
const LEGACY = 'spaetkauf.trips'

export const loadTrips = (): TripRef[] => listTrips().map((t) => ({ id: t.id }))
export const findTrip = (id: string) => loadTrips().find((t) => t.id === id)
export function removeTrip(id: string) {
  try {
    deleteTrip(id)
  } catch {
    /* storage blocked: there was nothing to remove */
  }
}
// A link or saved entry from the old Kurt server: /trip(s)/<id>?secret=…
export function oldServerTrip(id: string, search: string) {
  if (new URLSearchParams(search).has('secret')) return true
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY) ?? '[]')
    return Array.isArray(old) && old.some((t) => t?.id === id)
  } catch {
    return false
  }
}
