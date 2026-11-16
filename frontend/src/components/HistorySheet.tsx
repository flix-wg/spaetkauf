import { tx, tr, useT } from '../i18n'
import { api, ApiError, type HistoryQuery, type Pick } from '../api'
import { dayLabel, hhmm, signedMin, stopName, WEEKDAYS, weekdayPlural, weekdayIndex } from '../format'
import { useAsync } from '../hooks'
import { Sheet } from './Sheet'
import { Loading } from './States'

const SHOWN = 150

// The runs behind a pick's odds: its last train at the destination, on the same weekday.
export function historyOf(p: Pick): HistoryQuery | null {
  const last = p.legs[p.legs.length - 1]
  if (!last || !p.odds || p.odds.basis === 'none') return null
  return { train: last.train, stop: last.to, weekday: weekdayIndex(p.odds.weekday) }
}

export function HistorySheet({ q, onClose }: { q: HistoryQuery; onClose: () => void }) {
  useT()
  const [res, retry] = useAsync(() => api.history(q), [q.train, q.stop, q.weekday])
  const days = q.weekday === undefined ? tr('runs') : weekdayPlural(WEEKDAYS[q.weekday])
  return (
    <Sheet title={tx('trainAtStop', q.train, stopName(q.stop) || q.stop)} onClose={onClose}>
      {res.status === 'loading' && <Loading label={tr('kurtIsReadingTheOldTimetables')} />}
      {res.status === 'error' && <Missing error={res.error} retry={retry} />}
      {res.status === 'ok' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-tint p-3 lg:p-4">
            {(
              [
                [tr('runs'), res.data.summary.n],
                [tr('20Late'), res.data.summary.late20],
                [tr('cancelled'), res.data.summary.cancelled],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="flex flex-col">
                <span className="mono text-[20px] font-bold leading-tight lg:text-[26px]">{v}</span>
                <span className="text-[12px] leading-snug text-muted lg:text-[14px]">{label}</span>
              </div>
            ))}
          </div>
          <p className="-mt-2 text-[13px] text-muted lg:text-[15px]">{days[0].toUpperCase() + days.slice(1)}{tr('newestFirst')}</p>
          {res.data.runs.length === 0 ? (
            <p className="text-[14px] text-muted">{tr('noRunsOnRecordForThisStop')}{q.weekday === undefined ? '' : tr('onThatWeekday')}.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {res.data.runs.slice(0, SHOWN).map((r) => {
                const late = r.cancelled || (r.delay_min ?? 0) >= 20
                return (
                  <li key={r.planned} className="flex min-h-[44px] items-center justify-between gap-3 text-[14px] lg:text-[16px]">
                    <span className="flex items-baseline gap-3">
                      <span className="w-[92px] font-semibold lg:w-[110px]">{dayLabel(`${r.date}T12:00:00Z`)}</span>
                      <span className="mono text-muted">{hhmm(r.planned)}</span>
                    </span>
                    <span className={`mono font-bold ${late ? 'text-accent-text' : ''}`}>
                      {r.cancelled ? tr('cancelled') : r.delay_min === null ? tr('noData') : tx('delayMinutes', signedMin(r.delay_min))}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {res.data.runs.length > SHOWN && (
            <p className="text-[13px] text-muted">{res.data.runs.length - SHOWN} {tr('olderRunsNotShown')}</p>
          )}
          <p className="text-[12px] leading-snug text-muted lg:text-[13px]">{res.data.source}</p>
        </div>
      )}
    </Sheet>
  )
}

// 404 (no such train or stop in the history) and 503 (history file not loaded) are expected gaps, not failures.
export function Missing({ error, retry }: { error: Error; retry: () => void }) {
  useT()
  const status = error instanceof ApiError ? error.status : 0
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 text-[14px] leading-snug lg:text-[16px]">
      <p className="font-semibold">
        {status === 404 ? tr('kurtHasNoRunHistoryForThis') : status === 503 ? tr('theRunHistoryIsNotLoadedRight') : tr('kurtCouldNotReachTheRunHistory')}
      </p>
      {status === 404 && error.message && <p className="text-muted">{error.message.split(';')[0]}</p>}
      {status !== 404 && (
        <button type="button" onClick={retry} className="-my-2 inline-flex min-h-[44px] items-center self-start font-semibold text-accent-text underline">{tr('tryAgain')} </button>
      )}
    </div>
  )
}
