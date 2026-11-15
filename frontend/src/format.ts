import { getLang, locale, tr, tx } from './i18n-core'
const TZ = 'Europe/Berlin'

export const hhmm = (iso: string, tz = TZ) =>
  new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(
    new Date(iso),
  )

export const dayLabel = (iso: string, tz = TZ) =>
  new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(
    new Date(iso),
  )

export const longDate = (iso: string, tz = TZ) =>
  new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(
    new Date(iso),
  )

export const dateOnly = (d: string) => longDate(`${d}T12:00:00Z`)

export function duration(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? tx('durationHours', h, String(m).padStart(2, '0')) : tx('durationMinutes', m)
}

export const changesLabel = (n: number) => (n === 0 ? tr('direct211') : n === 1 ? tr('1Change') : tx('changes', n))

export const eur = (n: number) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).format(n)

export function pct(p: number | null) {
  if (p === null) return null
  return `${Math.round(p <= 1 ? p * 100 : p)} %`
}
export const pctNum = (p: number) => Math.round(p <= 1 ? p * 100 : p)

const DAYS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}
const WEEKDAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
// Backend weekday names ("Saturday") to the 0 = Monday index the history endpoints take.
export function weekdayIndex(w: string) {
  const i = WEEKDAYS_EN.findIndex((d) => d.slice(0, 3).toLowerCase() === w.slice(0, 3).toLowerCase())
  return i < 0 ? undefined : i
}
export function weekdayPlural(w: string) {
  const full = DAYS[w.slice(0, 3).toLowerCase()] ?? w
  return getLang() === 'de' ? tr((['mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays'] as const)[weekdayIndex(w) ?? 0]) : `${full}s`
}

export function timeAgo(iso: string | null) {
  if (!iso) return tr('never')
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return tr('justNow')
  if (s < 3600) return tx('minutesAgo', Math.floor(s / 60))
  return `${hhmm(iso)}`
}

export const todayISO = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date())

export const nowHHMM = () => hhmm(new Date().toISOString())

// Feeds sometimes use local stop names ("S+U Berlin Hauptbahnhof", "S Südkreuz Bhf (Berlin)") or just "Hauptbahnhof".
export function stopName(n: string | null | undefined) {
  const t = (n ?? '').trim()
  if (/^(hauptbahnhof|hbf|bahnhof|bf)$/i.test(t)) return ''
  const m = t.match(/^S(?:\+U)? (.+?) Bhf \((.+)\)$/)
  if (m) return `${m[2]} ${m[1]}`
  return t.replace(/^S(\+U)? (?=\S+ Hauptbahnhof$)/, '').replace(/ ?\(Main\) Hauptbahnhof$/, '(Main)Hbf').replace(/ Hauptbahnhof$/, ' Hbf')
}

export const shortStation = (n: string | null | undefined) =>
  stopName(n).replace(/ Hbf$/, '').replace(/\(Main\)Hbf$/, '')

// Delay for display: early arrivals (past runs) are negative.
export const signedMin = (d: number) => (d < 0 ? `−${-d}` : `+${d}`)
export const minLabel = (d: number) => (d < 0 ? tx('minutesEarly', -d) : tx('plusMinutes', d))

export const weekdays = () => [tr('monday'), tr('tuesday'), tr('wednesday'), tr('thursday'), tr('friday'), tr('saturday'), tr('sunday')]

export const WEEKDAYS = WEEKDAYS_EN
