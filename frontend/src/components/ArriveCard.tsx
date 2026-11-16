import { tx, tr, useT } from '../i18n'
import { useState } from 'react'
import type { HistoryQuery, Pick, SignalItem, Strike } from '../api'
import { duration, hhmm, pct, pctNum } from '../format'
import { Kurt, Snails } from './Kurt'
import { IconChevron } from './Icons'
import { Actions, hasOdds, meta, OddsLine } from './PickCard'
import { NewsLine, StrikeLine } from './Signals'

export function spareLine(p: Pick, by: string, short = false) {
  const s = p.spare_min ?? 0
  return s <= 0 ? tx('dueAt', by) : tx('timeToSpare', duration(s), short ? '' : tx('beforeTime', by))
}

// p_miss is an upper bound (a missed change counts as a miss), so it is rounded up, never down.
export function missLine(p: Pick, by: string) {
  const m = p.p_miss
  if (m === null || m === undefined) return tr('missChanceUnknown')
  if (m >= 1) return tx('tightArrival', by)
  return tx('missChance', Math.max(1, Math.ceil(m * 100 - 1e-9)), by)
}

export function LateBadges({ p }: { p: Pick }) {
  useT()
  const ok = p.late_ok
  if (!ok?.unlock) return null
  const t = ok.refund50 ? tr('inTimeEven2HLate50') : ok.refund25 ? tr('inTimeEven1HLate25') : tr('inTimeEven20MinLate')
  return <span className="w-fit rounded-md bg-ok-tint px-2 py-0.5 text-[12px] font-semibold text-ok lg:text-[14px]">{t}</span>
}

type CardProps = { pick: Pick; tz: string; by: string; onBook: (p: Pick) => void; onHistory: (q: HistoryQuery) => void }

// `strike`: a strike with unclear dates, shown as a warning on the pick.
export function ArriveKurtsPick({ pick, tz, by, strike, news = [], onBook, onHistory }: CardProps & { strike: Strike | null; news?: SignalItem[] }) {
  useT()
  const o = pick.odds
  return (
    <section className="on-accent relative flex flex-col gap-3 rounded-[22px] bg-accent p-4 lg:gap-4 lg:rounded-[28px] lg:p-6" aria-label={tr('kurtSPick')}>
      <span className="tag inline-flex w-fit items-center gap-1.5 rounded-md bg-ink px-2 py-1 text-page lg:!text-[13px]">
        <Kurt width={16} shell="#FD4F00" body="var(--color-page)" /> {tr('kurtSPick37')} </span>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="mono text-[24px] font-bold leading-tight lg:text-[32px]">
            {hhmm(pick.dep, tz)} → {hhmm(pick.arr, tz)}
          </span>
          <span className="text-[13px] leading-snug lg:text-[16px]">{meta(pick)}</span>
        </div>
        {hasOdds(o) && (
          <div className="flex shrink-0 flex-col items-end">
            <span className="mono text-[40px] font-bold leading-none lg:text-[68px]">{pctNum(o.p20)}%</span>
            <span className="max-w-[88px] text-right text-[12px] leading-tight lg:max-w-none lg:text-[15px] lg:font-semibold">{tr('chanceOf20MinLate')}</span>
          </div>
        )}
      </div>
      <OddsLine pick={pick} onHistory={onHistory} className="-mt-1 text-[13px] font-semibold lg:text-[16px] lg:leading-snug" />
      {strike && <StrikeLine s={strike} tone="card" />}
      {!strike && news.length > 0 && <NewsLine items={news} />}
      <div className="flex flex-col gap-1 rounded-xl bg-page p-3 lg:gap-1.5 lg:rounded-2xl lg:p-4">
        <span className="tag text-accent-text lg:!text-[13px]">{tr('arriveBy')} {by}</span>
        <span className="mono text-[20px] font-bold leading-tight lg:text-[28px]">{spareLine(pick, by, true)}</span>
        <span className="text-[13px] font-semibold lg:text-[16px]">{missLine(pick, by)}</span>
        <LateBadges p={pick} />
      </div>
      <Actions pick={pick} onBook={onBook} tone="accent" />
    </section>
  )
}

export function ArrivePick({ pick, tz, by, onBook, onHistory }: CardProps) {
  useT()
  const [open, setOpen] = useState(false)
  const o = pick.odds
  const dead = pick.already_posted
  return (
    <article className={`rounded-2xl border ${open ? 'border-ink' : 'border-line'} bg-page`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-[64px] w-full flex-col gap-1 px-3.5 py-3 text-left lg:px-5 lg:py-3.5"
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className={`mono whitespace-nowrap text-[17px] font-bold lg:text-[22px] ${dead ? 'text-muted line-through' : ''}`}>
            {hhmm(pick.dep, tz)} → {hhmm(pick.arr, tz)}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {!dead && hasOdds(o) && (
              <span className="flex items-center gap-1.5 rounded-full bg-tint py-1 pl-2 pr-2.5" role="img" aria-label={tx('lateChance', pct(o.p20))}>
                <Snails p20={o.p20} />
                <span className="mono text-[14px] font-bold lg:text-[19px]">{pctNum(o.p20)}%</span>
              </span>
            )}
            <IconChevron size={18} className={`text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
          </span>
        </span>
        <span className="text-[12px] leading-snug text-muted lg:text-[15px]">
          {dead ? tr('alreadyPostedDoesNotCount') : `${spareLine(pick, by, true)} · ${missLine(pick, by)}`}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3.5 pb-3.5 pt-3 lg:px-5 lg:pb-5">
          <div className="flex flex-col text-[13px] leading-snug lg:text-[15px]">
            <OddsLine pick={pick} onHistory={onHistory} className="font-semibold" />
            <p className="text-muted">{meta(pick)}</p>
          </div>
          <LateBadges p={pick} />
          <Actions pick={pick} onBook={onBook} tone="plain" />
        </div>
      )}
    </article>
  )
}
