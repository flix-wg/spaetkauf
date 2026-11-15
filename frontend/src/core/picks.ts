import type { Leg, Pick, PicksResponse, RideInstead } from '../api'
import { berlinDate, berlinLocal, zonedToUtc } from './berlin.ts'
import { parseTrain, stationKey, stationTokens } from './matching.ts'
import { connectionOdds, missOdds } from './odds.ts'
import type { OddsSource } from './oddsSource'
import { stationsSearch } from './transitous.ts'
import type { Transitous } from './transitous'

export class BadRequest extends Error {}
type Connection = Pick & { cancelled: boolean }
interface Stop { name: string; cancelled?: boolean; arrival?: string; scheduledArrival?: string }
interface RawLeg {
  tripId?: string; routeShortName?: string; displayName?: string; from: Stop; to: Stop;
  scheduledStartTime: string; scheduledEndTime: string; cancelled?: boolean; realTime?: boolean;
  intermediateStops?: { name: string }[]
}
interface Page {
  itineraries?: { legs?: RawLeg[]; startTime: string }[];
  from?: Stop; to?: Stop; nextPageCursor?: string; previousPageCursor?: string
}
const iso = (value: string | Date) => new Date(value).toISOString().replace('.000Z', 'Z')
const minutes = (a: string, b: string) => {
  const n = (Date.parse(b) - Date.parse(a)) / 60_000
  const lower = Math.floor(n)
  return n - lower === 0.5 ? lower + (Math.abs(lower % 2)) : Math.round(n)
}
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export async function resolve(tr: Transitous, place: string): Promise<[string, string | null]> {
  place = place.trim()
  if (place.includes('_') && !/\s/u.test(place)) return [place, null]
  const hits = await stationsSearch(tr, place)
  if (!hits.length) throw new Error(`Unknown station: ${place}`)
  return [hits[0].id, hits[0].name]
}

async function connection(it: NonNullable<Page['itineraries']>[number]): Promise<Connection | null> {
  const raw = (it.legs ?? []).filter(leg => leg.tripId)
  if (!raw.length) return null
  const legs: Leg[] = raw.map(leg => ({
    train: leg.routeShortName || leg.displayName || '', from: leg.from.name, to: leg.to.name,
    dep: iso(leg.scheduledStartTime), arr: iso(leg.scheduledEndTime), trip_id: leg.tripId!,
    ...(Array.isArray(leg.intermediateStops) ? { via: leg.intermediateStops.map(stop => stop.name) } : {}),
  }))
  const last = raw[raw.length - 1], end = last.to
  const cancelled = raw.some(leg => leg.cancelled) || !!end.cancelled
  const posted = cancelled || !!(last.realTime && end.arrival && end.scheduledArrival && minutes(end.scheduledArrival, end.arrival) >= 20)
  const key = `[[${legs.map(leg => JSON.stringify(leg.trip_id)).join(', ')}], ${JSON.stringify(legs[0].dep)}]`
    .replace(/[^\x00-\x7f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(key))
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12)
  return { id, dep: legs[0].dep, arr: legs.at(-1)!.arr,
    duration_min: minutes(legs[0].dep, legs.at(-1)!.arr), changes: legs.length - 1, legs,
    odds: null, already_posted: posted, cancelled, is_kurts_pick: false, ride_instead: null, bahn_url: '' }
}

export function reservationOnlyLeg(train: string | null, ...stops: (string | null | undefined)[]): boolean {
  const [kind, number] = parseTrain(train) ?? ['', '']
  if (kind === 'TGV' || (Number(number) >= 9550 && Number(number) < 9600)) return true
  return stops.some(stop => /paris|strasbourg|marseille|lyon|milano|warszawa|poznan|gdansk|krakow|wroclaw|szczecin/.test(
    (stop ?? '').toLowerCase().replaceAll('ł', 'l').normalize('NFKD').replace(/\p{M}/gu, '')))
}

export function rideInstead(booked: Pick, others: Pick[], before = 0): RideInstead | null {
  const trips = new Set(booked.legs.map(leg => leg.trip_id))
  let fits = others.filter(p => p.id !== booked.id && !(p as Partial<Connection>).cancelled &&
    Date.parse(p.dep) - Date.parse(booked.dep) >= -before * 60_000 &&
    Date.parse(p.dep) - Date.parse(booked.dep) <= 120 * 60_000 &&
    Date.parse(p.arr) <= Date.parse(booked.arr) + 20 * 60_000 &&
    p.legs.every(leg => !trips.has(leg.trip_id) && !reservationOnlyLeg(leg.train, leg.from, leg.to)))
  const later = fits.filter(p => Date.parse(p.dep) >= Date.parse(booked.dep))
  if (later.length) fits = later
  fits.sort((a, b) => cmp(a.arr, b.arr) || a.changes - b.changes)
  const best = fits[0]
  return best ? { dep: best.dep, arr: best.arr, changes: best.changes,
    trains: best.legs.map(leg => leg.train), delta_arr_min: minutes(booked.arr, best.arr) } : null
}

const quote = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
export async function bahnUrl(from: string, to: string, dep: string, src?: OddsSource): Promise<string> {
  let ids = ''
  if (src) {
    const stations = (await src.index()).stations
    const a = stations[stationKey(from)]?.eva, b = stations[stationKey(to)]?.eva
    if (a && b) ids = `&soid=${quote(`A=1@O=${from}@L=${a}@`)}&zoid=${quote(`A=1@O=${to}@L=${b}@`)}`
  }
  return `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=${quote(from)}&zo=${quote(to)}${ids}&hd=${berlinLocal(dep)}&hza=D&ar=false&s=true&d=false&fm=false&bp=false`
}

