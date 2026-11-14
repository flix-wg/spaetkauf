// Types follow design.md D12 and what the backend really returns. Trip calls carry the trip secret as ?secret=.

export type Basis = 'history' | 'estimate' | 'none'
export type TripState = 'on_time' | 'unlocked' | 'cash25' | 'cash50' | 'cancelled'

export interface Station {
  id: string
  name: string
  lat: number
  lon: number
}
export interface Leg {
  train: string
  from: string
  to: string
  dep: string
  arr: string
  trip_id: string
}
export interface Odds {
  p20: number | null
  p60: number | null
  late: number | null
  n: number | null
  weekday: string
  basis: Basis
}
export interface RideInstead {
  dep: string
  arr: string
  changes: number
  trains: string[]
  delta_arr_min: number
}
export interface Pick {
  id: string
  dep: string
  arr: string
  duration_min: number
  changes: number
  legs: Leg[]
  odds: Odds | null
  already_posted: boolean
  is_kurts_pick: boolean
  ride_instead: RideInstead | null
  bahn_url: string
  // mode=arrive only: minutes before the arrive-by time, an upper bound on missing it, and which delays still make it.
  spare_min?: number
  p_miss?: number | null
  late_ok?: { unlock: boolean; refund25: boolean; refund50: boolean }
  group?: 'on_time' | 'late_ok'
}
// A Context.dev change that announces a strike (D11). dates null: the dates could not be read.
export interface Strike {
  title: string
  url: string
  source: string
  changed_at: string
  dates: string[] | null
  test: boolean
  covers_date: boolean
  try_date: string | null
  note: string
}
export type KurtCall = 'pick' | 'none' | 'strike' | 'strike_unclear'
export interface PicksResponse {
  from: string
  to: string
  date: string
  tz: string
  picks: Pick[]
  note: string
  kurt_call: KurtCall
  strike: Strike | null
  mode?: 'arrive'
  arrive_by?: string
}
// /api/history*: past runs from the DB arrival data. weekday 0 = Monday.
export interface HistorySummary {
  n: number
  late20: number
  late60: number
  late120: number
  cancelled: number
}
export interface HistoryRuns {
  train: string
  stop: string
  weekday: string | null
  runs: { date: string; planned: string; delay_min: number | null; cancelled: boolean | null }[]
  summary: HistorySummary
  source: string
}
export interface TrainStops {
  train: string
  weekday: string | null
  stops: { stop: string; key: string; n: number; late20: number; late20_share: number }[]
  source: string
}
export interface RouteTrains {
  from: string
  to: string
  weekday: string | null
  trains: {
    train: string
    n: number
    dep: string | null
    arr: string | null
    late20: number
    late20_share: number
    late60: number
    late60_share: number
    median_delay_min: number | null
  }[]
  source: string
}
export interface HistoryQuery {
  train: string
  stop: string
  weekday?: number
}
export interface SignalItem {
  kind: string
  reason: string
  source: string
  published: string | null
  url: string
}
export interface SignalsResponse {
  status: 'ok' | 'empty' | 'unavailable'
  checked_at: string
  items: SignalItem[]
  banners: Banner[]
  strike: Strike | null
}
export interface Banner {
  source: string
  url: string
  changed_at: string
  title: string
  test: boolean
  is_strike: boolean
  dates: string[] | null
  covers_date: boolean
}
export interface Threshold {
  at: 20 | 60 | 120
  label: string
  amount_eur: number | null
  reached: boolean
}
export interface Alternative {
  dep: string
  arr: string
  changes: number
  trains: string[]
  catchable_min: number
  delta_vs_expected_min: number | null
  forfeits_compensation?: boolean
  compensation_eur?: number | null
}
export interface Trip {
  booked: Pick
  price_eur: number | null
  state: TripState
  delay_min: number | null
  peak_delay_min: number | null
  expected_arr: string | null
  updated_at: string | null
  stale: boolean
  thresholds: Threshold[]
  alternatives: Alternative[]
  is_replay: boolean
  replay_of: string | null
  finished: boolean
  final_delay_min: number | null
  switched: boolean
  stay?: { amount_at_60_eur: number | null; amount_at_120_eur: number | null }
  connection_at_risk?: boolean
  // History replays: the delay is the one measured at `at_stop`, not a destination forecast.
  delay_basis?: DelayBasis
  at_stop?: { name: string; planned_arr: string; actual_arr: string } | null
}
export type DelayBasis = 'at_stop' | 'destination_forecast'
export interface Recording {
  id: string
  source: 'history' | 'live'
  delay_basis: DelayBasis
  train: string
  from: string
  to: string
  date: string
  frames: number
  finished: boolean
  max_delay_min: number
  outcome: TripState
  crosses_20: boolean
  crosses_60: boolean
}
export interface Claim {
  switched: boolean
  provisional: boolean
  is_replay: boolean
  replay_of: string | null
  due: boolean
  pct: number
  amount_eur: number | null
  reason: string
  fields: { label: string; value: string }[]
  where: string
}
export interface LateTrain {
  train: string
  station: string
  sched: string
  expected: string
  delay_min: number
  headsign: string
}
export interface LateNow {
  checked_at: string | null
  stale: boolean
  checked: number
  late: LateTrain[]
}
export interface Health {
  ok: boolean
  version: string
  sources: { transitous: string; exa: string; context: string }
  plan_budget_left: number
}
// data/backtest.json, the fields the UI reads. Rates are fractions.
export interface Backtest {
  train_period: { from: string; to: string }
  test_period: { from: string; to: string }
  threshold_min: number
  runs: number
  coverage: number
  base_rate: number
  brier: number
  brier_constant_base_rate: number
  brier_skill: number
  buckets: { bucket: string; predicted_mean: number; observed_rate: number; n: number }[]
  method: string
  shrinkage_m: number
  note: string
  source: string
  built_at: string
}
export interface TripRef {
  id: string
  secret: string
}
export interface Created {
  trip_id: string
  secret: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const MOCK = import.meta.env.VITE_MOCK === '1'

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server.')
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((j) => (typeof j?.detail === 'string' ? j.detail : ''))
      .catch(() => '')
    const msg =
      res.status === 429
        ? 'Kurt has used up today’s route searches. Saved trips and Late now still work.'
        : res.status === 503
          ? 'The live train source is not answering right now. Try again in a minute.'
          : res.status === 404 && detail.startsWith('Unknown station')
            ? `${detail}. Pick a station from the list.`
            : detail
              ? `${detail}.`
              : `Request failed (${res.status}).`
    throw new ApiError(res.status, msg)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (MOCK) {
    const { mockCall } = await import('./mocks')
    return mockCall<T>(method, path, body)
  }
  return http<T>(method, path, body)
}

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}
const tripPath = (id: string, secret: string, sub = '') => `/api/trips/${encodeURIComponent(id)}${sub}${qs({ secret })}`

