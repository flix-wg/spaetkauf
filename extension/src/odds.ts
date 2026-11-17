import type { Leg, Pick } from '../../frontend/src/api'
import { berlinLocal, weekdayBerlin, zonedToUtc } from '../../frontend/src/core/berlin.ts'
import { LONG_DISTANCE_TYPES, parseTrain } from '../../frontend/src/core/matching.ts'
import { connectionOdds, onTimeOdds, WEEKDAYS } from '../../frontend/src/core/odds.ts'
import type { Leg as OddsLeg, Odds, Scope } from '../../frontend/src/core/odds'
import { httpOddsSource } from '../../frontend/src/core/oddsSource.ts'
import type { OddsSource } from '../../frontend/src/core/oddsSource'
import { fetchPages, fillNames, resolve, rideInstead } from '../../frontend/src/core/picks.ts'
import { createTransitous } from '../../frontend/src/core/transitous.ts'
import type { Transitous } from '../../frontend/src/core/transitous'

export { createTransitous, httpOddsSource }
export interface Connection { dep: string; arr: string; trains: string[]; date?: string | null; posted?: boolean }
export interface OddsRequest { from?: string | null; to: string; to_eva?: string | null; date: string; connections: Connection[]; on_time?: boolean; on_time_scope?: Scope }
export interface Result extends Omit<Odds, 'basis'> { i: number; basis: Odds['basis'] | 'last_train'; train: string | null; kurt: boolean; on_time?: number; on_time_runs?: number; on_time_n?: number; on_time_scope?: Scope;
  on_time_late?: [number, number | null] | null; on_time_late_runs?: number; on_time_late_scope?: Scope;
  on_time_route?: { from: string; to: string; trains: number }; on_time_route_fallback?: boolean }
export interface OddsResponse { to: string; date: string; kurt: number | null; link: string; results: Result[] }

const TRANSIT_WAIT = 4000
const KURT_MIN_P20 = 0.30
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
const quotePlus = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+')
const optional = <T>(work: Promise<T>) => work.catch(() => null)

function valid(body: OddsRequest): boolean {
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
  return text(body.to, 80) && body.to.length > 0 && (body.from == null || text(body.from, 80)) &&
    (body.to_eva == null || /^\d{6,9}$/.test(body.to_eva)) && (body.on_time == null || typeof body.on_time === 'boolean') &&
    (body.on_time_scope == null || ['weekday', 'all', 'route'].includes(body.on_time_scope)) && text(body.date, 10) && DAY.test(body.date) &&
    Array.isArray(body.connections) && body.connections.length <= 30 && body.connections.every(c =>
      CLOCK.test(c.dep) && CLOCK.test(c.arr) && (c.date == null || DAY.test(c.date)) &&
      Array.isArray(c.trains) && c.trains.length <= 12 && c.trains.every(t => text(t, 20)))
}

