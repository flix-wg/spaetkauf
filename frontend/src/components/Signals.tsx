import { locale } from '../i18n-core'
import { tx, tr, useT } from '../i18n'
import { useState } from 'react'
import type { Banner, SignalItem, SignalsResponse, Strike } from '../api'
import { dayLabel, hhmm } from '../format'
import { IconAlert, IconExternal, IconInfo } from './Icons'
import { Interested } from './Interested'

const SHOW = 3
// Only a change on a watched union page counts as a strike signal (Strike, banners); the per-article
// kind is unreliable (track works come back as "strike"), so articles get no kind label.
// Summaries that say the article does not concern long-distance trains go last.
const weak = (r: string) => /\b(not|no|does not|doesn't)\b[^.;]{0,40}\b(long-distance|mention|strike|report|affect)/i.test(r)
  || /\b(Fernverkehr|Fernzüge)\b[^.;]{0,40}\bnicht (erwähnt|betroffen)\b/i.test(r)

export const TestTag = ({ className = '' }: { className?: string }) => (
  <span className={`tag rounded bg-page px-1.5 py-0.5 text-ink ring-1 ring-ink ${className}`}>{tr('test')}</span>
)

// Where a strike announcement came from; `when` adds the time the page changed.
export function StrikeSource({ s, when = false, className = '' }: { s: Strike; when?: boolean; className?: string }) {
  useT()
  return (
    <span className={`flex flex-wrap items-center gap-x-1 ${className}`}>
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="-my-3 inline-flex min-h-[44px] items-center gap-1 font-semibold underline"
      >
        {s.source} <IconExternal size={12} />
      </a>
      <span>{tr('viaContextDevPageMonitor')}{when && tx('sourceChangedAt', dayLabel(s.changed_at), hhmm(s.changed_at))}</span>
    </span>
  )
}

// A compact line: a strike with unclear dates (on Kurt's pick) or one on other days (under the pick).
export function StrikeLine({ s, tone }: { s: Strike; tone: 'card' | 'plain' }) {
  useT()
  const unclear = s.dates === null
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-xl p-3 text-[13px] leading-snug lg:gap-3 lg:rounded-2xl lg:p-4 lg:text-[15px] ${tone === 'card' ? 'bg-page' : 'bg-surface'}`}
    >
      {unclear ? <IconAlert size={18} className="mt-0.5 shrink-0" /> : <IconInfo size={18} className="mt-0.5 shrink-0" />}
      <span className="flex min-w-0 flex-col gap-1">
        <span className={unclear ? 'font-semibold' : ''}>
          {s.test && <TestTag className="mr-1.5" />}
          {s.note}
        </span>
        <StrikeSource s={s} className="text-[12px] text-muted lg:text-[13px]" />
      </span>
    </div>
  )
}

const sameChange = (b: Banner, s: Strike | null | undefined) => !!s && b.url === s.url && b.changed_at === s.changed_at

// Watched-page changes. `shown` is a strike the screen already explains, so it is not repeated here.
export function Banners({ s, shown }: { s: SignalsResponse | null; shown?: Strike | null }) {
  useT()
  const list = s ? s.banners.filter((b) => !sameChange(b, shown)) : []
  if (list.length === 0) return null
  return (
    <>
      {list.map((b) => (
        <a
          key={b.url + b.changed_at}
          href={b.url}
          target="_blank"
          rel="noopener noreferrer"
          className="on-ink flex items-start gap-2.5 rounded-2xl bg-ink p-3 text-[13px] leading-snug text-page no-underline"
        >
          <IconAlert size={20} className="mt-0.5 shrink-0" />
          <span>
            {b.test && <TestTag className="mr-1.5" />}
            <b>{b.is_strike ? tr('strikeWatch') : tr('pageWatch')}</b> {b.is_strike && b.title ? `${b.title}. ` : ''}
            {b.source} {tr('changedAt')} {hhmm(b.changed_at)} {tr('on')} {dayLabel(b.changed_at)}. {tr('openPage')}{' '}
            <IconExternal size={13} className="inline" />
          </span>
        </a>
      ))}
    </>
  )
}

// The summaries often open with "Article reports …"; drop that so the news itself leads.
function tidy(r: string) {
  const t = r.replace(/^(the )?(article|report|page)( reports| discusses| describes| mentions| says| covers)?( that| on| a| an)? /i, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const shortDate = (d: string) =>
  new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))

function Item({ it }: { it: SignalItem }) {
  useT()
  return (
    <li className="flex flex-col gap-1 px-3.5 py-3">
      <span className="text-[14px] leading-snug">{tidy(it.reason)}</span>
      <a
        href={it.url}
        target="_blank"
        rel="noopener noreferrer"
        className="-my-2 inline-flex min-h-[44px] w-fit items-center gap-1 text-[12px] text-muted underline"
      >
        {it.source}
        {it.published ? ` · ${shortDate(it.published)}` : ''} <IconExternal size={12} />
      </a>
    </li>
  )
}

export function SignalsArea({
  s, loading, date, shown,
}: {
  s: SignalsResponse | null; loading: boolean; date: string; shown?: Strike | null
}) {
  useT()
  const [all, setAll] = useState(false)
  const day = date ? dayLabel(`${date}T12:00:00Z`) : tr('thisDay')
  let body
  if (s?.blocked) {
    body = <Interested feature="signals" />
  } else if (loading) {
    body = (
      <div className="flex min-h-[88px] flex-col justify-center gap-2 rounded-2xl border border-line p-3.5" role="status">
        <span className="text-[13px] text-muted">{tr('checkingTheNews')}</span>
        <span className="h-2.5 w-3/4 animate-pulse rounded-full bg-surface motion-reduce:animate-none" />
        <span className="h-2.5 w-1/2 animate-pulse rounded-full bg-surface motion-reduce:animate-none" />
      </div>
    )
  } else if (!s || s.status === 'unavailable') {
    body = (
      <p className="rounded-2xl bg-surface p-3.5 text-[13px] leading-snug text-muted">{tr('newsCheckUnavailableRightNow')} </p>
    )
  } else if (s.status === 'capped') {
    body = (
      <p className="rounded-2xl bg-surface p-3.5 text-[13px] leading-snug text-muted">{tr('newsCheckPausedForToday')} </p>
    )
  } else if (s.status === 'empty' || s.items.length === 0) {
    body = (
      <p className="rounded-2xl bg-surface p-3.5 text-[13px] leading-snug text-muted">{tr('noRouteNewsFoundInTheLast')} </p>
    )
  } else {
    const items = [...s.items].sort((a, b) => Number(weak(a.reason)) - Number(weak(b.reason)))
    const shown = all ? items : items.slice(0, SHOW)
    body = (
      <>
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
          {shown.map((it) => (
            <Item key={it.url} it={it} />
          ))}
        </ul>
        {s.items.length > SHOW && (
          <button type="button" onClick={() => setAll(!all)} className="min-h-[44px] self-start text-[14px] font-semibold underline">
            {all ? tr('showFewer') : tx('showMore', s.items.length - SHOW)}
          </button>
        )}
      </>
    )
  }
  return (
    <section aria-label={tr('newsForThisRoute')} className="flex flex-col gap-2">
      <h2 className="font-display text-[18px] font-bold">{tr('newsAround')} {day}
        <span className="block font-sans text-[13px] font-normal text-muted">{tr('notUsedInTheOdds')}</span>
      </h2>
      <Banners s={s} shown={shown} />
      {body}
    </section>
  )
}

// News for this route and day that names long-distance trains. The odds come from past runs, which
// may not include a closure or detour like this, so Kurt's pick says so.
const longDistance = /\b(long[- ]distance|fernverkehr|fernzüge|ICEs?|intercity|high[- ]speed)\b/i
export const disruptions = (s: SignalsResponse | null) =>
  s?.status === 'ok' ? s.items.filter((it) => longDistance.test(it.reason) && !weak(it.reason)) : []

export function NewsLine({ items }: { items: SignalItem[] }) {
  useT()
  const [first] = items
  return (
    <div role="note" className="flex items-start gap-2 rounded-xl bg-page p-3 text-[13px] leading-snug lg:gap-3 lg:rounded-2xl lg:p-4 lg:text-[15px]">
      <IconAlert size={18} className="mt-0.5 shrink-0" />
      <span className="flex min-w-0 flex-col gap-1">
        <span>
          <b>{tr('disruptionNewsForThisDay')}</b> {tr('pastRunsMayNotIncludeItSo')} </span>
        <span className="line-clamp-2">{tidy(first.reason)}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted lg:text-[13px]">
          <a href={first.url} target="_blank" rel="noopener noreferrer" className="-my-3 inline-flex min-h-[44px] items-center gap-1 underline">
            {first.source}
            {first.published ? ` · ${shortDate(first.published)}` : ''} <IconExternal size={12} />
          </a>
          {items.length > 1 && <span>{items.length - 1} {tr('moreUnderNews')}</span>}
        </span>
      </span>
    </div>
  )
}
