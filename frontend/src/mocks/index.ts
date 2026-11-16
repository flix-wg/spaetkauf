import { locale, tr, tx } from '../i18n-core'
import { ApiError, type Banner, type Created, type KurtCall, type Pick, type Recording, type Strike } from '../api'
import { BACKTEST, STATIONS, at, claimFor, lateNow, picksFor, tripAt } from './fixtures'
import { arrivePicksFor, historyRuns, routeTrains, trainStops } from './history'

const flag = (k: string) => {
  try {
    return localStorage.getItem(`mock.${k}`) ?? ''
  } catch {
    return ''
  }
}
const DATE = '2026-11-20'

// mock.strike=day|unclear|other: a TEST strike change on the GDL page, as send_test_change.py posts it.
function mockStrike(date: string): Strike | null {
  const mode = flag('strike')
  if (!mode) return null
  const d = new Date(`${date}T12:00:00Z`)
  const shift = (n: number) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10)
  const human = (iso: string) => new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
  const day = mode === 'other' ? shift(1) : date
  const base = {
    title: `TEST: GDL ruft zum Streik im Personenverkehr am ${human(day)} auf`,
    url: 'https://www.gdl.de/presse/newsarchiv',
    source: 'gdl.de',
    changed_at: STRIKE_AT,
    test: true,
  }
  if (mode === 'unclear')
    return { ...base, title: 'TEST: GDL kündigt Streik im Personenverkehr an', dates: null, covers_date: false, try_date: null, note: tr('mockUnclearStrike') }
  if (mode === 'other')
    return { ...base, dates: [day], covers_date: false, try_date: null, note: tx('mockOtherStrike', human(day)) }
  const tryDate = shift(-1)
  return {
    ...base, dates: [day], covers_date: true, try_date: tryDate,
    note: tx('mockStrikeDay', human(tryDate)),
  }
}
// Fixed, so picks and signals name the same change.
const STRIKE_AT = new Date(Date.now() - 50 * 60000).toISOString()
const started = new Map<string, number>()
let historyPicks: Pick[] = []
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
// An on-time run: Kurt's pick that never reached +20.
const STOPS_OK: [string, string, number][] = [
  ['Hannover Hbf', '11:24', 6], ['Göttingen', '11:58', 12], ['Kassel-Wilhelmshöhe', '12:18', 9],
  ['Fulda', '12:50', 4], ['Frankfurt(Main)Hbf', '13:40', 2], ['Nürnberg Hbf', '15:48', 0], ['München Hbf', '17:02', -5],
]
function historyTrip(id: string) {
  const ok = id.includes('-ok-')
  const stops = ok ? STOPS_OK : STOPS
  const t0 = started.get(id) ?? Date.now()
  const i = Math.min(stops.length - 1, Math.floor((Date.now() - t0) / 8000))
  const [name, hm, delay] = stops[i]
  const day = ok ? '2026-10-24' : '2026-10-30'
  const planned = `${day}T${hm}:00Z`
  const actual = new Date(new Date(planned).getTime() + delay * 60000).toISOString()
  const last = i === stops.length - 1
  return tripAt(DATE, {
    delay, is_replay: true, replay_of: day, delay_basis: 'at_stop', at_stop: { name, planned_arr: planned, actual_arr: actual },
    expected_arr: last ? actual : null, finished: last, final_delay_min: last ? delay : null, alternatives: [],
  })
}

