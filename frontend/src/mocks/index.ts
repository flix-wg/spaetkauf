import { ApiError, type Created, type Recording } from '../api'
import { BACKTEST, STATIONS, claimFor, lateNow, picksFor, tripAt } from './fixtures'

const flag = (k: string) => {
  try {
    return localStorage.getItem(`mock.${k}`) ?? ''
  } catch {
    return ''
  }
}
const DATE = '2026-11-20'
const started = new Map<string, number>()
let seq = 0

function replayTrip(id: string) {
  const t0 = started.get(id) ?? Date.now()
  const s = (Date.now() - t0) / 1000
  const delay = s < 20 ? 12 : s < 40 ? 24 : s < 60 ? 27 : 63
  return tripAt(DATE, { delay, is_replay: true, replay_of: '2026-10-23', delay_basis: 'destination_forecast', at_stop: null })
}

// A past run: one frame per stop, delay measured there, local times stamped as UTC like the real dataset.
const STOPS: [string, string, number][] = [
  ['Hannover Hbf', '11:24', 4], ['Göttingen', '11:58', 9], ['Kassel-Wilhelmshöhe', '12:18', 24],
  ['Fulda', '12:50', 31], ['Frankfurt(Main)Hbf', '13:40', 66], ['Nürnberg Hbf', '15:48', 58], ['München Hbf', '17:02', 71],
]
function historyTrip(id: string) {
  const t0 = started.get(id) ?? Date.now()
  const i = Math.min(STOPS.length - 1, Math.floor((Date.now() - t0) / 8000))
  const [name, hm, delay] = STOPS[i]
  const day = '2026-10-30'
  const planned = `${day}T${hm}:00Z`
  const actual = new Date(new Date(planned).getTime() + delay * 60000).toISOString()
  const last = i === STOPS.length - 1
  return tripAt(DATE, {
    delay, is_replay: true, replay_of: day, delay_basis: 'at_stop', at_stop: { name, planned_arr: planned, actual_arr: actual },
    expected_arr: last ? actual : null, finished: last, final_delay_min: last ? delay : null, alternatives: [],
  })
}

const RECORDINGS: Recording[] = [
  { id: 'history:ice611-2026-10-30', source: 'history', delay_basis: 'at_stop', train: 'ICE 611', from: 'Hamburg Hbf', to: 'München Hbf', date: '2026-10-30', frames: 7, finished: true, max_delay_min: 71, crosses_20: true, crosses_60: true },
  { id: 'history:ice519-2026-10-30', source: 'history', delay_basis: 'at_stop', train: 'ICE 519', from: 'Hamburg Hbf', to: 'München Hbf', date: '2026-10-30', frames: 7, finished: true, max_delay_min: 45, crosses_20: true, crosses_60: false },
  { id: 'live:demo', source: 'live', delay_basis: 'destination_forecast', train: 'ICE 1583', from: 'Hamburg Hbf', to: 'München Hbf', date: '2026-10-23', frames: 16, finished: true, max_delay_min: 63, crosses_20: true, crosses_60: true },
]

function trip(id: string) {
  if (id.startsWith('replay-hist-')) return historyTrip(id)
  if (id.startsWith('replay-')) return replayTrip(id)
  switch (id) {
    case 'demo-replay': return tripAt(DATE, { delay: 27, is_replay: true, replay_of: '2026-10-23' })
    case 'demo-done': return tripAt(DATE, { delay: 8, finished: true, final_delay_min: 8, state: 'on_time' })
    case 'demo-claim': return tripAt(DATE, { delay: 71, finished: true, final_delay_min: 71 })
    case 'demo-stale': return { ...tripAt(DATE, { delay: 27 }), stale: true, updated_at: new Date(Date.now() - 18 * 60000).toISOString() }
    case 'demo-wait': return { ...tripAt(DATE, { delay: 0 }), delay_min: null, expected_arr: null, updated_at: null }
    case 'demo-noprice': return tripAt(DATE, { delay: 71, finished: true, final_delay_min: 71, price_eur: null })
    case 'demo-ontime': return tripAt(DATE, { delay: 4 })
    case 'demo-cancel': return tripAt(DATE, { delay: 0, state: 'cancelled' })
    default: return tripAt(DATE, { delay: 27 })
  }
}

