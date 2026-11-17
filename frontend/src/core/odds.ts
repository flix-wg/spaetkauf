import { GE_COLUMNS } from './oddsSource.ts'
import type { OddsSource, Rates, TrainRow } from './oddsSource'
import { findStats, parseTrain } from './matching.ts'
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

export const LATE_MIN_RUNS = 10
export interface OnTime { p: number; runs: number; late: [number, number | null] | null; lateRuns: number }

// Bucket that holds the median delay of the 5+ min late runs, over all weekdays, without cancellations.
// The files only count runs at each bucket, so the answer is a band; null with too few late runs.
export function lateBand(rows: TrainRow[]): [[number, number | null] | null, number] {
  const cancelled = rows.reduce((total, row) => total + row[5], 0)
  const ge = BUCKETS.map((_, i) => rows.reduce((total, row) => total + (row[i + 6] as number), 0) - cancelled)
  if (ge[0] < LATE_MIN_RUNS) return [null, ge[0]]
  const i = ge.findIndex(count => count < ge[0] / 2)
  return [i === -1 ? [BUCKETS.at(-1)!, null] : [BUCKETS[i - 1], BUCKETS[i]], ge[0]]
}

// Chance to reach the last stop under 5 min late; a missed change counts as late.
// `runs` (on-time runs on that weekday) and the late band are the last train's own.
export async function onTimeOdds(src: OddsSource, legs: Leg[], m = SHRINK_M): Promise<OnTime | null> {
  const parts = await reach(src, legs, m)
  if (!parts) return null
  const [share, end] = parts
  const shard = await src.train(end.train_type, end.train_number)
  const [late, lateRuns] = lateBand(shard!.rows.filter(row => row[0] === end.station_key))
  return { p: round4(share * (1 - rate(end, 5, m))), runs: end.n - end.ge5, late, lateRuns }
}
