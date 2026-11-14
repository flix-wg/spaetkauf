import type { Alternative, Backtest, Claim, LateNow, Pick, Station, Trip } from '../api'
import { MIN_PAYOUT, payout } from '../payout'

const TZ = 'Europe/Berlin'

function offsetMs(utc: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(utc))
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - utc
}

// "17:24" on a Berlin calendar day (plus optional day shift) as an ISO UTC string
export function at(date: string, hm: string, plusDays = 0, plusMin = 0) {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d + plusDays, h, mi + plusMin)
  return new Date(guess - offsetMs(guess)).toISOString()
}

export const STATIONS: Station[] = [
  ['8002549', 'Hamburg Hbf', 53.553, 10.006], ['8000261', 'München Hbf', 48.140, 11.558],
  ['8011160', 'Berlin Hbf', 52.525, 13.369], ['8000207', 'Köln Hbf', 50.943, 6.959],
  ['8000105', 'Frankfurt(Main)Hbf', 50.107, 8.663], ['8000152', 'Hannover Hbf', 52.376, 9.741],
  ['8000096', 'Stuttgart Hbf', 48.784, 9.182], ['8000284', 'Nürnberg Hbf', 49.446, 11.083],
  ['8010205', 'Leipzig Hbf', 51.345, 12.381], ['8000191', 'Karlsruhe Hbf', 48.993, 8.401],
  ['8000244', 'Mannheim Hbf', 49.479, 8.469], ['8000085', 'Düsseldorf Hbf', 51.220, 6.794],
  ['8000013', 'Augsburg Hbf', 48.365, 10.886], ['8000050', 'Bremen Hbf', 53.083, 8.813],
  ['8010085', 'Dresden Hbf', 51.040, 13.732], ['8000036', 'Dortmund Hbf', 51.518, 7.459],
  ['8000128', 'Göttingen', 51.536, 9.926], ['8003200', 'Kassel-Wilhelmshöhe', 51.313, 9.447],
].map(([id, name, lat, lon]) => ({ id, name, lat, lon }) as Station)

export function picksFor(date: string, from: string, to: string): Pick[] {
  const bahn = (n: number) =>
    `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=${encodeURIComponent(from)}&zo=${encodeURIComponent(to)}&hd=${date}&n=${n}`
  const leg = (train: string, f: string, t: string, dep: string, arr: string, id: string, dd = 0, ad = 0) => ({
    train, from: f, to: t, dep: at(date, dep, dd), arr: at(date, arr, ad), trip_id: id,
  })
  return [
    {
      id: 'p1', dep: at(date, '17:24'), arr: at(date, '23:28'), duration_min: 364, changes: 1,
      legs: [
        leg('ICE 1583', from, 'Kassel-Wilhelmshöhe', '17:24', '20:12', 'l1'),
        leg('ICE 879', 'Kassel-Wilhelmshöhe', to, '20:25', '23:28', 'l2'),
      ],
      odds: { p20: 0.63, p60: 0.17, late: 19, n: 30, weekday: 'Friday', basis: 'history' },
      already_posted: false, is_kurts_pick: true,
      ride_instead: { dep: at(date, '17:54'), arr: at(date, '23:05'), changes: 0, trains: ['ICE 1105'], delta_arr_min: -23 },
      bahn_url: bahn(1),
    },
    {
      id: 'p2', dep: at(date, '18:24'), arr: at(date, '00:31', 1), duration_min: 367, changes: 1,
      legs: [
        leg('ICE 1585', from, 'Würzburg Hbf', '18:24', '21:41', 'l3'),
        leg('ICE 783', 'Würzburg Hbf', to, '21:52', '00:31', 'l4', 0, 1),
      ],
      odds: { p20: 0.47, p60: 0.11, late: 9, n: 31, weekday: 'Friday', basis: 'estimate' },
      already_posted: false, is_kurts_pick: false,
      ride_instead: { dep: at(date, '18:54'), arr: at(date, '00:45', 1), changes: 1, trains: ['ICE 1107', 'ICE 591'], delta_arr_min: 14 },
      bahn_url: bahn(2),
    },
    {
      id: 'p3', dep: at(date, '13:24'), arr: at(date, '19:28'), duration_min: 364, changes: 0,
      legs: [leg('ICE 1103', from, to, '13:24', '19:28', 'l5')],
      odds: { p20: 0.31, p60: 0.06, late: 9, n: 29, weekday: 'Friday', basis: 'history' },
      already_posted: false, is_kurts_pick: false,
      ride_instead: { dep: at(date, '13:54'), arr: at(date, '19:23'), changes: 0, trains: ['ICE 1105'], delta_arr_min: -5 },
      bahn_url: bahn(3),
    },
    {
      id: 'p4', dep: at(date, '15:24'), arr: at(date, '21:41'), duration_min: 377, changes: 1,
      legs: [
        leg('ICE 1581', from, 'Frankfurt(Main)Hbf', '15:24', '19:02', 'l6'),
        leg('ICE 595', 'Frankfurt(Main)Hbf', to, '19:30', '21:41', 'l7'),
      ],
      odds: { p20: 0.52, p60: 0.14, late: 16, n: 31, weekday: 'Friday', basis: 'history' },
      already_posted: true, is_kurts_pick: false, ride_instead: null, bahn_url: bahn(4),
    },
    {
      id: 'p5', dep: at(date, '19:24'), arr: at(date, '01:12', 1), duration_min: 348, changes: 2,
      legs: [
        leg('FLX 1241', from, 'Hannover Hbf', '19:24', '20:51', 'l8'),
        leg('ICE 71', 'Hannover Hbf', 'Nürnberg Hbf', '21:04', '00:02', 'l9', 0, 1),
        leg('RJX 63', 'Nürnberg Hbf', to, '00:20', '01:12', 'l10', 1, 1),
      ],
      odds: null,
      already_posted: false, is_kurts_pick: false, ride_instead: null, bahn_url: bahn(5),
    },
  ]
}

