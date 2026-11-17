import { GE_COLUMNS } from './oddsSource.ts'
import type { OddsSource, Rates, RouteRow, TrainRow } from './oddsSource'
import { findStats, MIN_RUNS, parseTrain, STATION_ALIASES, stationKey } from './matching.ts'
import type { MatchedStats, Stats } from './matching'
import { weekdayBerlin } from './berlin.ts'

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export const SHRINK_M = 50
export const BUCKETS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const
export const CHANGE_MARGIN_MIN = 2
export interface Leg { train: string; to: string; dep: string; arr: string; from?: string; trip_id?: string }
export interface Odds {
  p20: number | null; p60: number | null; late: number | null; n: number | null;
  weekday: typeof WEEKDAYS[number]; basis: 'none' | 'history' | 'estimate';
}
type HistoryStats = MatchedStats & { parent: Rates & { n: number }; type_rates: Rates }

export function round4(x: number): number {
  // Exact binary halfway values need Python's ties-to-even rule.
  if (Number.isInteger(x * 32) && Math.abs((x * 32) % 2) === 1) {
    const lower = Math.floor(x * 1e4)
    return (lower % 2 === 0 ? lower : lower + 1) / 1e4
  }
  return Number(x.toFixed(4))
}

export function bucketAtOrBelow(minutes: number): number {
  return BUCKETS.filter(b => b <= minutes).at(-1) ?? BUCKETS[0]
}
export function shrink(k: number, n: number, pParent: number, m: number): number {
  return (k + m * pParent) / (n + m)
}
export function shrunkRate(k: number, n: number, parentK: number, parentN: number, typeRate: number, m: number): number {
  return shrink(k, n, shrink(parentK, parentN, typeRate, m), m)
}
export function rate(stats: HistoryStats, threshold: number, m: number): number {
  const col = `ge${threshold}` as keyof Rates
  return shrunkRate(stats[col], stats.n, stats.parent[col], stats.parent.n, stats.type_rates[col], m)
}

export async function legOdds(src: OddsSource, train: string, stop: string, arr: string): Promise<Stats | HistoryStats | { status: 'no_train_number' }> {
  const parsed = parseTrain(train)
  if (!parsed) return { status: 'no_train_number' }
  const stats = await findStats(src, parsed[0], parsed[1], stop, weekdayBerlin(arr))
  if (stats.status !== 'ok') return stats
  const shard = await src.train(stats.train_type, stats.train_number)
  const rows = shard!.rows.filter(row => row[0] === stats.station_key)
  const parent = {
    n: rows.reduce((total, row) => total + row[4], 0),
    ...Object.fromEntries(GE_COLUMNS.map((col, i) => [col, rows.reduce((total, row) => total + (row[i + 6] as number), 0)])),
  } as Rates & { n: number }
  return { ...stats, parent, type_rates: (await src.index()).type_rates[stats.train_type] }
}

function upper(stats: HistoryStats, threshold: number, m: number): number {
  return Math.max(rate(stats, threshold, m), rate(stats, threshold, 0))
}

async function reach(src: OddsSource, legs: Leg[], m: number, rateFn = rate): Promise<[number, HistoryStats] | null> {
  const stats = await Promise.all(legs.map(leg => legOdds(src, leg.train, leg.to, leg.arr)))
  if (stats.some(s => s.status !== 'ok')) return null
  const history = stats as HistoryStats[]
  let share = 1
  for (let i = 0; i < legs.length - 1; i++) {
    const change = (Date.parse(legs[i + 1].dep) - Date.parse(legs[i].arr)) / 60_000
    share *= 1 - rateFn(history[i], bucketAtOrBelow(change - CHANGE_MARGIN_MIN), m)
  }
  return [share, history[history.length - 1]]
}

export async function missOdds(src: OddsSource, legs: Leg[], spareMin: number, m = SHRINK_M): Promise<number | null> {
  const parts = await reach(src, legs, m, upper)
  if (!parts) return null
  if (spareMin < BUCKETS[0]) return 1
  const [share, end] = parts
  return round4(1 - share * (1 - upper(end, bucketAtOrBelow(spareMin), m)))
}

export async function connectionOdds(src: OddsSource, legs: Leg[], m = SHRINK_M): Promise<Odds> {
  const last = legs[legs.length - 1]
  const out: Odds = { p20: null, p60: null, late: null, n: null, weekday: WEEKDAYS[weekdayBerlin(last.arr)], basis: 'none' }
  const parts = await reach(src, legs, m)
  if (!parts) return out
  const [share, end] = parts
  return { ...out, p20: round4(1 - share * (1 - rate(end, 20, m))), p60: round4(rate(end, 60, m)),
    late: end.ge20, n: end.n, basis: legs.length === 1 ? 'history' : 'estimate' }
}