function mark(picks: Pick[], eligible: (p: Pick) => boolean): Pick[] {
  const best = picks.filter(eligible).reduce<Pick | null>((best, p) => !best || (p.odds?.p20 ?? 0) > (best.odds?.p20 ?? 0) ? p : best, null)
  if (best) best.is_kurts_pick = true
  return picks
}
const probabilityOrder = (a: Pick, b: Pick) => Number(a.odds?.p20 == null) - Number(b.odds?.p20 == null) || (b.odds?.p20 ?? 0) - (a.odds?.p20 ?? 0) || cmp(a.dep, b.dep)
export function rank(picks: Pick[]): Pick[] {
  picks.sort(probabilityOrder)
  return mark(picks, p => !!p.ride_instead && !p.already_posted && (p.odds?.p20 ?? 0) >= 0.30)
}
export function rankArrive(picks: Pick[]): Pick[] {
  const safe = (p: Pick) => p.p_miss != null && p.p_miss <= 0.10
  picks.sort((a, b) => Number(a.group === 'on_time') - Number(b.group === 'on_time') ||
    (a.group === 'on_time' ? cmp(b.arr, a.arr) : Number(!safe(a)) - Number(!safe(b)) || probabilityOrder(a, b)))
  return mark(picks, p => p.group === 'late_ok' && safe(p) && !p.already_posted && (p.odds?.p20 ?? 0) >= 0.30)
}

export async function getPicks(deps: { tr: Transitous; odds: OddsSource; now?: Date }, q: {
  from: string; to: string; date: string; time?: string; mode?: 'depart' | 'arrive'; before?: number
}): Promise<PicksResponse> {
  const { tr, odds } = deps, now = deps.now ?? new Date(), arrive = q.mode === 'arrive'
  const before = arrive ? 0 : Math.max(0, Math.min(q.before ?? 0, 60))
  if (arrive && !q.time) throw new BadRequest('time (latest arrival, HH:MM) is required with mode=arrive')
  const today = berlinDate(now.toISOString())
  if (q.date < today) throw new BadRequest('Date is in the past')
  if (q.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(q.time)) throw new BadRequest('time must be HH:MM')
  const start = q.time ? zonedToUtc(q.date, q.time) : q.date === today ? now : zonedToUtc(q.date, '06:00')
  const [src, srcLabel] = await resolve(tr, q.from), [dst, dstLabel] = await resolve(tr, q.to)
  const found = new Map<string, Connection>()
  let first: Page = {}, cursor: string | undefined
  for (let pageNo = 0; pageNo < 3; pageNo++) {
    const page = await tr.plan({ from: src, to: dst, arriveBy: arrive,
      ...(cursor ? { cursor } : { time: iso(new Date(+start - before * 60_000)) }) }) as Page
    if (!pageNo) first = page
    const its = (await Promise.all((page.itineraries ?? []).map(connection))).filter((p): p is Connection => p !== null)
    for (const p of its) {
      const fits = arrive ? Date.parse(p.arr) >= +start - 180 * 60_000 && Date.parse(p.arr) <= +start &&
        berlinDate(p.dep) === q.date && berlinDate(p.arr) === q.date : berlinDate(p.dep) === q.date
      if (fits && !found.has(p.id)) found.set(p.id, p)
    }
    cursor = arrive ? page.previousPageCursor : page.nextPageCursor
    const times = (page.itineraries ?? []).map(it => it.startTime).sort()
    const earliest = its.map(p => p.arr).sort()[0]
    const done = arrive ? earliest && Date.parse(earliest) < +start - 180 * 60_000 : times.length && berlinDate(times.at(-1)!) > q.date
    const shown = [...found.values()].filter(p => arrive || Date.parse(p.dep) >= +start).length
    if (shown >= 10 || !cursor || done) break
  }
  const from = srcLabel || first.from?.name || q.from, to = dstLabel || first.to?.name || q.to
  const candidates = [...found.values()], catchable = candidates.filter(p => Date.parse(p.dep) >= +now)
  for (const p of candidates) {
    for (let i = 0; i < p.legs.length; i++) {
      const leg = p.legs[i]
      if (!stationTokens(leg.from).length) leg.from = i ? p.legs[i - 1].to : from
      if (!stationTokens(leg.to).length) {
        const next = p.legs[i + 1]?.from ?? to
        if (stationTokens(next).length) leg.to = next
      }
    }
    p.odds = await connectionOdds(odds, p.legs)
    p.ride_instead = rideInstead(p, catchable, before)
    p.bahn_url = await bahnUrl(from, to, p.dep, odds)
    if (arrive) {
      const spare = minutes(p.arr, iso(start))
      Object.assign(p, { spare_min: spare, p_miss: await missOdds(odds, p.legs, spare),
        late_ok: { unlock: spare >= 20, refund25: spare >= 60, refund50: spare >= 120 }, group: spare >= 20 ? 'late_ok' : 'on_time' })
    }
  }
  const picks = arrive ? rankArrive(candidates) : rank(candidates.filter(p => Date.parse(p.dep) >= +start))
  const without = picks.filter(p => p.odds?.basis === 'none')
  const flix = without.some(p => p.legs.some(leg => !parseTrain(leg.train)))
  const note = !picks.length ? 'No long-distance connections found; try another date or station.' : without.length ?
    `${without.length} of ${picks.length} connections have too little history for odds${flix ? ' (no history for FlixTrain legs)' : ''}.` : ''
  return { from, to, date: q.date, tz: 'Europe/Berlin', picks, note,
    kurt_call: picks.some(p => p.is_kurts_pick) ? 'pick' : 'none', strike: null,
    ...(arrive ? { mode: 'arrive', arrive_by: iso(start) } : {}) }
}