export function tripAt(date: string, o: Partial<Trip> & { delay: number }): Trip {
  const booked = picksFor(date, 'Hamburg Hbf', 'München Hbf')[0]
  const price = o.price_eur === undefined ? 34.99 : o.price_eur
  const delay = o.delay
  const state = o.state ?? (delay >= 120 ? 'cash50' : delay >= 60 ? 'cash25' : delay >= 20 ? 'unlocked' : 'on_time')
  const unlocked = delay >= 20
  const expected = new Date(new Date(booked.arr).getTime() + delay * 60000).toISOString()
  const alts: Alternative[] = unlocked && !o.finished
    ? [
        { dep: at(date, '17:54'), arr: at(date, '23:05'), changes: 0, trains: ['ICE 1105'], catchable_min: 38, delta_vs_expected_min: -(delay + 23) },
        { dep: at(date, '18:54'), arr: at(date, '23:49'), changes: 1, trains: ['ICE 1107', 'ICE 591'], catchable_min: 98, delta_vs_expected_min: -(delay - 21) },
      ]
    : []
  const { delay: _d, ...rest } = o
  void _d
  return {
    booked,
    price_eur: price,
    state,
    delay_min: delay,
    peak_delay_min: delay,
    expected_arr: expected,
    updated_at: new Date().toISOString(),
    stale: false,
    thresholds: [
      { at: 20, label: 'Ticket unlocked', amount_eur: null, reached: delay >= 20 },
      { at: 60, label: '25 % back', amount_eur: price === null ? null : Math.ceil(price * 0.25 * 20) / 20, reached: delay >= 60 },
      { at: 120, label: '50 % back', amount_eur: price === null ? null : Math.ceil(price * 0.5 * 20) / 20, reached: delay >= 120 },
    ],
    alternatives: alts,
    is_replay: false,
    replay_of: null,
    finished: false,
    final_delay_min: null,
    switched: false,
    ...rest,
  }
}

export function claimFor(delay: number, price: number | null): Claim {
  const pct = delay >= 120 ? 50 : delay >= 60 ? 25 : 0
  const amount = price === null || !pct ? null : payout(price, pct)
  const due = pct > 0 && (price === null || (amount !== null && amount >= MIN_PAYOUT))
  const iso = (min: number) => new Date(Date.parse('2026-11-20T22:28:00Z') + min * 60000).toISOString().replace('.000', '')
  return {
    switched: false,
    provisional: false,
    is_replay: false,
    replay_of: null,
    due,
    pct,
    amount_eur: due ? amount : null,
    reason: due && price === null
      ? `${delay} minutes late: ${pct} % of the ticket price is owed. Enter the price to see the amount.`
      : due
      ? `Arrived ${delay} minutes late at München Hbf: ${pct} % of €${price!.toFixed(2)}, rounded up to the next 5 cents.`
      : pct === 0
        ? 'Under 60 minutes late: no compensation is due.'
        : 'No payout is due because the amount is under €4. Still yours: the lifted Zugbindung from 20 minutes late, and a full refund if you give up the trip at an expected 60+ minutes.',
    fields: [
      { label: 'Date', value: '2026-11-20' },
      { label: 'Train', value: 'ICE 1583, ICE 879' },
      { label: 'From', value: 'Hamburg Hbf' },
      { label: 'To', value: 'München Hbf' },
      { label: 'Scheduled arrival', value: iso(0) },
      { label: 'Actual arrival', value: iso(delay) },
      { label: 'Delay', value: `${delay} min` },
    ],
    evidence: {
      scheduled_arr: iso(0),
      observed_arr: iso(delay),
      delay_min: delay,
      source: 'Real-time data from Transitous, not DB’s own record.',
      observations: [0, Math.round(delay / 3), Math.round((2 * delay) / 3), delay].map((d, i) => ({
        at: iso(delay - (3 - i) * 40), delay_min: d, cancelled: false,
      })),
    },
    where: 'File it yourself in the DB Navigator app (Fahrgastrechte) or on bahn.de. Kurt never submits a claim and never asks for bank details. Claims are possible for one year after the travel date.',
  }
}

