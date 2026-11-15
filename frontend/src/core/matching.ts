import { GE_COLUMNS } from './oddsSource.ts'
import type { OddsSource, Rates } from './oddsSource'

export const LONG_DISTANCE_TYPES = ['ICE', 'IC', 'EC', 'ECE', 'EN', 'NJ', 'RJ', 'RJX', 'FLX', 'TGV', 'WB', 'ES', 'EST', 'EUR', 'D']
export const MIN_RUNS = 10
const DROP = new Set(['hbf', 'hauptbahnhof', 'bahnhof', 'bf', 'am', 'tief'])
const SPELL: Record<string, string> = { m: 'main', fernbf: 'fernbahnhof' }
const FAMILIES = [['ICE', 'IC'], ['EC', 'ECE'], ['RJ', 'RJX'], ['EN', 'NJ']]
export type Counts = Rates & { n: number; n_cancel: number }
export type MatchedStats = Counts & {
  status: 'ok' | 'thin'; train_type: string; train_number: string; station_key: string;
  match: 'exact' | 'alias'; weekday: number; type_fallback: boolean;
  first_date: string | null; last_date: string | null; eva: string | null; station_name: string | null;
}
export type Stats = MatchedStats
  | { status: 'unknown_train'; train_type: string; train_number: string }
  | { status: 'stop_not_matched'; train_type: string; train_number: string; stop_key: string; known_keys: string[] }

export function parseTrain(s: string | null): [string, string] | null {
  const match = /^\s*([A-Za-z]+)\s+0*(\d+)\s*$/.exec(s ?? '')
  return match ? [match[1].toUpperCase(), match[2]] : null
}

export function stationTokens(name: string): string[] {
  const folded = (name || '').normalize('NFC').toLowerCase()
    .replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c]!)
    .replace(/\bs\s*\+\s*u\b/g, ' ').replace(/\s*\([a-z]{2}\)\s*$/, '')
  return [...new Set(folded.split(/[^0-9a-z]+/).filter(t => t && !DROP.has(t)).map(t => SPELL[t] ?? t))].sort()
}
export function stationKey(name: string): string { return stationTokens(name).join(' ') }
export function typeFamily(t: string): Set<string> { return new Set(FAMILIES.find(f => f.includes(t)) ?? [t]) }

export async function findStats(src: OddsSource, type: string, number: string, stop: string, weekday: number): Promise<Stats> {
  number = /^\d+$/.test(number) ? BigInt(number).toString() : number
  let foundType = type
  const types = (await src.index()).numbers[number] ?? []
  let shard = types.includes(type) ? await src.train(type, number) : null
  if (!shard?.rows.length) {
    const family = typeFamily(type)
    const alternatives = types.filter(t => t !== type && family.has(t))
    if (alternatives.length !== 1) return { status: 'unknown_train', train_type: type, train_number: number }
    foundType = alternatives[0]
    shard = await src.train(foundType, number)
  }
  const rows = shard?.rows ?? []
  const keys = [...new Set(rows.map(r => r[0]))]
  const stopKey = stationKey(stop)
  const alias = ({ frankfurt: 'frankfurt main', 'an brandenburg der havel': 'brandenburg' } as Record<string, string>)[stopKey]
  const key = keys.includes(stopKey) ? stopKey : keys.includes(alias) ? alias : null
  if (key === null) return { status: 'stop_not_matched', train_type: foundType, train_number: number, stop_key: stopKey, known_keys: keys.sort() }
  const selected = rows.filter(r => r[0] === key && r[3] === weekday)
  const sum = (index: number) => selected.reduce((total, row) => total + (row[index] as number), 0)
  const counts = Object.fromEntries(['n', 'n_cancel', ...GE_COLUMNS].map((name, i) => [name, sum(i + 4)])) as Counts
  return {
    ...counts, first_date: selected.map(r => r[15]).sort()[0] ?? null,
    last_date: selected.map(r => r[16]).sort().at(-1) ?? null,
    eva: selected.length ? [...new Set(selected.map(r => r[1]))].join(',') : null,
    station_name: selected.map(r => r[2]).sort()[0] ?? null,
    train_type: foundType, train_number: number, station_key: key,
    match: key === stopKey ? 'exact' : 'alias', weekday, type_fallback: foundType !== type,
    status: counts.n >= MIN_RUNS ? 'ok' : 'thin',
  }
}
