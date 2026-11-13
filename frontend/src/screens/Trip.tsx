import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, type Trip, type TripRef, type TripState } from '../api'
import { IconBack, IconBell, IconClose, IconTrash } from '../components/Icons'
import { Flap } from '../components/Flap'
import { Kurt } from '../components/Kurt'
import { Meter } from '../components/Meter'
import { InlinePrice } from '../components/PriceForm'
import { ScreenHeader } from '../components/Shell'
import { Banners } from '../components/Signals'
import { Empty, ErrorState, Loading } from '../components/States'
import { changesLabel, dayLabel, eur, hhmm, longDate, stopName, timeAgo } from '../format'
import { useAsync } from '../hooks'
import { enablePush, pushSupported } from '../push'
import { findTrip, removeTrip } from '../store'

const LABEL: Record<TripState, string> = {
  on_time: 'ON TIME SO FAR',
  unlocked: 'TICKET UNLOCKED',
  cash25: '25 % BACK',
  cash50: '50 % BACK',
  cancelled: 'CANCELLED · TICKET UNLOCKED',
}

// Same moments as the push alerts, shown in the app while this screen is open.
function alertFor(prev: TripState, t: Trip): string | null {
  if (prev === t.state) return null
  const d = t.delay_min !== null ? `+${t.delay_min}` : ''
  const money = (at: number) => {
    const a = t.thresholds.find((x) => x.at === at)?.amount_eur
    return a != null ? ` (${eur(a)})` : ''
  }
  const msg = {
    unlocked: `It’s late. You win: ${d} min expected. Ticket unlocked, ride any train.`,
    cash25: `${d} min: 25 % of your ticket comes back${money(60)}.`,
    cash50: `${d} min: half your ticket comes back${money(120)}.`,
    cancelled: 'Your train is cancelled. Ticket unlocked: ride any train, or get a full refund.',
    on_time: 'The expected delay dropped back under 20 minutes.',
  }[t.state]
  return t.is_replay ? `Replay · ${msg}` : msg
}

export function TripScreen() {
  const { id = '' } = useParams()
  const ref = findTrip(id)
  if (!ref) {
    return (
      <>
        <ScreenHeader title="Your trip" back={<BackLink />} />
        <Empty title="Trip not found" action={<Link to="/trips" className="btn-primary">My trips</Link>}>
          This trip is not saved on this device.
        </Empty>
      </>
    )
  }
  return <TripBody key={id} ref_={ref} />
}

const BackLink = () => (
  <Link to="/trips" aria-label="Back to my trips" className="-ml-3 flex h-11 w-11 items-center justify-center text-ink">
    <IconBack />
  </Link>
)

