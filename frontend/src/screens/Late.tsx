import { tx, tr, useT } from '../i18n'
import { api } from '../api'
import { Flap } from '../components/Flap'
import { IconClock } from '../components/Icons'
import { ScreenHeader } from '../components/Shell'
import { Empty, ErrorState, Loading } from '../components/States'
import { hhmm, stopName, timeAgo } from '../format'
import { useAsync } from '../hooks'

export function Late() {
  useT()
  const [s, retry] = useAsync(() => api.lateNow(), [], 60000)
  const d = s.status === 'ok' ? s.data : null
  const stale = d?.stale || (s.status === 'ok' && s.stale)
  const list = d ? d.late.toSorted((a, b) => b.delay_min - a.delay_min) : []
  return (
    <>
      <ScreenHeader title={tr('lateNow')} />
      {/* Desktop: the count stays on the left while the list scrolls on the right. */}
      <div className={`flex flex-col gap-3 px-4 pb-8 lg:px-10 lg:pb-12 ${d?.checked_at ? 'lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-x-10' : ''}`}>
        {s.status === 'loading' && <Loading label={tr('kurtIsReadingTheBoards')} />}
        {s.status === 'error' && <ErrorState error={s.error} retry={retry} />}
        {d && !d.checked_at && (
          <Empty title={tr('firstBoardCheckIsRunning')} action={<button type="button" onClick={retry} className="btn-ghost">{tr('refresh')}</button>}>{tr('kurtReadsTheArrivalBoardsOf12')} </Empty>
        )}
        {d?.checked_at && (
          <>
            <section className={`${stale ? 'bg-surface' : 'bg-accent on-accent'} flex flex-col gap-1 rounded-[22px] p-4 lg:sticky lg:top-24 lg:gap-3 lg:rounded-[28px] lg:p-7`}>
              <h2 className="font-display text-[24px] font-bold leading-tight lg:text-[38px] lg:leading-[1.1]">
                <span className="mono">{list.length}</span> {tr('of')} <span className="mono">{d.checked}</span> {tr('trainsAre20MinLateRightNow')} </h2>
              <p className="flex items-center gap-1.5 text-[13px] lg:text-[16px]">
                <IconClock size={15} /> {tr('checked')} {timeAgo(d.checked_at)} ({hhmm(d.checked_at)})
              </p>
              <p className="text-[13px] leading-snug lg:text-[16px]">{tr('lateAtThisStationYourSaverTicket')} </p>
              {stale && (
                <p className="rounded-lg bg-page px-3 py-2 text-[13px] font-semibold lg:text-[15px]" role="alert">{tr('notCurrentTheLiveSourceFailedThis')} </p>
              )}
            </section>
            <div className="contents lg:flex lg:flex-col lg:gap-4">
              {list.length === 0 ? (
                <Empty title={tr('nothingIs20MinutesLate')}>{tr('kurtChecked')} {d.checked} {tr('trainsAndFoundNoneCheckBackIn')}</Empty>
              ) : (
                <ul className="flex flex-col 2xl:grid 2xl:grid-cols-2 2xl:gap-x-10">
                  {list.map((t, i) => (
                    <li key={t.train + t.station} className="flex min-h-[64px] items-center justify-between gap-3 border-b border-line py-2.5 lg:min-h-[80px] lg:py-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[15px] font-bold lg:text-[19px]">
                          {t.train}
                          {stopName(t.headsign) && <span className="font-normal text-muted"> {tr('to335')} {stopName(t.headsign)}</span>}
                        </span>
                        <span className="mono truncate text-[12px] text-muted lg:text-[15px]">
                          {t.station} · {hhmm(t.sched)} → {hhmm(t.expected)}
                        </span>
                      </span>
                      <Flap size="sm" text={`+${t.delay_min}`} label={tx('boardPlusMinutes', t.delay_min)} delay={Math.min(i, 7) * 90} />
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={retry} className="btn-ghost lg:self-start lg:px-8">{tr('refresh')}</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