const RECORDINGS: Recording[] = [
  { id: 'history:ice611-2026-10-30', source: 'history', delay_basis: 'at_stop', train: 'ICE 611', from: 'Hamburg Hbf', to: 'München Hbf', date: '2026-10-30', frames: 7, finished: true, max_delay_min: 71, outcome: 'cash25', crosses_20: true, crosses_60: true },
  { id: 'history:ice611-2026-10-24', source: 'history', delay_basis: 'at_stop', train: 'ICE 611', from: 'Hamburg Hbf', to: 'München Hbf', date: '2026-10-24', frames: 7, finished: true, max_delay_min: 12, outcome: 'on_time', crosses_20: false, crosses_60: false },
  { id: 'history:ice519-2026-10-30', source: 'history', delay_basis: 'at_stop', train: 'ICE 519', from: 'Hamburg Hbf', to: 'München Hbf', date: '2026-10-30', frames: 7, finished: true, max_delay_min: 45, outcome: 'unlocked', crosses_20: true, crosses_60: false },
  { id: 'live:demo', source: 'live', delay_basis: 'destination_forecast', train: 'ICE 1583', from: 'Hamburg Hbf', to: 'München Hbf', date: '2026-10-23', frames: 16, finished: true, max_delay_min: 63, outcome: 'cash25', crosses_20: true, crosses_60: true },
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
  if (flag('fail') === '1' && p !== '/api/health') throw new ApiError(0, tr('couldNotReachTheServer'))

  if (p === '/api/legal') return out({ name: '', address: [], email: '', hosting: '', cdn: '', adapter: false })
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
    const arrive = q.get('mode') === 'arrive'
    const by = q.get('time') ?? ''
    if (arrive && !by) throw new ApiError(400, tr('arrivalTimeRequired'))
    if (flag('picks') === 'budget') throw new ApiError(429, tr('mockBudgetSpent'))
    if (flag('picks') === 'none') return out({ from: fn, to: tn, date, tz: 'Europe/Berlin', picks: [], note: '' })
    // mock.picks=nopick: the backend flags no Kurt's pick (none at 30 %+ with a ride-instead).
    const strike = mockStrike(date)
    const list = (arrive ? arrivePicksFor(date, fn, tn, by) : picksFor(date, fn, tn)).map((x) => (flag('picks') !== 'nopick' && !strike?.covers_date ? x : {
      ...x, is_kurts_pick: false, odds: flag('picks') !== 'nopick' ? x.odds : x.odds && { ...x.odds, p20: x.odds.p20 === null ? null : Math.min(x.odds.p20, 0.24) },
    }))
    const kurt_call: KurtCall = strike?.covers_date
      ? 'strike'
      : !list.some((x) => x.is_kurts_pick) ? 'none' : strike?.dates === null ? 'strike_unclear' : 'pick'
    historyPicks = list
    return out({
      from: fn, to: tn, date, tz: 'Europe/Berlin', picks: list,
      note: tr('mockPosted'), kurt_call, strike,
      ...(arrive ? { mode: 'arrive', arrive_by: at(date, by) } : {}),
    })
  }
  if (p === '/api/signals') {
    const mode = flag('signals') || 'ok'
    const checked_at = new Date(Date.now() - 4 * 60000).toISOString()
    const strike = mockStrike(q.get('date') || DATE)
    const page: Banner = {
      source: tr('gdlPress'), url: 'https://www.gdl.de/', changed_at: new Date(Date.now() - 2 * 3600000).toISOString(),
      title: 'Pressemitteilungen', test: false, is_strike: false, dates: null, covers_date: false,
    }
    const banners: Banner[] = [
      ...(strike ? [{ source: strike.source, url: strike.url, changed_at: strike.changed_at, title: strike.title, test: true, is_strike: true, dates: strike.dates, covers_date: strike.covers_date }] : []),
      ...(flag('banner') === '0' ? [] : [page]),
    ]
    if (mode === 'unavailable') return out({ status: 'unavailable', checked_at, items: [], banners: [], strike })
    if (mode === 'capped') return out({ status: 'capped', checked_at, items: [], banners, strike })
    if (mode === 'empty') return out({ status: 'empty', checked_at, items: [], banners, strike })
    return out({
      status: 'ok', checked_at, banners, strike,
      items: [
        { kind: 'event', reason: tr('mockHamburgWorks'), source: 'ndr.de', published: '2026-10-26', url: 'https://www.ndr.de/' },
        { kind: 'event', reason: tr('mockNurembergWorks'), source: 'augsburger-allgemeine.de', published: '2026-11-07', url: 'https://www.augsburger-allgemeine.de/' },
        { kind: 'weather', reason: tr('mockStorm'), source: 'dwd.de', published: '2026-11-19', url: 'https://www.dwd.de/' },
        { kind: 'event', reason: tr('mockRegionalWorks'), source: 'diebayern.de', published: '2026-11-01', url: 'https://www.diebayern.de/' },
      ],
    })
  }
  if (p === '/api/trips' && method === 'POST') {
    const id = `new-${++seq}`
    started.set(id, Date.now())
    return out({ trip_id: id } satisfies Created)
  }
  const m = p.match(/^\/api\/trips\/([^/]+)(\/claim)?$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    if (m[2]) {
      const t = trip(id)
      const claim = claimFor(t.final_delay_min ?? t.delay_min ?? 0, t.price_eur)
      return out({
        ...claim, is_replay: t.is_replay, replay_of: t.replay_of, provisional: !t.finished,
        fields: claim.fields.map((f) => !t.finished && f.label === tr('actualArrival') ? { ...f, label: tr('expected') } : f),
      })
    }
    if (method === 'GET') return out(trip(id))
    return out(undefined)
  }
  if (p === '/api/history') return out(historyRuns(q, flag('history'), historyPicks))
  if (p === '/api/history/train') return out(trainStops(q, flag('history')))
  if (p === '/api/history/route') return out(routeTrains(q, flag('history')))
  if (p === '/api/late-now') return out(lateNow(flag('late')))
  if (p === '/api/backtest') return out(BACKTEST)
  if (p === '/api/push/key') return out({ public_key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' })
  if (p === '/api/demo/recordings') return out(flag('replay') === 'off' ? [] : RECORDINGS)
  if (p === '/api/demo/replay') {
    if (flag('replay') === 'off') throw new ApiError(404, tr('noRecording'))
    const rec = RECORDINGS.find((r) => r.id === (body as { recording?: string } | undefined)?.recording) ?? RECORDINGS[0]
    const id = `replay-${rec.source === 'history' ? 'hist-' : ''}${rec.outcome === 'on_time' ? 'ok-' : ''}${++seq}`
    started.set(id, Date.now())
    return out({ trip_id: id, recording: rec })
  }
  throw new ApiError(404, tr('notFound'))
}
