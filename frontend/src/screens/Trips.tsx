import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, type TripRef } from '../api'
import { Flap } from '../components/Flap'
import { IconChevron } from '../components/Icons'
import { ScreenHeader } from '../components/Shell'
import { Empty } from '../components/States'
import { changesLabel, dayLabel, hhmm, shortStation } from '../format'
import { useAsync } from '../hooks'
import { addTrip, loadTrips, removeTrip } from '../store'

const NO_REPLAY = 'spaetkauf.noReplay'
const noReplay = () => {
  try {
    return sessionStorage.getItem(NO_REPLAY) === '1'
  } catch {
    return false
  }
}

function Row({ r }: { r: TripRef }) {
  const [s] = useAsync(() => api.trip(r), [r.id], 30000)
  if (s.status === 'error' && s.error instanceof ApiError && s.error.status === 404) {
    removeTrip(r.id)
    return null
  }
  const t = s.status === 'ok' ? s.data : null
  const b = t?.booked
  const d = t ? (t.finished ? t.final_delay_min : t.delay_min) : null
  return (
    <Link
      to={`/trip/${encodeURIComponent(r.id)}`}
      className="flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border border-line px-3.5 py-3 no-underline"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        {b ? (
          <>
            <span className="mono whitespace-nowrap text-[15px] font-bold">
              {b.legs[0].dep ? `${hhmm(b.dep)} → ${hhmm(b.arr)}` : `due ${hhmm(b.arr)}`}{' '}
              <span className="font-sans text-[12px] font-semibold text-muted">{dayLabel(b.arr)}</span>
            </span>
            <span className="truncate text-[12px] text-muted">
              {shortStation(b.legs[0].from) || '…'} → {shortStation(b.legs[b.legs.length - 1].to)} · {changesLabel(b.changes)}
            </span>
            {t!.is_replay && (
              <span className="tag w-fit rounded bg-ink px-1.5 py-0.5 text-white">
                REPLAY{t!.replay_of ? ` · ${dayLabel(`${t!.replay_of}T12:00:00Z`).toUpperCase()}` : ''}
              </span>
            )}
          </>
        ) : (
          <span className="text-[14px] text-muted">{s.status === 'error' ? 'Could not load this trip' : 'Loading…'}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {t && d !== null ? (
          <span className="flex flex-col items-end gap-1">
            <Flap size="sm" text={`+${d}`} label={`plus ${d} minutes`} />
            <span className="text-[11px] font-semibold text-muted">
              {t.state === 'on_time' ? (t.finished ? 'finished' : 'on time') : t.state === 'unlocked' ? 'unlocked' : t.state === 'cancelled' ? 'cancelled' : t.state === 'cash25' ? '25 % back' : '50 % back'}
            </span>
          </span>
        ) : t ? (
          <span className="text-[12px] text-muted">waiting for data</span>
        ) : null}
        <IconChevron size={18} className="text-muted" />
      </span>
    </Link>
  )
}

export function Trips() {
  const nav = useNavigate()
  const [trips] = useState(loadTrips)
  const [hidden, setHidden] = useState(noReplay)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function replay() {
    setBusy(true)
    setErr('')
    try {
      const c = await api.demoReplay()
      addTrip(c)
      nav(`/trip/${encodeURIComponent(c.trip_id)}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        try {
          sessionStorage.setItem(NO_REPLAY, '1')
        } catch {
          /* ignore */
        }
        setHidden(true)
      } else setErr((e as Error).message)
      setBusy(false)
    }
  }

  const replayBtn = hidden ? null : (
    <button type="button" onClick={replay} disabled={busy} className="btn-ghost">
      {busy ? 'Starting…' : 'Play a replay'}
    </button>
  )

  return (
    <>
      <ScreenHeader title="My trips" />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {trips.length === 0 ? (
          <Empty
            title="No trips yet"
            action={
              <div className="flex flex-col gap-2">
                <Link to="/" className="btn-primary">Find late trains</Link>
                {replayBtn}
              </div>
            }
          >
            Book one of Kurt’s picks and tap “I booked this”. Kurt watches it from there.
          </Empty>
        ) : (
          <>
            {trips.map((r) => <Row key={r.id} r={r} />)}
            <div className="mt-1 flex flex-col gap-2">{replayBtn}</div>
          </>
        )}
        {err && <p className="text-[13px] text-accent-text" role="alert">{err}</p>}
        {!hidden && (
          <p className="text-center text-[12px] text-muted">A replay plays back a recorded real trip at higher speed and is labelled as such.</p>
        )}
      </div>
    </>
  )
}
