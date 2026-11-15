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

export function createTransitous(opts: { fetch?: typeof fetch; storage?: Storage | null; now?: () => number; planCap?: number } = {}): Transitous {
  const request = opts.fetch ?? globalThis.fetch
  const now = opts.now ?? Date.now
  let storage = opts.storage
  if (storage === undefined) { try { storage = globalThis.localStorage } catch { storage = null } }
  const memory = new Map<string, string>()
  const pending = new Map<string, Promise<unknown>>()
  function read(key: string): string | null {
    try { return storage?.getItem(key) ?? memory.get(key) ?? null } catch { storage = null; return memory.get(key) ?? null }
  }
  function write(key: string, value: string) {
    memory.set(key, value)
    try { storage?.setItem(key, value) } catch { storage = null }
  }
  function spend() {
    const key = `kurt.plan-budget.${berlinDate(new Date(now()).toISOString())}`
    const used = Number(read(key) ?? 0)
    if (used >= (opts.planCap ?? 60)) throw new BudgetSpent('limit reached for today')
    write(key, String(used + 1))
  }
  async function load(kind: keyof typeof ttl, path: string, params: Record<string, string | number | undefined>) {
    const entries = Object.entries(params).filter((x): x is [string, string | number] => x[1] !== undefined).sort(([a], [b]) => a.localeCompare(b))
    // Python's sorted JSON key format keeps the cache identity independent of query ordering.
    const identity = `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`
    const key = `kurt.http.${path}?${identity}`
    try {
      const cached = JSON.parse(read(key) ?? 'null')
      if (cached && now() - cached.fetched_at < ttl[kind] * 1000) return cached.body
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
          write(key, JSON.stringify({ fetched_at: now(), body }))
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
