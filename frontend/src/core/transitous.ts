import type { Station } from '../api.ts'
import { berlinDate } from './berlin.ts'

export class BudgetSpent extends Error {}
export class SourceUnavailable extends Error {}
export class OutsideTimetable extends Error {}
export interface PlanQuery { from: string; to: string; time?: string; arriveBy?: boolean; cursor?: string; numItineraries?: number }
export interface GeocodeHit extends Station { type: string; modes?: string[] }
export interface Transitous {
  geocode(text: string): Promise<GeocodeHit[]>
  plan(q: PlanQuery): Promise<Record<string, unknown>>
  trip(id: string): Promise<Record<string, unknown>>
  stoptimes(stopId: string, n?: number, radius?: number): Promise<Record<string, unknown>>
}
const ttl = { plan: 600, trip: 60, stoptimes: 120, geocode: 86400 }
const modes = 'HIGHSPEED_RAIL,LONG_DISTANCE'

export function createTransitous(opts: { fetch?: typeof fetch; storage?: Storage | null; cacheStorage?: Storage | null; now?: () => number; planCap?: number } = {}): Transitous {
  const request = opts.fetch ?? globalThis.fetch
  const now = opts.now ?? Date.now
  let storage = opts.storage
  if (storage === undefined) { try { storage = globalThis.localStorage } catch { storage = null } }
  let cacheStorage = opts.cacheStorage
  if (cacheStorage === undefined) { try { cacheStorage = globalThis.sessionStorage } catch { cacheStorage = null } }
  const memory = new Map<string, string>()
  const pending = new Map<string, Promise<unknown>>()
  function keys(store: Storage): string[] {
    return Array.from({ length: store.length }, (_, i) => store.key(i)).filter((key): key is string => key !== null)
  }
  function read(key: string, cache = false): string | null {
    try { return (cache ? cacheStorage : storage)?.getItem(key) ?? memory.get(key) ?? null }
    catch {
      if (cache) cacheStorage = null
      else storage = null
      return memory.get(key) ?? null
    }
  }
  function expired(value: string): boolean {
    try { return !(JSON.parse(value).expires_at > now()) } catch { return true }
  }
  function cacheResponse(key: string, body: unknown, seconds: number) {
    for (const [old, value] of memory) {
      if (old.startsWith('kurt.http.') && expired(value)) memory.delete(old)
    }
    const value = JSON.stringify({ expires_at: now() + seconds * 1000, body })
    memory.set(key, value)
    if (!cacheStorage) return
    try {
      for (const old of keys(cacheStorage)) {
        if (old.startsWith('kurt.http.') && expired(cacheStorage.getItem(old) ?? '')) cacheStorage.removeItem(old)
      }
      try { cacheStorage.setItem(key, value) }
      catch (error) {
        if (!(error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError')) throw error
        for (const old of keys(cacheStorage)) {
          if (old.startsWith('kurt.http.')) cacheStorage.removeItem(old)
        }
        cacheStorage.setItem(key, value)
      }
    } catch { cacheStorage = null }
  }
  function spend() {
    const key = `kurt.plan-budget.${berlinDate(new Date(now()).toISOString())}`
    for (const old of memory.keys()) {
      if (old.startsWith('kurt.plan-budget.') && old !== key) memory.delete(old)
    }
    try {
      if (storage) for (const old of keys(storage)) {
        if (old.startsWith('kurt.plan-budget.') && old !== key) storage.removeItem(old)
      }
    } catch { storage = null }
    const used = Number(read(key) ?? 0)
    if (used >= (opts.planCap ?? 60)) throw new BudgetSpent('limit reached for today')
    memory.set(key, String(used + 1))
    try { storage?.setItem(key, String(used + 1)) } catch { storage = null }
  }
  async function load(kind: keyof typeof ttl, path: string, params: Record<string, string | number | undefined>) {
    const entries = Object.entries(params).filter((x): x is [string, string | number] => x[1] !== undefined).sort(([a], [b]) => a.localeCompare(b))
    // Python's sorted JSON key format keeps the cache identity independent of query ordering.
    const identity = `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`
    const key = `kurt.http.${path}?${identity}`
    try {
      const cached = JSON.parse(read(key, true) ?? 'null')
      if (cached && cached.expires_at > now()) return cached.body
    } catch { /* Ignore damaged cache entries. */ }
    const existing = pending.get(key)
    if (existing) return existing
    const work = (async () => {
      const query = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))
      for (let attempt = 0; attempt < 2; attempt++) {
        if (kind === 'plan') {
          if (globalThis.navigator?.locks) {
            const error = await navigator.locks.request('kurt.plan-budget', () => {
              try { spend(); return null } catch (error) { return error }
            })
            if (error) throw error
          }
          else spend()
        }
        try {
          const response = await request(`https://api.transitous.org${path}?${query}`, { signal: AbortSignal.timeout(10_000) })
          if (kind === 'plan' && response.status === 400) {
            const body = await response.json().catch(() => ({}))
            const match = /^query time .+ is outside of loaded timetable window \[(\d{4}-\d{2}-\d{2}) [^,]+, (\d{4}-\d{2}-\d{2}) [^\[]+\[$/.exec(String(body.error ?? ''))
            if (match) {
              const last = new Date(Date.parse(`${match[2]}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10)
              throw new OutsideTimetable(`Timetables only cover ${match[1]} to ${last}. Pick a date in that range`)
            }
          }
          if (!response.ok) {
            if (response.status < 500 && response.status !== 429) throw new SourceUnavailable(`${path}: HTTP ${response.status}`)
            throw new Error(`HTTP ${response.status}`)
          }
          const body: unknown = await response.json()
          cacheResponse(key, body, ttl[kind])
          return body
        } catch (error) {
          if (error instanceof OutsideTimetable || error instanceof SourceUnavailable) throw error
          if (attempt === 1) throw new SourceUnavailable(`${path}: ${error instanceof Error ? error.name : 'Error'}`)
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    })()
    pending.set(key, work)
    try { return await work } finally { pending.delete(key) }
  }
  return {
    geocode: text => load('geocode', '/api/v1/geocode', { text }) as Promise<GeocodeHit[]>,
    plan: q => load('plan', '/api/v1/plan', { fromPlace: q.from, toPlace: q.to, time: q.time, arriveBy: q.arriveBy ? 'true' : undefined, pageCursor: q.cursor, numItineraries: q.numItineraries, transitModes: modes }) as Promise<Record<string, unknown>>,
    trip: id => load('trip', '/api/v1/trip', { tripId: id }) as Promise<Record<string, unknown>>,
    stoptimes: (stopId, n = 40, radius = 200) => load('stoptimes', '/api/v1/stoptimes', { stopId, n, radius, mode: modes }) as Promise<Record<string, unknown>>,
  }
}
export async function stationsSearch(tr: Transitous, q: string): Promise<Station[]> {
  if (q.trim().length < 2) return []
  return (await tr.geocode(q.trim())).filter(r => r.type === 'STOP' && r.modes?.some(m => ['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_RAIL'].includes(m)))
    .map(({ id, name, lat, lon }) => ({ id, name, lat, lon }))
}
