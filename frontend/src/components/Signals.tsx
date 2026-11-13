import { useState } from 'react'
import type { SignalItem, SignalsResponse } from '../api'
import { dayLabel, hhmm } from '../format'
import { IconAlert, IconExternal } from './Icons'

// Exa tags almost everything "event"; only the specific kinds earn a coloured label.
const KIND: Record<string, string> = { strike: 'Strike', works: 'Track works', weather: 'Weather' }
const SHOW = 3

export const strikeSignal = (s: SignalsResponse | null) =>
  !!s && (s.banners.length > 0 || s.items.some((i) => i.kind === 'strike'))

export function Banners({ s }: { s: SignalsResponse | null }) {
  if (!s || s.banners.length === 0) return null
  return (
    <>
      {s.banners.map((b) => (
        <a
          key={b.url + b.changed_at}
          href={b.url}
          target="_blank"
          rel="noopener noreferrer"
          className="on-ink flex items-start gap-2.5 rounded-2xl bg-ink p-3 text-[13px] leading-snug text-white no-underline"
        >
          <IconAlert size={20} className="mt-0.5 shrink-0" />
          <span>
            <b>Strike watch:</b> {b.source} changed at {hhmm(b.changed_at)} on {dayLabel(b.changed_at)}. Open the page{' '}
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
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))

function Item({ it }: { it: SignalItem }) {
  const kind = KIND[it.kind]
  return (
    <li className="flex flex-col gap-1 px-3.5 py-3">
      {kind && <span className="tag w-fit rounded bg-tint px-1.5 py-0.5 uppercase text-accent-text">{kind}</span>}
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

export function SignalsArea({ s, loading, date }: { s: SignalsResponse | null; loading: boolean; date: string }) {
  const [all, setAll] = useState(false)
  const day = date ? dayLabel(`${date}T12:00:00Z`) : 'this day'
  let body
  if (loading) {
    body = (
      <div className="flex min-h-[88px] flex-col justify-center gap-2 rounded-2xl border border-line p-3.5" role="status">
        <span className="text-[13px] text-muted">Reading the news for strikes, closures and storms…</span>
        <span className="h-2.5 w-3/4 animate-pulse rounded-full bg-surface motion-reduce:animate-none" />
        <span className="h-2.5 w-1/2 animate-pulse rounded-full bg-surface motion-reduce:animate-none" />
      </div>
    )
  } else if (!s || s.status === 'unavailable') {
    body = (
      <p className="rounded-2xl bg-surface p-3.5 text-[13px] leading-snug text-muted">
        The news check is not available right now. Picks and odds never depend on it.
      </p>
    )
  } else if (s.status === 'empty' || s.items.length === 0) {
    body = (
      <p className="rounded-2xl bg-ok-tint p-3.5 text-[13px] leading-snug text-ok">
        No strike, closure or storm news found for this route on {day}. Checked at {hhmm(s.checked_at)}.
      </p>
    )
  } else {
    const shown = all ? s.items : s.items.slice(0, SHOW)
    body = (
      <>
        <p className="text-[13px] leading-snug text-muted">
          {s.items.length === 1 ? 'One article mentions' : `${s.items.length} articles mention`} places on this route.
          Context only: Kurt’s odds never use them.
        </p>
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
          {shown.map((it) => (
            <Item key={it.url} it={it} />
          ))}
        </ul>
        {s.items.length > SHOW && (
          <button type="button" onClick={() => setAll(!all)} className="min-h-[44px] self-start text-[14px] font-semibold underline">
            {all ? 'Show fewer' : `Show ${s.items.length - SHOW} more`}
          </button>
        )}
      </>
    )
  }
  return (
    <section aria-label="News for this route" className="flex flex-col gap-2">
      <h2 className="font-display text-[18px] font-bold">News around {day}</h2>
      <Banners s={s} />
      {body}
    </section>
  )
}