// Transitous legs for the page's route, keyed by local departure and last train, so a change counts
// as in the app. Empty without a start station, or when Transitous fails or takes over TRANSIT_WAIT.
async function routeLegs(tr: Transitous, body: OddsRequest): Promise<Map<string, Leg[]>> {
  const out = new Map<string, Leg[]>()
  if (!body.from || !body.connections.length) return out
  const first = body.connections.reduce((a, c) => {
    const ka = a.date || body.date, kc = c.date || body.date
    return kc < ka || (kc === ka && c.dep < a.dep) ? c : a
  })
  const day = first.date || body.date
  const look = async () => {
    const [src, srcName] = await resolve(tr, body.from!)
    const [dst, dstName] = await resolve(tr, body.to)
    const [found] = await fetchPages(tr, src, dst, zonedToUtc(day, first.dep), day)
    for (const p of found) {
      fillNames(p.legs, srcName || body.from!, dstName || body.to)
      const last = parseTrain(p.legs.at(-1)!.train)
      const key = `${berlinLocal(p.dep).slice(11, 16)} ${last?.join(' ')}`
      if (last && !out.has(key)) out.set(key, p.legs)
    }
    return out
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<Map<string, Leg[]>>(done => { timer = setTimeout(() => done(new Map()), TRANSIT_WAIT) })
  // Any failure keeps the last train's odds.
  try { return await Promise.race([look().catch(() => new Map<string, Leg[]>()), late]) }
  finally { clearTimeout(timer) }
}

export async function extensionOdds(body: OddsRequest, deps: { odds: OddsSource; tr: Transitous }): Promise<OddsResponse> {
  if (!valid(body)) throw new Error('Invalid odds request')
  const { odds, tr } = deps
  const byRoute = await routeLegs(tr, body)
  let stop = body.to
  if (body.to_eva) stop = (await optional(odds.index()))?.eva_names[body.to_eva] || stop
  const page: Pick[] = []
  const results = await Promise.all(body.connections.map(async (connection, i): Promise<Result> => {
    const day = connection.date || body.date
    const dep = zonedToUtc(day, connection.dep).toISOString()
    const arr = zonedToUtc(connection.arr <= connection.dep ? nextDay(day) : day, connection.arr).toISOString()
    const result: Result = { i, p20: null, p60: null, n: null, late: null, weekday: WEEKDAYS[weekdayBerlin(arr)], basis: 'none', train: null, kurt: false }
    const trains = connection.trains.map(t => parseTrain(t.replace(/(?<=[A-Za-z])(?=\d)/g, ' ')))
    const names = trains.map((t, j) => t ? t.join(' ') : connection.trains[j])
    page[i] = ({ id: String(i), dep, arr, changes: names.length - 1, cancelled: !!connection.posted,
      legs: names.map(n => ({ trip_id: `${day}:${n}`, train: n, from: '', to: '' })) } as unknown as Pick)
    const last = trains.at(-1)
    if (last && LONG_DISTANCE_TYPES.includes(last[0])) {
      const train = last.join(' ')
      // Only a direct train boards at the page's start; a change's boarding stop comes from Transitous.
      let counted: OddsLeg[] = [{ train, to: stop, dep, arr, ...(trains.length === 1 && body.from ? { from: body.from } : {}) }]
      const history = await optional(connectionOdds(odds, counted))
      if (history) Object.assign(result, history)
      if (result.p20 !== null) Object.assign(result, { train, basis: trains.length === 1 ? 'history' : 'last_train' })
      const legs = byRoute.get(`${connection.dep} ${train}`)
      if (result.p20 !== null && legs && legs.length > 1) {
        const both = await optional(connectionOdds(odds, legs))
        if (both && both.p20 !== null) {
          Object.assign(result, both, { train }) // basis "estimate", the same number as the app
          counted = legs
        }
      }
      // Only on request, so the default response stays the app's.
      if (body.on_time && result.p20 !== null) {
        const onTime = await optional(onTimeOdds(odds, counted, body.on_time_scope ?? 'all'))
        if (onTime) Object.assign(result, { on_time: onTime.p, on_time_runs: onTime.runs, on_time_n: onTime.n, on_time_scope: onTime.scope,
          on_time_late: onTime.late, on_time_late_runs: onTime.lateRuns, on_time_late_scope: onTime.lateScope,
          ...(onTime.route ? { on_time_route: onTime.route } : {}), ...(onTime.routeFallback ? { on_time_route_fallback: true } : {}) })
      }
    }
    return result
  }))
  // Same rule as the app: a pick needs another train on this page to switch to.
  const eligible = results.filter(r => !body.connections[r.i].posted && r.p20 !== null && r.p20 >= KURT_MIN_P20 && rideInstead(page[r.i], page))
  const kurt = eligible.length ? eligible.reduce((best, r) => r.p20! > best.p20! ? r : best).i : null
  if (kurt !== null) results[kurt].kurt = true
  const selected = body.connections[kurt ?? 0]
  const params: [string, string][] = [['tn', body.to], ['date', selected?.date || body.date], ['time', selected?.dep ?? '00:00']]
  if (body.from) params.push(['from', body.from], ['to', body.to], ['fn', body.from])
  const link = (body.from ? '/picks?' : '/?') + params.map(([k, v]) => `${k}=${quotePlus(v)}`).join('&')
  return { to: body.to, date: body.date, kurt, link, results }
}
