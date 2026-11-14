import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Odds, Pick, Strike } from '../api'
import { changesLabel, dayLabel, duration, hhmm, pct, pctNum, weekdayPlural } from '../format'
import { Kurt, Snails } from './Kurt'
import { IconChevron, IconExternal } from './Icons'
import { StrikeLine, StrikeSource, TestTag } from './Signals'

export const hasOdds = (o: Odds | null): o is Odds & { p20: number } => !!o && o.basis !== 'none' && o.p20 !== null

// With a change, p20 is for the whole connection (a missed change counts) while late/n are the last train's own runs.
export function oddsLine(p: Pick) {
  const o = p.odds
  if (!hasOdds(o)) return 'Not enough history for odds'
  const days = weekdayPlural(o.weekday)
  const counts = o.late !== null && o.n !== null ? `${o.late} of ${o.n} ${days}` : null
  if (o.basis === 'estimate') {
    const last = p.legs[p.legs.length - 1]?.train ?? 'The last train'
    return `${pctNum(o.p20)} % is for the whole trip, a missed change included.${counts ? ` ${last} alone: late ${counts}.` : ''}`
  }
  return `Late ${counts ?? days}`
}

function rideLine(p: Pick, tz: string) {
  const r = p.ride_instead
  if (!r) return null
  const d = r.delta_arr_min
  // d > 0 is still a win: the booked train only unlocks once it runs 20+ late.
  const rel =
    d === 0
      ? 'Arrives with your booked train’s timetable, ahead of it once it’s 20+ late.'
      : d < 0
        ? `Arrives ${-d} min before your booked train is due.`
        : `Arrives ${d} min after your booked arrival, still ahead of your train once it’s 20+ late.`
  return {
    times: `${hhmm(r.dep, tz)} → ${hhmm(r.arr, tz)}`,
    what: `${r.trains.join(' + ')}${r.changes === 0 ? ' direct' : `, ${changesLabel(r.changes)}`}`,
    rel,
  }
}

export function Actions({
  pick,
  onBook,
  tone,
}: {
  pick: Pick
  onBook: (p: Pick) => void
  tone: 'accent' | 'plain'
}) {
  return (
    <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2">
      <a href={pick.bahn_url} target="_blank" rel="noopener noreferrer" className="btn-primary on-ink">
        Open on bahn.de <IconExternal size={18} />
      </a>
      <button type="button" onClick={() => onBook(pick)} className={tone === 'accent' ? 'btn-light' : 'btn-ghost'}>
        I booked this
      </button>
    </div>
  )
}

// `strike`: a strike with unclear dates, shown as a warning on the pick.
export function KurtsPick({ pick, tz, strike, onBook }: { pick: Pick; tz: string; strike: Strike | null; onBook: (p: Pick) => void }) {
  const ride = rideLine(pick, tz)
  const o = pick.odds
  const has = hasOdds(o)
  return (
    <section className="on-accent relative flex flex-col gap-3 rounded-[22px] bg-accent p-4 lg:gap-4 lg:rounded-[28px] lg:p-6" aria-label="Kurt's pick">
      <div className="flex items-center justify-between">
        <span className="tag inline-flex items-center gap-1.5 rounded-md bg-ink px-2 py-1 text-white lg:!text-[13px]">
          <Kurt width={16} shell="#FD4F00" body="#FFFFFF" /> KURT’S PICK
        </span>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="tag lg:!text-[13px]">BOOK</span>
          <span className="mono text-[24px] font-bold leading-tight lg:text-[32px]">
            {hhmm(pick.dep, tz)} → {hhmm(pick.arr, tz)}
          </span>
          <span className="text-[13px] leading-snug lg:text-[16px]">
            {changesLabel(pick.changes)} · {duration(pick.duration_min)}
          </span>
          <span className="text-[13px] leading-snug lg:text-[16px]">{pick.legs.map((l) => l.train).join(' + ')}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          {has ? (
            <>
              <span className="mono text-[40px] font-bold leading-none lg:text-[68px]">{pctNum(o.p20)}%</span>
              <span className="text-[12px] lg:text-[15px] lg:font-semibold">{o.basis === 'estimate' ? 'whole trip 20+ late' : '20+ min late'}</span>
            </>
          ) : (
            <span className="text-[13px] font-semibold">No odds yet</span>
          )}
        </div>
      </div>
      <p className="-mt-1 text-[13px] font-semibold lg:text-[16px] lg:leading-snug">{oddsLine(pick)}</p>
      {strike && <StrikeLine s={strike} tone="card" />}
      {ride ? (
        <div className="flex flex-col gap-0.5 rounded-xl bg-white p-3 lg:gap-1 lg:rounded-2xl lg:p-4">
          <span className="tag text-accent-text lg:!text-[13px]">IF IT’S LATE, YOU’D RIDE</span>
          <span className="mono text-[20px] font-bold leading-tight lg:text-[28px]">{ride.times}</span>
          <span className="text-[13px] font-semibold lg:text-[16px]">{ride.what}</span>
          <span className="mt-0.5 text-[12px] leading-snug text-muted lg:text-[14px]">{ride.rel}</span>
        </div>
      ) : (
        <p className="rounded-xl bg-white p-3 text-[13px] text-muted lg:text-[15px]">
          No other train in the window. Kurt shows the next option on the live screen.
        </p>
      )}
      <Actions pick={pick} onBook={onBook} tone="accent" />
      <p className="text-center text-[12px] leading-snug lg:text-[13px]">Price and buying happen on bahn.de. Kurt never sees either.</p>
    </section>
  )
}

