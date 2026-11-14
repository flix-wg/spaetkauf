import { ApiError, type HistoryRuns, type Pick, type RouteTrains, type TrainStops } from '../api'
import { WEEKDAYS } from '../format'
import { at } from './fixtures'

const SOURCE = 'Deutsche Bahn arrival data via piebro/deutsche-bahn-data, CC BY 4.0'
const LAST_DAY = '2026-11-13'

// Same numbers every time for the same key, so screenshots are stable.
function rng(key: string) {
  let h = 2166136261
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}
const weekdayOf = (date: string) => WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

// mode=arrive: two late-ok picks within the cap (one is Kurt's), one over the cap, one already posted, two on time.
export function arrivePicksFor(date: string, from: string, to: string, by: string): Pick[] {
  const weekday = weekdayOf(date)
  const mk = (
    id: string, spare: number, dur: number, trains: string[], p20: number, late: number, n: number,
    p_miss: number | null, o: Partial<Pick> = {},
  ): Pick => {
    const dep = at(date, by, 0, -spare - dur)
    const arr = at(date, by, 0, -spare)
    const mid = at(date, by, 0, -spare - Math.round(dur / 2))
    const legs = trains.length === 1
      ? [{ train: trains[0], from, to, dep, arr, trip_id: `${id}-1` }]
      : [
          { train: trains[0], from, to: 'Kassel-Wilhelmshöhe', dep, arr: mid, trip_id: `${id}-1` },
          { train: trains[1], from: 'Kassel-Wilhelmshöhe', to, dep: at(date, by, 0, -spare - Math.round(dur / 2) + 12), arr, trip_id: `${id}-2` },
        ]
    return {
      id, dep, arr, duration_min: dur, changes: trains.length - 1, legs,
      odds: { p20, p60: Math.round(p20 * 30) / 100, late, n, weekday, basis: trains.length > 1 ? 'estimate' : 'history' },
      already_posted: false, is_kurts_pick: false, ride_instead: null,
      bahn_url: `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=${encodeURIComponent(from)}&zo=${encodeURIComponent(to)}&hd=${date}&n=${id}`,
      spare_min: spare, p_miss,
      late_ok: { unlock: spare >= 20, refund25: spare >= 60, refund50: spare >= 120 },
      group: spare >= 20 ? 'late_ok' : 'on_time',
      ...o,
    }
  }
  return [
    mk('a2', 67, 362, ['ICE 1105'], 0.52, 16, 31, 0.04, { is_kurts_pick: true }),
    mk('a1', 128, 364, ['ICE 1103'], 0.44, 13, 30, 0.02),
    mk('a6', 26, 371, ['ICE 1581'], 0.4, 12, 30, 0.09, { already_posted: true }),
    mk('a3', 34, 377, ['ICE 1583', 'ICE 879'], 0.58, 17, 29, 0.14),
    mk('a5', 3, 360, ['ICE 1109'], 0.35, 11, 31, 1),
    mk('a4', 12, 366, ['ICE 1107'], 0.29, 9, 31, 0.21),
  ]
}

// mock.history=none: 404 (no such train or stop), =down: 503 (history file missing).
function gate(mode: string, what: string) {
  if (mode === 'none') throw new ApiError(404, `No history for ${what}.`)
  if (mode === 'down') throw new ApiError(503, 'Run history unavailable.')
}
function trainName(train: string) {
  const m = train.trim().match(/^([A-Za-z]+)\s*(\d+)$/)
  if (!m) throw new ApiError(404, `'${train}' is not a train like 'ICE 1103'.`)
  return `${m[1].toUpperCase()} ${m[2]}`
}

export function historyRuns(q: URLSearchParams, mode: string): HistoryRuns {
  const train = trainName(q.get('train') ?? '')
  gate(mode, train)
  const stop = q.get('stop') ?? ''
  const wd = q.get('weekday')
  const r = rng(`${train}|${stop}|${wd}`)
  const hm = `${String(10 + Math.floor(r() * 12)).padStart(2, '0')}:${String(Math.floor(r() * 12) * 5).padStart(2, '0')}`
  const lateShare = 0.3 + r() * 0.25
  let last = LAST_DAY
  if (wd !== null) while (weekdayOf(last) !== WEEKDAYS[Number(wd)]) last = shift(last, -1)
  const runs = Array.from({ length: wd === null ? 140 : 46 }, (_, i) => {
    const date = shift(last, -(wd === null ? i : i * 7))
    const x = r()
    const cancelled = x < 0.03
    const delay = cancelled ? null : x < lateShare ? 20 + Math.floor(r() * (r() < 0.35 ? 110 : 40)) : Math.floor(r() * 19) - 2
    return { date, planned: at(date, hm), delay_min: delay, cancelled }
  })
  const late = (m: number) => runs.filter((x) => x.cancelled || (x.delay_min ?? 0) >= m).length
  return {
    train, stop, weekday: wd === null ? null : WEEKDAYS[Number(wd)], runs,
    summary: { n: runs.length, late20: late(20), late60: late(60), late120: late(120), cancelled: runs.filter((x) => x.cancelled).length },
    source: SOURCE,
  }
}

const LINE = ['Hamburg Hbf', 'Hannover Hbf', 'Göttingen', 'Kassel-Wilhelmshöhe', 'Fulda', 'Frankfurt(Main)Hbf', 'Würzburg Hbf', 'Nürnberg Hbf', 'München Hbf']

export function trainStops(q: URLSearchParams, mode: string): TrainStops {
  const train = trainName(q.get('train') ?? '')
  gate(mode, train)
  const r = rng(train)
  const n = 260 + Math.floor(r() * 60)
  const stops = LINE.map((stop, i) => {
    const late20 = Math.round(n * (0.05 + i * 0.045 + r() * 0.05))
    return { stop, key: stop.toLowerCase(), n, late20, late20_share: Math.round((late20 / n) * 10000) / 10000 }
  }).sort((a, b) => a.stop.localeCompare(b.stop))
  return { train, weekday: null, stops, source: SOURCE }
}

export function routeTrains(q: URLSearchParams, mode: string): RouteTrains {
  const from = q.get('from') ?? ''
  const to = q.get('to') ?? ''
  gate(mode, `${from} → ${to}`)
  const wd = q.get('weekday')
  const r = rng(`${from}|${to}|${wd}`)
  const trains = ['ICE 1101', 'ICE 1103', 'ICE 1105', 'ICE 1107', 'ICE 1109', 'ICE 1583', 'IC 2083', 'ICE 1111'].map((train, i) => {
    const n = wd === null ? 240 + Math.floor(r() * 80) : 34 + Math.floor(r() * 12)
    const l20 = Math.round(n * (0.15 + r() * 0.4))
    const l60 = Math.round(l20 * (0.15 + r() * 0.2))
    const dep = 6 * 60 + 24 + i * 120
    const arr = dep + 362 + Math.floor(r() * 20)
    const h = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    return {
      train, n, dep: h(dep), arr: h(arr), late20: l20, late20_share: Math.round((l20 / n) * 10000) / 10000,
      late60: l60, late60_share: Math.round((l60 / n) * 10000) / 10000, median_delay_min: Math.round(r() * 180) / 10,
    }
  })
  return { from, to, weekday: wd === null ? null : WEEKDAYS[Number(wd)], trains, source: SOURCE }
}
