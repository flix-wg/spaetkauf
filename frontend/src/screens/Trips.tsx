import { tx, tr, useT } from '../i18n'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type TripRef } from '../api'
import { Flap } from '../components/Flap'
import { IconChevron } from '../components/Icons'
import { Interested } from '../components/Interested'
import { ScreenHeader } from '../components/Shell'
import { Empty } from '../components/States'
import { changesLabel, dayLabel, hhmm, minLabel, shortStation, signedMin } from '../format'
import { useAsync } from '../hooks'
import { loadTrips, removeTrip } from '../store'

function Row({ r }: { r: TripRef }) {
  useT()
  const [s] = useAsync(() => api.trip(r), [r.id], 30000)
  if (s.status === 'error' && s.error instanceof ApiError && s.error.status === 404) {
    removeTrip(r.id)
    return null
  }
  const t = s.status === 'ok' ? s.data : null
  const b = t?.booked
  const d = t ? (t.finished ? t.final_delay_min : t.delay_min) : null
  // History runs carry Berlin local times stamped as UTC.
  const tz = t?.delay_basis === 'at_stop' ? 'UTC' : undefined
  return (
    <Link
      to={`/trip/${encodeURIComponent(r.id)}`}
      className="flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border border-line px-3.5 py-3 no-underline lg:min-h-[88px] lg:px-5"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {b ? (
          <>
            {/* On a narrow phone the day drops under the times instead of running into the delay. */}
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="mono whitespace-nowrap text-[15px] font-bold lg:text-[20px]">
                {b.legs[0].dep ? `${hhmm(b.dep, tz)} → ${hhmm(b.arr, tz)}` : tx('savedTripDueAt', hhmm(b.arr, tz))}
              </span>
              <span className="whitespace-nowrap text-[12px] font-semibold text-muted lg:text-[15px]">{dayLabel(b.arr, tz)}</span>
            </span>
            <span className="truncate text-[12px] text-muted lg:text-[15px]">
              {shortStation(b.legs[0].from) || '…'} → {shortStation(b.legs[b.legs.length - 1].to)} · {changesLabel(b.changes)}
            </span>
            {t!.is_replay && (
              <span className="tag w-fit rounded bg-ink px-1.5 py-0.5 text-page">{tr('replay')} </span>
            )}
          </>
        ) : (
          <span className="text-[14px] text-muted">{s.status === 'error' ? tr('couldNotLoadThisTrip') : tr('loading')}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {t && d !== null ? (
          <span className="flex flex-col items-end gap-1">
            <Flap size="sm" text={signedMin(d)} label={minLabel(d)} />
            <span className="text-[11px] font-semibold text-muted lg:text-[14px]">
              {t.state === 'on_time' ? (t.finished ? tr('finished') : tr('onTime')) : t.state === 'unlocked' ? tr('ticketUnlocked') : t.state === 'cancelled' ? tr('cancelled') : t.state === 'cash25' ? tr('25Back501') : tr('50Back502')}
            </span>
          </span>
        ) : t ? (
          <span className="max-w-[72px] text-right text-[12px] leading-tight text-muted">{tr('waitingForData')}</span>
        ) : null}
        <IconChevron size={18} className="text-muted" />
      </span>
    </Link>
  )
}

export function Trips() {
  useT()
  const [trips] = useState(loadTrips)

  return (
    <>
      <ScreenHeader title={tr('myTrips')} />
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-4 pb-8 lg:px-10 lg:pb-12">
        {trips.length === 0 ? (
          <Empty title={tr('noTripsYet')} action={<Link to="/" className="btn-primary">{tr('findLateTrains')}</Link>}>{tr('bookOneOfKurtSPicksAnd')} </Empty>
        ) : (
          trips.map((r) => <Row key={r.id} r={r} />)
        )}
        <Interested feature="background" />
      </div>
    </>
  )
}
