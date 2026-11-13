import type { SignalsResponse } from '../api'
import { dayLabel, hhmm } from '../format'
import { IconAlert, IconExternal } from './Icons'

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
          className="flex items-start gap-2.5 rounded-2xl bg-ink p-3 text-[13px] leading-snug text-white no-underline on-ink"
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

export function SignalsArea({ s, loading }: { s: SignalsResponse | null; loading: boolean }) {
  return (
    <section aria-label="Risk signals" className="flex flex-col gap-2">
      <h2 className="font-display text-[18px] font-bold">On the day</h2>
      {loading ? (
        <p className="text-[13px] text-muted">Looking for strikes, track works and weather…</p>
      ) : !s || s.status === 'unavailable' ? (
        <p className="rounded-xl bg-surface p-3 text-[13px] text-muted">
          Signals are unavailable right now. Picks and odds above are not affected.
        </p>
      ) : s.status === 'empty' || s.items.length === 0 ? (
        <p className="rounded-xl bg-ok-tint p-3 text-[13px] text-ok">
          No extra risk found for this day. Last looked at {hhmm(s.checked_at)}.
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
            {s.items.map((it) => (
              <li key={it.url + it.reason} className="flex flex-col gap-1 p-3">
                <span className="tag w-fit rounded bg-tint px-1.5 py-0.5 uppercase text-accent-text">{it.kind}</span>
                <span className="text-[14px] leading-snug">{it.reason}</span>
                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="-mb-2 inline-flex min-h-[44px] items-center gap-1 text-[12px] text-muted underline"
                >
                  {it.source} · {it.published} <IconExternal size={12} />
                </a>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-muted">Signals sit next to the odds and never change them.</p>
        </>
      )}
    </section>
  )
}
