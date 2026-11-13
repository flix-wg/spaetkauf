import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { api, ApiError, type Pick } from '../api'
import { BookSheet } from '../components/BookSheet'
import { IconChevron } from '../components/Icons'
import { Kurt } from '../components/Kurt'
import { CompactPick, KurtsPick } from '../components/PickCard'
import { ScreenHeader } from '../components/Shell'
import { SignalsArea, strikeSignal } from '../components/Signals'
import { Empty, ErrorState, Loading } from '../components/States'
import { dayLabel, shortStation } from '../format'
import { useAsync } from '../hooks'
import { useSheet } from '../sheets'


export function Picks() {
  const [sp] = useSearchParams()
  const { search } = useLocation()
  const { open } = useSheet()
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  const date = sp.get('date') ?? ''
  const time = sp.get('time') ?? ''
  const [booking, setBooking] = useState<Pick | null>(null)

  const [picks, retry] = useAsync(() => api.picks({ from, to, date, time }), [from, to, date, time])
  // Signals search by city name; ids would make a useless news query.
  const fn = sp.get('fn') || from
  const tn = sp.get('tn') || to
  const [signals] = useAsync(() => api.signals({ from: fn, to: tn, date }), [fn, tn, date])

  useEffect(() => {
    try {
      sessionStorage.setItem('spaetkauf.lastSearch', `/picks${search.replace(/[?&]sheet=\w+/, '')}`)
    } catch {
      /* ignore */
    }
  }, [search])

  if (!from || !to) return <Navigate to="/" replace />

  const sig = signals.status === 'ok' ? signals.data : null
  const strike = strikeSignal(sig)
  const hasKurts = picks.status === 'ok' && picks.data.picks.some((p) => p.is_kurts_pick)
  const back = `/?${new URLSearchParams({ fn: sp.get('fn') ?? '', tn: sp.get('tn') ?? '', date, time })}`

  return (
    <>
      <ScreenHeader title="Kurt’s picks" />
      {/* Phone: one column. Desktop: route and Kurt's pick on the left, all trains on the right. */}
      <div className="flex flex-col gap-3 px-4 pb-8 lg:grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:items-start lg:gap-x-10 lg:px-10 lg:pb-12 2xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <Link
            to={back}
            className="flex min-h-[48px] items-center justify-between rounded-xl bg-surface px-3.5 text-[15px] font-semibold no-underline lg:min-h-[60px] lg:px-5 lg:text-[19px]"
          >
            <span className="min-w-0 py-2 leading-snug">
              {shortStation(sp.get('fn'))} → {shortStation(sp.get('tn'))}{' '}
              <span className="whitespace-nowrap">· {date ? dayLabel(`${date}T12:00:00Z`) : ''}</span>
            </span>
            <span className="shrink-0 pl-2 text-[13px] font-normal text-muted lg:text-[15px]">change</span>
          </Link>
          {picks.status === 'ok' && picks.data.picks.length > 0 && (
            <>
              {picks.data.picks.map((p) =>
                p.is_kurts_pick ? (
                  <KurtsPick key={p.id} pick={p} tz={picks.data.tz} strike={strike} onBook={setBooking} />
                ) : null,
              )}
              {!hasKurts && (
                <section className="flex items-start gap-3 rounded-[22px] bg-surface p-4 lg:gap-4 lg:p-6" aria-label="No pick">
                  <Kurt width={56} className="mt-0.5 shrink-0" />
                  <span className="flex flex-col gap-1">
                    <span className="font-display text-[18px] font-bold leading-tight lg:text-[24px]">Kurt has no pick here</span>
                    <span className="text-[13px] leading-snug text-muted lg:text-[16px]">
                      Kurt only picks a train that is 20+ late on at least 3 of 10 runs and has a better one to ride
                      instead. None of these does. Their odds are below; another time of day may do better.
                    </span>
                  </span>
                </section>
              )}
              <p className="px-1 text-[12px] leading-snug text-muted lg:text-[14px]">
                A delay already posted when you buy does not count, so Kurt never picks a train for it. Odds are
                base rates from past runs.{' '}
                <button type="button" onClick={() => open('backtest')} className="-my-3 inline-flex min-h-[44px] items-center font-semibold text-accent-text underline">
                  How good is Kurt?
                </button>
              </p>
            </>
          )}
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-3">
          {picks.status === 'loading' && <Loading label="Kurt is looking up late trains…" />}
          {picks.status === 'error' &&
            (picks.error instanceof ApiError && picks.error.status === 429 ? (
              <Empty
                title="Kurt is out of searches today"
                action={
                  <div className="flex flex-col gap-2">
                    <Link to="/late" className="btn-primary">See what’s late now</Link>
                    <Link to="/trips" className="btn-ghost">My trips</Link>
                  </div>
                }
              >
                The free route service allows a fixed number of searches per day and today’s are used up. Saved
                trips keep updating.
              </Empty>
            ) : (
              <ErrorState error={picks.error} retry={retry} />
            ))}
          {picks.status === 'ok' && picks.data.picks.length === 0 && (
            <Empty
              title="No long-distance trains found"
              action={<Link to={back} className="btn-ghost">Try another date or station</Link>}
            >
              Kurt found no ICE, IC or EC connection for this route and time.
            </Empty>
          )}
          {picks.status === 'ok' && picks.data.picks.length > 0 && (
            <>
              {picks.data.picks.some((p) => !p.is_kurts_pick) && (
                <h2 className="mt-1 flex items-center gap-1 font-display text-[18px] font-bold lg:mt-0 lg:min-h-[60px] lg:text-[26px]">
                  {hasKurts ? 'More picks' : 'All trains'} <IconChevron size={16} className="rotate-90 text-muted lg:hidden" />
                </h2>
              )}
              {picks.data.picks
                .filter((p) => !p.is_kurts_pick)
                .map((p) => (
                  <CompactPick key={p.id} pick={p} tz={picks.data.tz} strike={strike} onBook={setBooking} />
                ))}
              {picks.data.note && <p className="px-1 text-[12px] text-muted lg:text-[14px]">{picks.data.note}</p>}
            </>
          )}
          {/* Below the picks only once they are in, so nothing above jumps. */}
          {picks.status === 'ok' && (
            <div className="contents lg:mt-6 lg:block">
              <SignalsArea s={sig} loading={signals.status === 'loading'} date={date} />
            </div>
          )}
        </div>
      </div>
      {booking && picks.status === 'ok' && <BookSheet pick={booking} tz={picks.data.tz} onClose={() => setBooking(null)} />}
    </>
  )
}
