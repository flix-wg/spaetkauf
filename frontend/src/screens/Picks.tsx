import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { api, ApiError, type Pick } from '../api'
import { BookSheet } from '../components/BookSheet'
import { IconChevron } from '../components/Icons'
import { CompactPick, KurtsPick } from '../components/PickCard'
import { ScreenHeader } from '../components/Shell'
import { SignalsArea, strikeSignal } from '../components/Signals'
import { Empty, ErrorState, Loading } from '../components/States'
import { dayLabel } from '../format'
import { useAsync } from '../hooks'
import { useSheet } from '../sheets'

const short = (n: string | null) => (n ?? '').replace(/ Hbf$/, '')

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
  const back = `/?${new URLSearchParams({ fn: sp.get('fn') ?? '', tn: sp.get('tn') ?? '', date, time })}`

  return (
    <>
      <ScreenHeader title="Kurt’s picks" />
      <div className="flex flex-col gap-3 px-4 pb-8">
        <Link
          to={back}
          className="flex min-h-[48px] items-center justify-between rounded-xl bg-surface px-3.5 text-[15px] font-semibold no-underline"
        >
          <span className="truncate">
            {short(sp.get('fn'))} → {short(sp.get('tn'))} · {date ? dayLabel(`${date}T12:00:00Z`) : ''}
          </span>
          <span className="shrink-0 pl-2 text-[13px] font-normal text-muted">change</span>
        </Link>
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
            {picks.data.picks.map((p) =>
              p.is_kurts_pick ? (
                <KurtsPick key={p.id} pick={p} tz={picks.data.tz} strike={strike} onBook={setBooking} />
              ) : null,
            )}
            <p className="px-1 text-[12px] leading-snug text-muted">
              A delay already posted when you buy does not count, so Kurt never picks a train for it. Odds are
              base rates from past runs.{' '}
              <button type="button" onClick={() => open('backtest')} className="min-h-[24px] font-semibold text-accent-text underline">
                How good is Kurt?
              </button>
            </p>
            {picks.data.picks.some((p) => !p.is_kurts_pick) && (
              <h2 className="mt-1 flex items-center gap-1 font-display text-[18px] font-bold">
                More picks <IconChevron size={16} className="rotate-90 text-muted" />
              </h2>
            )}
            {picks.data.picks
              .filter((p) => !p.is_kurts_pick)
              .map((p) => (
                <CompactPick key={p.id} pick={p} tz={picks.data.tz} strike={strike} onBook={setBooking} />
              ))}
            {picks.data.note && <p className="px-1 text-[12px] text-muted">{picks.data.note}</p>}
          </>
        )}
        {picks.status !== 'error' && <SignalsArea s={sig} loading={signals.status === 'loading'} date={date} />}
      </div>
      {booking && picks.status === 'ok' && <BookSheet pick={booking} tz={picks.data.tz} onClose={() => setBooking(null)} />}
    </>
  )
}