export function lateNow(mode: string): LateNow {
  const now = Date.now()
  const rows: [string, string, string, string, number][] = [
    ['ICE 514', 'Hamburg Hbf', '16:12', 'Basel SBB', 37], ['ICE 1601', 'Köln Hbf', '16:31', 'Berlin Ostbahnhof', 34],
    ['IC 2212', 'Hannover Hbf', '16:05', 'Köln Hbf', 31], ['ICE 693', 'Frankfurt(Main)Hbf', '16:22', 'Hamburg-Altona', 29],
    ['ICE 71', 'Nürnberg Hbf', '16:40', 'Hamburg-Altona', 28], ['ICE 1005', 'München Hbf', '16:55', 'Hamburg-Altona', 27],
    ['ICE 783', 'Mannheim Hbf', '16:18', 'München Hbf', 26], ['IC 2023', 'Leipzig Hbf', '16:27', 'Karlsruhe Hbf', 25],
    ['ICE 1109', 'Stuttgart Hbf', '16:49', 'Berlin Gesundbrunnen', 24], ['ICE 595', 'Karlsruhe Hbf', '16:36', 'Hamburg-Altona', 23],
    ['ICE 1583', 'Dortmund Hbf', '16:15', 'München Hbf', 22], ['EC 8', 'Berlin Hbf', '16:44', 'Budapest-Keleti', 22],
    ['ICE 879', 'Kassel-Wilhelmshöhe', '16:58', 'München Hbf', 21], ['ICE 1721', 'Hamburg Hbf', '16:20', 'Wien Hbf', 20],
  ]
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(now))
  const list = mode === 'empty' ? [] : rows
  return {
    checked_at: new Date(now - (mode === 'stale' ? 47 * 60000 : 3 * 60000)).toISOString(),
    stale: mode === 'stale',
    checked: 96,
    late: list.map(([train, station, sched, headsign, d]) => {
      const [h, m] = sched.split(':').map(Number)
      return {
        train, station, headsign, delay_min: d,
        sched: at(day, sched),
        expected: at(day, '00:00', 0, h * 60 + m + d),
      }
    }),
  }
}

// Same shape and numbers as data/backtest.json (trimmed to the fields the UI reads).
export const BACKTEST: Backtest = {
  train_period: { from: '2025-12-14', to: '2026-08-31' },
  test_period: { from: '2026-09-01', to: '2026-10-31' },
  threshold_min: 20, runs: 414655, coverage: 0.8103, base_rate: 0.2635,
  brier: 0.1649, brier_constant_base_rate: 0.1855, brier_skill: 0.1111,
  buckets: [
    ['0-10%', 0.0774, 0.0764, 38010], ['10-20%', 0.1505, 0.1329, 137433], ['20-30%', 0.2471, 0.2362, 114505],
    ['30-40%', 0.3458, 0.3532, 69199], ['40-50%', 0.4434, 0.4834, 37588], ['50-60%', 0.5416, 0.5971, 14088],
    ['60-70%', 0.633, 0.681, 3423], ['70-80%', 0.7379, 0.7751, 409],
  ].map(([bucket, predicted_mean, observed_rate, n]) => ({ bucket, predicted_mean, observed_rate, n }) as Backtest['buckets'][number]),
  method: 'shrunk: (k + m * p_parent) / (n + m), m = 50',
  shrinkage_m: 50,
  note: 'Late = arrival 20+ min after plan or cancelled at that stop. Odds are base rates, not a forecast.',
  source: 'piebro/deutsche-bahn-data (Hugging Face), CC BY 4.0',
  built_at: '2026-11-13T22:37:24Z',
}