export const api = {
  health: () => call<Health>('GET', '/api/health'),
  stations: (q: string) => call<Station[]>('GET', `/api/stations${qs({ q })}`),
  picks: (p: { from: string; to: string; date: string; time: string; mode?: 'arrive'; before?: string }) =>
    call<PicksResponse>('GET', `/api/picks${qs(p)}`),
  history: (h: HistoryQuery) =>
    call<HistoryRuns>('GET', `/api/history${qs({ train: h.train, stop: h.stop, weekday: h.weekday?.toString() })}`),
  historyTrain: (train: string, weekday?: number) =>
    call<TrainStops>('GET', `/api/history/train${qs({ train, weekday: weekday?.toString() })}`),
  historyRoute: (from: string, to: string, weekday?: number) =>
    call<RouteTrains>('GET', `/api/history/route${qs({ from, to, weekday: weekday?.toString() })}`),
  signals: (p: { from: string; to: string; date: string }) => call<SignalsResponse>('GET', `/api/signals${qs(p)}`),
  createTrip: (pick: Pick, price_eur?: number) =>
    call<Created>('POST', '/api/trips', price_eur === undefined ? { pick } : { pick, price_eur }),
  trip: (r: TripRef) => call<Trip>('GET', tripPath(r.id, r.secret)),
  patchTrip: (r: TripRef, body: { price_eur?: number; switched?: boolean; push?: unknown }) =>
    call<void>('PATCH', tripPath(r.id, r.secret), body),
  deleteTrip: (r: TripRef) => call<void>('DELETE', tripPath(r.id, r.secret)),
  claim: (r: TripRef) => call<Claim>('GET', tripPath(r.id, r.secret, '/claim')),
  lateNow: () => call<LateNow>('GET', '/api/late-now'),
  backtest: () => call<Backtest>('GET', '/api/backtest'),
  pushKey: () => call<{ public_key: string }>('GET', '/api/push/key'),
  recordings: () => call<Recording[]>('GET', '/api/demo/recordings'),
  demoReplay: (recording?: string) =>
    call<Created & { recording: Recording }>('POST', '/api/demo/replay', recording ? { recording } : {}),
}
