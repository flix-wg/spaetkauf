import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, type Recording, type TripRef } from '../api'
import { Flap } from '../components/Flap'
import { IconChevron } from '../components/Icons'
import { ScreenHeader } from '../components/Shell'
import { Empty } from '../components/States'
import { changesLabel, dayLabel, hhmm, shortStation } from '../format'
import { useAsync } from '../hooks'
import { addTrip, loadTrips, removeTrip } from '../store'

function Row({ r }: { r: TripRef }) {
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
      <span className="flex min-w-0 flex-col gap-0.5">
        {b ? (
          <>
            <span className="mono whitespace-nowrap text-[15px] font-bold lg:text-[20px]">
              {b.legs[0].dep ? `${hhmm(b.dep, tz)} → ${hhmm(b.arr, tz)}` : `due ${hhmm(b.arr, tz)}`}{' '}
              <span className="font-sans text-[12px] font-semibold text-muted lg:text-[15px]">{dayLabel(b.arr, tz)}</span>
            </span>
            <span className="truncate text-[12px] text-muted lg:text-[15px]">
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
            <span className="text-[11px] font-semibold text-muted lg:text-[14px]">
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

const crossing = (r: Recording) =>
  r.crosses_60
    ? 'crosses +20, then +60'
    : r.crosses_20
      ? 'crosses +20'
      : r.max_delay_min >= 20
        ? 'already +20 at the start'
        : 'stays under +20'

function RecordingRow({ r, busy, onPlay }: { r: Recording; busy: boolean; onPlay: () => void }) {
  const past = r.source === 'history'
  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={busy}
      className="flex min-h-[64px] w-full items-center justify-between gap-3 rounded-2xl border border-line px-3.5 py-3 text-left disabled:opacity-60 lg:min-h-[84px] lg:px-5 lg:hover:border-ink"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-bold lg:text-[19px]">
          {r.train}{' '}
          <span className="text-[12px] font-semibold text-muted lg:text-[15px]">{dayLabel(`${r.date}T12:00:00Z`)}</span>
        </span>
        <span className="truncate text-[12px] text-muted lg:text-[15px]">
          {shortStation(r.from) || '…'} → {shortStation(r.to)} · {crossing(r)}
        </span>
        <span className={`tag w-fit rounded px-1.5 py-0.5 ${past ? 'bg-ink text-white' : 'bg-tint text-accent-text'}`}>
          {past ? 'PAST RUN · DB DELAY DATA' : 'RECORDED LIVE'}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="mono text-[17px] font-bold lg:text-[24px]">+{r.max_delay_min}</span>
        <span className="text-[11px] font-semibold text-muted lg:text-[14px]">{busy ? 'starting…' : 'worst'}</span>
      </span>
    </button>
  )
}

function Replays() {
  const nav = useNavigate()
  const [recs] = useAsync(() => api.recordings(), [])
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  if (recs.status !== 'ok' || recs.data.length === 0) return null
  const list = all ? recs.data : recs.data.slice(0, 4)

  async function play(id: string) {
    setBusy(id)
    setErr('')
    try {
      const c = await api.demoReplay(id)
      addTrip(c)
      nav(`/trip/${encodeURIComponent(c.trip_id)}`)
    } catch (e) {
      setErr((e as Error).message)
      setBusy('')
    }
  }

  return (
    <section className="mt-3 flex flex-col gap-2 lg:mt-0 lg:gap-3" aria-label="Replays">
      <h2 className="font-display text-[18px] font-bold lg:text-[26px]">Watch a replay</h2>
      <p className="-mt-1 text-[12px] leading-snug text-muted lg:text-[15px]">
        Real late trains, played back in about a minute and labelled as replays. Past runs show the delay measured at
        each stop; live recordings show the forecast Kurt saw for the destination.
      </p>
      {list.map((r) => (
        <RecordingRow key={r.id} r={r} busy={busy === r.id} onPlay={() => play(r.id)} />
      ))}
      {recs.data.length > list.length && (
        <button type="button" onClick={() => setAll(true)} className="btn-ghost">
          All {recs.data.length} replays
        </button>
      )}
      {err && <p className="text-[13px] text-accent-text" role="alert">{err}</p>}
    </section>
  )
}

export function Trips() {
  const [trips] = useState(loadTrips)

  return (
    <>
      <ScreenHeader title="My trips" />
      {/* Desktop: your trips on the left, replays on the right. */}
      <div className="flex flex-col gap-3 px-4 pb-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10 lg:px-10 lg:pb-12">
        <div className="contents lg:flex lg:flex-col lg:gap-3">
          {trips.length === 0 ? (
            <Empty title="No trips yet" action={<Link to="/" className="btn-primary">Find late trains</Link>}>
              Book one of Kurt’s picks and tap “I booked this”. Kurt watches it from there.
            </Empty>
          ) : (
            trips.map((r) => <Row key={r.id} r={r} />)
          )}
        </div>
        <Replays />
      </div>
    </>
  )
}