function TripBody({ ref_ }: { ref_: TripRef }) {
  const nav = useNavigate()
  // A replay runs in about a minute, so poll it fast; live trips every 20 s (D10).
  const [fast, setFast] = useState(false)
  const [state, retry] = useAsync(() => api.trip(ref_), [ref_.id], fast ? 2500 : 20000)
  const prev = useRef<TripState | null>(null)
  const [alert, setAlert] = useState<string | null>(null)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (state.status === 'error' && state.error instanceof ApiError && state.error.status === 404) {
      removeTrip(ref_.id)
      setGone(true)
    }
  }, [state, ref_.id])

  useEffect(() => {
    if (state.status !== 'ok') return
    if (prev.current && state.data.delay_min !== null) setAlert(alertFor(prev.current, state.data) ?? alert)
    prev.current = state.data.state
    setFast(state.data.is_replay && !state.data.finished)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (gone)
    return (
      <>
        <ScreenHeader title="Your trip" back={<BackLink />} />
        <Empty title="Trip not found" action={<Link to="/trips" className="btn-primary">My trips</Link>}>
          The server does not know this trip any more, so it was removed from this device.
        </Empty>
      </>
    )

  return (
    <>
      <ScreenHeader title="Your trip" back={<BackLink />} />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {state.status === 'loading' && <Loading label="Kurt is checking your train…" />}
        {state.status === 'error' && <ErrorState error={state.error} retry={retry} />}
        {state.status === 'ok' && (
          <TripView
            t={state.data}
            ref_={ref_}
            reload={retry}
            alert={alert}
            dismiss={() => setAlert(null)}
            onDelete={async () => {
              await api.deleteTrip(ref_).catch(() => undefined)
              removeTrip(ref_.id)
              nav('/trips')
            }}
          />
        )}
      </div>
    </>
  )
}

function TripView({
  t, ref_, reload, alert, dismiss, onDelete,
}: {
  t: Trip; ref_: TripRef; reload: () => void; alert: string | null; dismiss: () => void; onDelete: () => void
}) {
  const b = t.booked
  const first = b.legs[0]
  const last = b.legs[b.legs.length - 1]
  const dest = stopName(last.to) || 'your stop'
  // Auto-recorded trips (replays) know only the arrival, not the boarding time.
  const depKnown = !!first.dep
  const waiting = t.delay_min === null
  const delay = t.delay_min ?? 0
  const done = t.finished
  const finalDelay = t.final_delay_min ?? delay
  const wonUnlocked = t.state !== 'on_time'
  const doneOk = done && finalDelay < 20 && t.state !== 'cancelled'
  const card = doneOk ? 'bg-ok-tint' : wonUnlocked ? 'bg-accent on-accent' : 'bg-surface'
  const cancelled = t.state === 'cancelled'
  const showClaim = !doneOk && (done || delay >= 60)
  const showSwitch = !done && wonUnlocked && !t.switched
  const notYet = waiting && Date.now() < new Date(b.dep).getTime() - 3 * 3600_000

  return (
    <>
      {t.is_replay && (
        <div className="flex items-center gap-2 rounded-xl bg-ink px-3 py-2.5 text-white" role="note">
          <span className="flex flex-col">
            <span className="text-[14px] font-bold">
              Replay of {t.replay_of ? longDate(`${t.replay_of}T12:00:00Z`) : 'a recorded trip'}
            </span>
            <span className="text-[12px] opacity-80">A real recorded trip, played back fast. Not live.</span>
          </span>
        </div>
      )}
      {alert && (
        <div role="status" aria-live="polite" className="flex items-start justify-between gap-2 rounded-xl border-2 border-ink bg-white p-3">
          <span className="flex gap-2 text-[14px] font-semibold leading-snug">
            <IconBell size={20} className="mt-0.5 shrink-0" /> {alert}
          </span>
          <button type="button" onClick={dismiss} aria-label="Dismiss" className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center">
            <IconClose size={18} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between rounded-2xl bg-surface px-3.5 py-3">
        <span className="flex min-w-0 flex-col">
          <span className="mono font-bold">
            {dayLabel(b.arr)} {depKnown ? `${hhmm(b.dep)} → ${hhmm(b.arr)}` : `due ${hhmm(b.arr)}`}
          </span>
          <span className="text-[13px] leading-snug text-muted">
            {stopName(first.from) || '…'} → {dest} · {changesLabel(b.changes)}
          </span>
          <span className="text-[13px] text-muted">
            {b.legs.map((l) => l.train).join(' + ')} · {t.price_eur !== null ? `ticket ${eur(t.price_eur)}` : 'no price entered'}
          </span>
        </span>
      </div>

      <section className={`${card} flex flex-col gap-3 rounded-[22px] p-4`} aria-label="Live delay">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="tag">{doneOk ? 'ARRIVED · ON TIME' : done ? `ARRIVED · ${LABEL[t.state]}` : waiting ? 'WAITING FOR LIVE DATA' : LABEL[t.state]}</span>
            <span className="text-[13px]">{done ? `Final delay at ${dest}` : `Expected delay at ${dest}`}</span>
          </span>
          {waiting ? (
            <span className="font-display text-[20px] font-bold">–</span>
          ) : t.state === 'cancelled' ? (
            <span className="font-display text-[22px] font-bold">Cancelled</span>
          ) : (
            <Flap text={`+${done ? finalDelay : delay}`} label={`plus ${done ? finalDelay : delay} minutes`} />
          )}
        </div>
        {waiting ? (
          <p className="text-[14px] leading-snug">
            {t.is_replay
              ? 'The recording starts in a moment.'
              : notYet
              ? `Kurt starts watching at ${hhmm(new Date(new Date(b.dep).getTime() - 3 * 3600_000).toISOString())}, three hours before departure. This screen updates by itself.`
              : 'No live reading for this train yet. This screen updates by itself.'}
          </p>
        ) : cancelled ? (
          <p className="text-[14px] font-semibold leading-snug">Ride any train to {dest}, or ask DB for a full refund.</p>
        ) : doneOk ? null : (
          <Meter delay={done ? finalDelay : delay} thresholds={t.thresholds} />
        )}
        {t.stale && !done && !waiting ? (
          <p className="rounded-lg bg-white/70 px-3 py-2 text-[13px] font-semibold" role="alert">
            Live data is stale. Last update {t.updated_at ? hhmm(t.updated_at) : 'unknown'}. Check the DB app before you board another train.
          </p>
        ) : (
          <p className="text-[12px]">
            {t.updated_at ? `Updated ${timeAgo(t.updated_at)}` : ''}
            {t.expected_arr && !done ? ` · now expected ${hhmm(t.expected_arr)}` : ''}
          </p>
        )}
        {doneOk && (
          <p className="flex items-center gap-2 text-[15px] font-bold leading-snug">
            <Kurt width={44} shell="#E9F5EC" className="shrink-0" /> Nothing lost. You rode the cheap ticket.
          </p>
        )}
        {done && !doneOk && finalDelay < 60 && (
          <p className="text-[14px] font-semibold leading-snug">The ticket unlocked, but under 60 minutes late pays nothing back.</p>
        )}
      </section>

      {t.connection_at_risk && !done && (
        <p className="rounded-xl border-2 border-ink p-3 text-[14px] font-semibold leading-snug" role="alert">
          Your change is at risk: the first train is expected after the second one leaves.
        </p>
      )}

      {showSwitch && <SwitchOrStay t={t} ref_={ref_} reload={reload} />}

      {t.switched && (
        <p className="rounded-xl bg-surface p-3 text-[13px]">
          You marked this trip as switched. Compensation only applies if you still arrive 60+ minutes late.
        </p>
      )}

      {t.price_eur === null && !done && (
        <div className="rounded-2xl border border-line p-3">
          <p className="mb-2 text-[13px] text-muted">Add the price to see cash amounts on the meter.</p>
          <InlinePrice cta="Save" onSave={async (n) => { await api.patchTrip(ref_, { price_eur: n }); reload() }} />
        </div>
      )}

      {showClaim && (
        <Link to={`/trip/${encodeURIComponent(ref_.id)}/claim`} className="btn-primary">
          {done ? 'Claim helper' : 'Prepare your claim'}
        </Link>
      )}

      {wonUnlocked && !done && !t.is_replay && (
        <div className="flex items-end gap-2">
          <Kurt width={44} className="shrink-0" />
          <span className="rounded-2xl rounded-bl border-2 border-ink px-3 py-2.5 text-[14px] font-semibold leading-snug">
            Show your ticket as usual. The delay is your pass.
          </span>
        </div>
      )}

      {!done && !t.is_replay && <BannerLoader t={t} />}
      {!done && <PushButton ref_={ref_} />}
      <DeleteButton onDelete={onDelete} />
    </>
  )
}

function BannerLoader({ t }: { t: Trip }) {
  const l = t.booked.legs
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(t.booked.dep))
  const [s] = useAsync(
    () => api.signals({ from: stopName(l[0].from), to: stopName(l[l.length - 1].to), date }),
    [t.booked.id],
  )
  return <Banners s={s.status === 'ok' ? s.data : null} />
}

function SwitchOrStay({ t, ref_, reload }: { t: Trip; ref_: TripRef; reload: () => void }) {
  const [busy, setBusy] = useState(false)
  const alts = t.alternatives
  const cancelled = t.state === 'cancelled'
  const amount = (at: 60 | 120) =>
    (at === 60 ? t.stay?.amount_at_60_eur : t.stay?.amount_at_120_eur) ??
    t.thresholds.find((x) => x.at === at)?.amount_eur ??
    null
  const a60 = amount(60)
  const a120 = amount(120)
  const d = t.delay_min ?? 0
  const train = t.booked.legs[0].train
  const stay =
    d >= 120
      ? [`Stay on the ${train}: half back is yours`, `${a120 !== null ? eur(a120) : '50 %'} back at +120`]
      : d >= 60
        ? [
            `Stay on the ${train}: 25 % back is yours`,
            `${a60 !== null ? eur(a60) : '25 %'} now, ${a120 !== null ? eur(a120) : '50 %'} if it cracks +120`,
          ]
        : [`Stay on the ${train}, race to +60`, `${a60 !== null ? eur(a60) : '25 %'} back if it cracks +60`]
  return (
    <section className="flex flex-col gap-2.5 rounded-[22px] border-2 border-ink p-3.5" aria-label="Switch or stay">
      <h2 className="font-display text-[20px] font-bold">Switch or stay?</h2>
      <p className="text-[13px] leading-snug text-muted">
        {cancelled
          ? 'Your ticket now works on these trains. Tap the one you take.'
          : 'Switching to an earlier arrival gives up the cash back unless you still arrive 60+ late. Tap a train if you switched.'}
      </p>
      {alts.length === 0 && (
        <p className="text-[13px] leading-snug">
          {t.is_replay
            ? 'A replay does not look up other trains. On a live trip, the ones you can still catch appear here.'
            : 'No other train you can still catch right now. Kurt checks again as the delay moves.'}
        </p>
      )}
      {alts.map((a, i) => (
        <button
          key={a.dep + a.trains.join()}
          type="button"
          disabled={busy || t.switched}
          onClick={async () => {
            setBusy(true)
            await api.patchTrip(ref_, { switched: true }).catch(() => undefined)
            setBusy(false)
            reload()
          }}
          className="relative flex min-h-[64px] flex-col items-start gap-0.5 rounded-xl border-2 border-ink px-3.5 py-2.5 text-left"
        >
          {i === 0 && (a.delta_vs_expected_min ?? 0) < 0 && (
            <span className="tag absolute -top-2.5 right-3 rounded bg-ink px-1.5 py-0.5 text-white">KURT’S TIP</span>
          )}
          <span className="text-[15px] font-bold">
            Switch: {hhmm(a.dep)} {a.trains.join(' + ')} → {hhmm(a.arr)}
          </span>
          <span className="text-[12px] leading-snug text-muted">
            {vsExpected(a.delta_vs_expected_min)}leaves in {a.catchable_min} min · {changesLabel(a.changes)}
          </span>
          {a.forfeits_compensation === false && a.compensation_eur ? (
            <span className="text-[12px] font-semibold">Still {eur(a.compensation_eur)} back: you arrive 60+ late anyway.</span>
          ) : null}
        </button>
      ))}
      {!cancelled && (
        <div className="flex flex-col gap-0.5 rounded-xl bg-tint px-3.5 py-2.5">
          <span className="text-[15px] font-bold">{stay[0]}</span>
          <span className="text-[12px] text-muted">{stay[1]}</span>
        </div>
      )}
      <p className="text-[12px] text-muted">Based on live data. Check the DB app before you board another train.</p>
    </section>
  )
}

function vsExpected(d: number | null) {
  if (d === null) return ''
  if (d === 0) return 'arrives with your train · '
  return `${Math.abs(d)} min ${d < 0 ? 'before' : 'after'} your train is now expected · `
}

function PushButton({ ref_ }: { ref_: TripRef }) {
  const key = `spaetkauf.push.${ref_.id}`
  const [res, setRes] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  const [busy, setBusy] = useState(false)
  const msg: Record<string, string> = {
    ok: 'Notifications are on for this trip.',
    unsupported: 'This browser cannot show notifications. On iPhone, add Spätkauf to your Home Screen first. The screen still updates while open.',
    denied: 'Notifications are blocked for this site. Allow them in your browser settings. The screen still updates while open.',
    failed: 'Could not turn notifications on. Try again in the installed app.',
  }
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy || res === 'ok'}
        className="btn-ghost"
        onClick={async () => {
          if (!pushSupported()) return setRes('unsupported')
          setBusy(true)
          const r = await enablePush(ref_)
          setBusy(false)
          setRes(r)
          try {
            if (r === 'ok') localStorage.setItem(key, 'ok')
          } catch {
            /* ignore */
          }
        }}
      >
        <IconBell size={18} /> {res === 'ok' ? 'Notifications on' : 'Notify me about this trip'}
      </button>
      {res && <p className="text-[12px] leading-snug text-muted" role="status">{msg[res]}</p>}
    </div>
  )
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [sure, setSure] = useState(false)
  return sure ? (
    <div className="flex gap-2">
      <button type="button" className="btn-primary flex-1" onClick={onDelete}>
        Yes, delete trip
      </button>
      <button type="button" className="btn-ghost" onClick={() => setSure(false)}>
        Keep
      </button>
    </div>
  ) : (
    <button type="button" onClick={() => setSure(true)} className="flex min-h-[44px] items-center justify-center gap-1.5 text-[14px] font-semibold text-muted">
      <IconTrash size={16} /> Delete trip
    </button>
  )
}