export async function mockCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, 160))
  const u = new URL(path, 'http://x')
  const p = u.pathname
  const q = u.searchParams
  const out = (v: unknown) => v as T
  if (flag('fail') === '1' && p !== '/api/health') throw new ApiError(0, 'Could not reach the server.')

  if (p === '/api/health') return out({ ok: true, version: 'mock', sources: { transitous: 'ok', exa: 'configured', context: 'configured' }, plan_budget_left: 641 })
  if (p === '/api/stations') {
    const s = (q.get('q') ?? '').toLowerCase()
    return out(s ? STATIONS.filter((x) => x.name.toLowerCase().includes(s)).slice(0, 6) : [])
  }
  if (p === '/api/picks') {
    const from = q.get('from') ?? 'Hamburg Hbf'
    const to = q.get('to') ?? 'München Hbf'
    const name = (id: string, d: string) => STATIONS.find((s) => s.id === id)?.name ?? d
    const date = q.get('date') || DATE
    const fn = name(from, from)
    const tn = name(to, to)
    if (flag('picks') === 'budget') throw new ApiError(429, 'Kurt has used up today’s route searches.')
    if (flag('picks') === 'none') return out({ from: fn, to: tn, date, tz: 'Europe/Berlin', picks: [], note: '' })
    // mock.picks=nopick: the backend flags no Kurt's pick (none at 30 %+ with a ride-instead).
    const list = picksFor(date, fn, tn).map((x) => (flag('picks') !== 'nopick' ? x : {
      ...x, is_kurts_pick: false, odds: x.odds && { ...x.odds, p20: x.odds.p20 === null ? null : Math.min(x.odds.p20, 0.24) },
    }))
    return out({
      from: fn, to: tn, date, tz: 'Europe/Berlin', picks: list,
      note: 'A delay already posted when you buy does not count.',
    })
  }
  if (p === '/api/signals') {
    const mode = flag('signals') || 'ok'
    const checked_at = new Date(Date.now() - 4 * 60000).toISOString()
    const banners = flag('banner') === '0' ? [] : [{ source: 'GDL press page', url: 'https://www.gdl.de/', changed_at: new Date(Date.now() - 2 * 3600000).toISOString() }]
    if (mode === 'unavailable') return out({ status: 'unavailable', checked_at, items: [], banners: [] })
    if (mode === 'empty') return out({ status: 'empty', checked_at, items: [], banners })
    return out({
      status: 'ok', checked_at, banners,
      items: [
        { kind: 'event', reason: 'Construction work closes the line between Hamburg Hbf and Harburg for four weeks; some long-distance trains are diverted.', source: 'ndr.de', published: '2026-10-26', url: 'https://www.ndr.de/' },
        { kind: 'event', reason: 'The high-speed line between Nürnberg and Ingolstadt is closed for renovation until 12 December; ICEs run via Augsburg.', source: 'augsburger-allgemeine.de', published: '2026-11-07', url: 'https://www.augsburger-allgemeine.de/' },
        { kind: 'weather', reason: 'Storm warning for northern Germany on Friday afternoon.', source: 'dwd.de', published: '2026-11-19', url: 'https://www.dwd.de/' },
        { kind: 'event', reason: 'S-Bahn and regional services in Munich reduced in November for Stammstrecke works; long-distance trains not mentioned.', source: 'diebayern.de', published: '2026-11-01', url: 'https://www.diebayern.de/' },
      ],
    })
  }
  if (p === '/api/trips' && method === 'POST') {
    const id = `new-${++seq}`
    started.set(id, Date.now())
    return out({ trip_id: id, secret: 'mock' } satisfies Created)
  }
  const m = p.match(/^\/api\/trips\/([^/]+)(\/claim)?$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    if (m[2]) {
      const t = trip(id)
      return out(claimFor(t.final_delay_min ?? t.delay_min ?? 0, t.price_eur))
    }
    if (method === 'GET') return out(trip(id))
    return out(undefined)
  }
  if (p === '/api/late-now') return out(lateNow(flag('late')))
  if (p === '/api/backtest') return out(BACKTEST)
  if (p === '/api/push/key') return out({ public_key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' })
  if (p === '/api/demo/recordings') return out(flag('replay') === 'off' ? [] : RECORDINGS)
  if (p === '/api/demo/replay') {
    if (flag('replay') === 'off') throw new ApiError(404, 'No recording yet.')
    const rec = RECORDINGS.find((r) => r.id === (body as { recording?: string } | undefined)?.recording) ?? RECORDINGS[0]
    const id = `replay-${rec.source === 'history' ? 'hist-' : ''}${++seq}`
    started.set(id, Date.now())
    return out({ trip_id: id, secret: 'mock', recording: rec })
  }
  throw new ApiError(404, 'Not found.')
}
