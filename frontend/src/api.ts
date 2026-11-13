// Types follow design.md D12. Trip calls carry the trip secret as ?secret=.

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
  odds: Odds
  already_posted: boolean
  is_kurts_pick: boolean
  ride_instead: RideInstead | null
  bahn_url: string
}
export interface PicksResponse {
  from: string
  to: string
  date: string
  tz: string
  picks: Pick[]
  note: string
}
export interface SignalItem {
  kind: string
  reason: string
  source: string
  published: string
  url: string
}
export interface SignalsResponse {
  status: 'ok' | 'empty' | 'unavailable'
  checked_at: string
  items: SignalItem[]
  banners: { source: string; url: string; changed_at: string }[]
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
  delta_vs_expected_min: number
}
export interface Trip {
  booked: Pick
  price_eur: number | null
  state: TripState
  delay_min: number | null
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
}
export interface Claim {
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
  checked_at: string
  stale: boolean
  checked: number
  late: LateTrain[]
}
export interface Health {
  ok: boolean
  version: string
  sources: { transitous: boolean; exa: boolean; context: boolean }
  plan_budget_left: number
}
// D12 only says "contents of data/backtest.json"; this is the shape the UI reads.
export interface Backtest {
  train_from: string
  train_to: string
  test_from: string
  test_to: string
  base_rate: number
  runs: number
  buckets: { lo: number; hi: number; n: number; late: number; rate: number }[]
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
    const msg =
      res.status === 429
        ? 'Daily route limit reached. Try again tomorrow.'
        : res.status === 503
          ? 'The route source is unavailable right now.'
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
  picks: (p: { from: string; to: string; date: string; time: string }) =>
    call<PicksResponse>('GET', `/api/picks${qs(p)}`),
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
  demoReplay: () => call<Created>('POST', '/api/demo/replay'),
}