export type Scope = 'weekday' | 'all' | 'route'
type Band = [number, number | null]
export interface Route { from: string; to: string; trains: number }
// scope is what was counted: a route without enough runs falls back to 'all' with routeFallback.
export interface OnTime {
  p: number; runs: number; n: number; scope: Scope; late: Band | null; lateRuns: number; lateScope: Scope;
  route?: Route; routeFallback?: boolean
}

// Bucket that holds the median delay of the 5+ min late runs, without cancellations.
// The files only count runs at each bucket, so the answer is a band; null with too few late runs.
// When exactly half the runs reach a bucket, the median straddles it and the band covers both sides.
export function lateBand(rows: TrainRow[]): [Band | null, number] {
  const sum = (i: number) => rows.reduce((total, row) => total + (row[i] as number), 0)
  return band(sum(5), BUCKETS.map((_, i) => sum(i + 6)))
}
function band(cancelled: number, counts: number[]): [Band | null, number] {
  const ge = counts.map(count => count - cancelled)
  if (ge[0] < MIN_RUNS) return [null, ge[0]]
  const low = ge.findIndex(count => count <= ge[0] / 2)
  const high = ge.findIndex(count => count < ge[0] / 2)
  return [[low === -1 ? BUCKETS.at(-1)! : BUCKETS[low - 1], high === -1 ? null : BUCKETS[high]], ge[0]]
}

// All-days counts as the stats, shrunk straight to the type rate.
const NO_PARENT = { n: 0, ...Object.fromEntries(GE_COLUMNS.map(col => [col, 0])) } as Rates & { n: number }
const allDays = (s: HistoryStats): HistoryStats => ({ ...s, ...s.parent, parent: NO_PARENT })

// All runs of every train from `from` to the stop key, summed over the weekdays; null without a file or pair.
export async function routeCounts(src: OddsSource, from: string, toKey: string): Promise<{ n: number; cancelled: number; ge: number[]; trains: number } | null> {
  const key = stationKey(from)
  for (const candidate of [key, STATION_ALIASES[key]]) {
    const route = candidate && src.route ? (await src.route(candidate))?.[toKey] : undefined
    if (!route) continue
    const sum = (i: number) => route.rows.reduce((total: number, row: RouteRow) => total + row[i], 0)
    return { n: sum(1), cancelled: sum(2), ge: BUCKETS.map((_, i) => sum(i + 3)), trains: route.trains }
  }
  return null
}

// Chance to reach the last stop under 5 min late; a missed change counts as late.
// A matched weekday always has MIN_RUNS runs (findStats), so the weekday scope needs no fallback for p.
// The weekday late band falls back to all weekdays below MIN_RUNS late runs.
// The route scope counts every train from the last leg's boarding stop (`from`) to the stop, all days;
// without MIN_RUNS runs there it is this train on all days, and its late band falls back the same way.
export async function onTimeOdds(src: OddsSource, legs: Leg[], scope: Scope = 'all', m = SHRINK_M): Promise<OnTime | null> {
  if (scope === 'route') {
    const from = legs[legs.length - 1].from
    const parts = await reach(src, legs, m, (s, t, k) => rate(allDays(s), t, k))
    if (!parts) return null
    const [share, last] = parts
    const route = from ? await routeCounts(src, from, last.station_key).catch(() => null) : null
    if (!from || !route || route.n < MIN_RUNS) {
      const base = await onTimeOdds(src, legs, 'all', m)
      return base && { ...base, routeFallback: true }
    }
    let [late, lateRuns] = band(route.cancelled, route.ge)
    let lateScope: Scope = 'route'
    if (!late) {
      [late, lateRuns] = lateBand((await src.train(last.train_type, last.train_number))!.rows.filter(row => row[0] === last.station_key))
      lateScope = 'all'
    }
    return { p: round4(share * (1 - shrink(route.ge[0], route.n, last.type_rates.ge5, m))), runs: route.n - route.ge[0], n: route.n,
      scope, late, lateRuns, lateScope, route: { from, to: legs[legs.length - 1].to, trains: route.trains } }
  }
  const parts = await reach(src, legs, m, scope === 'all' ? (s, t, k) => rate(allDays(s), t, k) : rate)
  if (!parts) return null
  const [share, last] = parts
  const end = scope === 'all' ? allDays(last) : last
  const rows = (await src.train(last.train_type, last.train_number))!.rows.filter(row => row[0] === last.station_key)
  let lateScope = scope
  let [late, lateRuns] = lateBand(scope === 'weekday' ? rows.filter(row => row[3] === last.weekday) : rows)
  if (!late && scope === 'weekday') {
    [late, lateRuns] = lateBand(rows)
    lateScope = 'all'
  }
  return { p: round4(share * (1 - rate(end, 5, m))), runs: end.n - end.ge5, n: end.n, scope, late, lateRuns, lateScope }
}