export function CompactPick({ pick, tz, onBook }: { pick: Pick; tz: string; onBook: (p: Pick) => void }) {
  const [open, setOpen] = useState(false)
  const ride = rideLine(pick, tz)
  const o = pick.odds
  const dead = pick.already_posted
  return (
    <article className={`rounded-2xl border ${open ? 'border-ink' : 'border-line'} bg-white`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-[64px] w-full flex-col gap-1 px-3.5 py-3 text-left lg:min-h-[78px] lg:px-5 lg:py-3.5"
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className={`mono whitespace-nowrap text-[17px] font-bold lg:text-[22px] ${dead ? 'text-muted line-through' : ''}`}>
            {hhmm(pick.dep, tz)} → {hhmm(pick.arr, tz)}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {!dead && hasOdds(o) && (
              <span
                className="flex items-center gap-1.5 rounded-full bg-tint py-1 pl-2 pr-2.5"
                role="img"
                aria-label={`${pct(o.p20)} chance of 20+ min late`}
              >
                <Snails p20={o.p20} />
                <span className="mono text-[14px] font-bold lg:text-[19px]">{pctNum(o.p20)}%</span>
              </span>
            )}
            <IconChevron size={18} className={`text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-snug text-muted lg:text-[15px]">
          <span>
            {dead
              ? 'Already posted: does not count'
              : !hasOdds(o)
                ? `Not enough history · ${changesLabel(pick.changes)}`
                : ride
                  ? `You’d ride ${ride.times}`
                  : `${changesLabel(pick.changes)} · ${pick.legs.map((l) => l.train).join(' + ')}`}
          </span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3.5 pb-3.5 pt-3 lg:px-5 lg:pb-5">
          <div className="text-[13px] leading-snug lg:text-[15px]">
            <p className="font-semibold">{oddsLine(pick)}</p>
            <p className="text-muted">
              {changesLabel(pick.changes)} · {duration(pick.duration_min)} · {pick.legs.map((l) => l.train).join(' + ')}
            </p>
          </div>
          {ride && (
            <div className="rounded-xl bg-surface p-3">
              <span className="tag text-accent-text">IF IT’S LATE, YOU’D RIDE</span>
              <p className="mono text-[16px] font-bold lg:text-[20px]">{ride.times}</p>
              <p className="text-[13px] font-semibold lg:text-[15px]">{ride.what}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted lg:text-[14px]">{ride.rel}</p>
            </div>
          )}
          <Actions pick={pick} onBook={onBook} tone="plain" />
        </div>
      )}
    </article>
  )
}

// Kurt's call when an announced strike covers the travel day: no pick, the reason, the source, another day.
export function StrikeCall({ s, day, tryHref }: { s: Strike; day: string; tryHref: string | null }) {
  return (
    <section className="on-ink flex flex-col gap-3 rounded-[22px] bg-ink p-4 text-white lg:gap-4 lg:rounded-[28px] lg:p-6" aria-label="Kurt's call">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tag inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-white lg:!text-[13px]">
          <Kurt width={16} shell="#FFFFFF" body="#14161A" /> KURT’S CALL · STRIKE DAY
        </span>
        {s.test && <TestTag className="lg:!text-[13px]" />}
      </div>
      <div className="flex items-start gap-3 lg:gap-4">
        <Kurt width={56} shell="#FD4F00" body="#FFFFFF" className="mt-1 shrink-0" />
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="font-display text-[22px] font-bold leading-tight lg:text-[30px]">No pick for {day}</span>
          <span className="text-[14px] leading-snug lg:text-[17px]">{s.note}</span>
        </span>
      </div>
      <div className="flex flex-col gap-0.5 rounded-xl bg-white/10 p-3 lg:rounded-2xl lg:p-4">
        <span className="tag opacity-70 lg:!text-[13px]">SOURCE</span>
        <span className="text-[14px] font-semibold leading-snug lg:text-[17px]">{s.title}</span>
        <StrikeSource s={s} when className="mt-1 text-[12px] opacity-80 lg:text-[14px]" />
      </div>
      {tryHref && s.try_date && (
        <Link to={tryHref} className="btn-light !bg-white">
          Try {dayLabel(`${s.try_date}T12:00:00Z`)}
        </Link>
      )}
      <p className="text-[12px] leading-snug opacity-80 lg:text-[14px]">All trains and their odds are still listed. The odds come from past runs.</p>
    </section>
  )
}
