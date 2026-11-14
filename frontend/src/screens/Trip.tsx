import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, type Trip, type TripRef, type TripState } from '../api'
import { IconBack, IconBell, IconClose, IconTrash } from '../components/Icons'
import { Flap } from '../components/Flap'
import { Kurt } from '../components/Kurt'
import { Meter } from '../components/Meter'
import { hasOdds } from '../components/PickCard'
import { InlinePrice } from '../components/PriceForm'
import { ScreenHeader } from '../components/Shell'
import { Banners } from '../components/Signals'
import { Empty, ErrorState, Loading } from '../components/States'
import { changesLabel, dayLabel, eur, hhmm, longDate, minLabel, pctNum, signedMin, stopName, timeAgo } from '../format'
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
  if (prev === t.state || (t.booking_delay_excluded && t.state !== 'cancelled')) return null
  const d = t.delay_min !== null ? `+${t.delay_min}` : ''
  const stop = t.at_stop ? stopName(t.at_stop.name) : ''
  const money = (at: number) => {
    const a = t.thresholds.find((x) => x.at === at)?.amount_eur
    return a != null ? ` (${eur(a)})` : ''
  }
  // Compensation counts at the destination. Until the train is there, the money is conditional.
  const to = t.booked.legs[t.booked.legs.length - 1].to
  const atDest = t.finished || t.at_stop?.name === to
  const where = stop ? ` at ${stop}` : atDest ? '' : ' expected'
  const back = (what: string, at: number) =>
    atDest
      ? `${d} min${where}: ${what} of your ticket comes back${money(at)}.`
      : `${d} min${where}. If it ${stop ? `reaches ${stopName(to)}` : 'arrives'} this late, ${what} of your ticket comes back${money(at)}.`
  const msg = {
    unlocked: `It’s late. You win: ${d} min ${stop ? `at ${stop}` : 'expected'}. Ticket unlocked, ride any train.`,
    cash25: back('25 %', 60),
    cash50: back('half', 120),
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
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    if (state.status === 'error' && state.error instanceof ApiError && state.error.status === 404) {
      removeTrip(ref_.id)
      setGone(true)
    }
  }, [state, ref_.id])

  useEffect(() => {
    if (state.status !== 'ok' || state.stale) return
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
      <div className="flex flex-col gap-3 px-4 pb-8 lg:px-10 lg:pb-12">
        {state.status === 'loading' && <Loading label="Kurt is checking your train…" />}
        {state.status === 'error' && <ErrorState error={state.error} retry={retry} />}
        {deleteError && <p role="alert">{deleteError}</p>}
        {state.status === 'ok' && (
          <TripView
            t={{ ...state.data, stale: state.data.stale || !!state.stale }}
            ref_={ref_}
            reload={retry}
            alert={alert}
            dismiss={() => setAlert(null)}
            onDelete={async () => {
              setDeleteError('')
              try {
                await api.deleteTrip(ref_)
              } catch (error) {
                if (!(error instanceof ApiError && error.status === 404)) {
                  setDeleteError('Could not delete trip. Try again when connected.')
                  return
                }
              }
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
  // Lifted here so the conductor view stays open if the forecast drops while it is being shown.
  const [conductor, setConductor] = useState(false)
  // Auto-recorded trips (replays) know only the arrival, not the boarding time.
  const depKnown = !!first.dep
  const waiting = t.delay_min === null
  const delay = t.delay_min ?? 0
  const done = t.finished
  const finalDelay = t.final_delay_min ?? delay
  const wonUnlocked = t.state !== 'on_time'
  const doneOk = done && !waiting && finalDelay < 20 && t.state !== 'cancelled'
  const card = wonUnlocked && !doneOk ? 'bg-accent on-accent' : 'bg-surface'
  const cancelled = t.state === 'cancelled'
  const showClaim = !t.booking_delay_excluded && !waiting && !doneOk && (done || delay >= 60)
  const showSwitch = !done && wonUnlocked && !t.switched && !t.stale && !t.booking_delay_excluded
  const notYet = waiting && Date.now() < new Date(b.dep).getTime() - 3 * 3600_000
  // History runs carry Berlin local times stamped as UTC (docs/replays.md), so they are shown as UTC.
  const atStop = t.delay_basis === 'at_stop'
  const tz = atStop ? 'UTC' : undefined
  const stop = t.at_stop ? stopName(t.at_stop.name) : ''

  // Phone: one column, alert above the trip. Desktop: trip and live delay on the left; alert, switch or stay
  // and the rest on the right. The alert is rendered in both spots, each hidden at the other width.
  const alertBox = (show: string) =>
    alert && (
      <div role="status" aria-live="polite" className={`${show} items-start justify-between gap-2 rounded-xl border-2 border-ink bg-white p-3 lg:rounded-2xl lg:border-[3px] lg:p-4`}>
        <span className="flex gap-2 text-[14px] font-semibold leading-snug lg:gap-3 lg:text-[19px]">
          <IconBell size={20} className="mt-0.5 shrink-0 lg:h-6 lg:w-6" /> {alert}
        </span>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center">
          <IconClose size={18} />
        </button>
      </div>
    )

  return (
    <div className="contents lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-start lg:gap-x-10">
      <div className="contents lg:flex lg:flex-col lg:gap-4">
        {t.is_replay && (
          <div className="flex flex-col gap-0.5 rounded-xl bg-ink px-3 py-2.5 text-white lg:gap-1 lg:rounded-2xl lg:px-5 lg:py-4" role="note">
            <span className="text-[14px] font-bold lg:text-[18px]">
              Replay of {t.replay_of ? longDate(`${t.replay_of}T12:00:00Z`) : 'a recorded trip'}
              {atStop ? ' · past run' : ' · recorded live'}
            </span>
            <span className="text-[12px] leading-snug opacity-80 lg:text-[15px]">
              {atStop
                ? 'Delay measured at each stop, played back fast.'
                : `Kurt’s live forecast for ${dest}, played back fast.`}
            </span>
            {atStop && <span className="text-[11px] opacity-60 lg:text-[13px]">Delay history: piebro/deutsche-bahn-data (CC BY 4.0).</span>}
          </div>
        )}
        {alertBox('flex lg:hidden')}

        <div className="flex items-center justify-between rounded-2xl bg-surface px-3.5 py-3 lg:px-5 lg:py-4">
          <span className="flex min-w-0 flex-col lg:gap-0.5">
            <span className="mono font-bold lg:text-[22px]">
              {dayLabel(b.arr, tz)} {depKnown ? `${hhmm(b.dep, tz)} → ${hhmm(b.arr, tz)}` : `due ${hhmm(b.arr, tz)}`}
            </span>
            <span className="text-[13px] leading-snug text-muted lg:text-[16px]">
              {stopName(first.from) || '…'} → {dest} · {changesLabel(b.changes)}
            </span>
            <span className="text-[13px] text-muted lg:text-[16px]">
              {b.legs.map((l) => l.train).join(' + ')} · {t.price_eur !== null ? `ticket ${eur(t.price_eur)}` : 'no price entered'}
            </span>
          </span>
        </div>

        <section className={`${card} flex flex-col gap-3 rounded-[22px] p-4 lg:gap-5 lg:rounded-[28px] lg:p-7`} aria-label="Live delay">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-col gap-0.5 lg:gap-1.5">
              <span className="tag lg:!text-[16px]">{t.booking_delay_excluded && !cancelled ? 'DELAY KNOWN AT BOOKING' : waiting ? (t.is_replay ? 'REPLAY STARTING' : 'WAITING FOR LIVE DATA') : doneOk ? 'ARRIVED · ON TIME' : done ? `ARRIVED · ${LABEL[t.state]}` : LABEL[t.state]}</span>
              <span className="text-[13px] lg:text-[18px] lg:leading-snug">
                {done
                  ? finalDelay < 0 ? `Arrived ${-finalDelay} min early at ${dest}` : `Final delay at ${dest}`
                  : atStop
                    ? stop ? `Delay measured at ${stop}` : 'Delay measured at the last stop'
                    : `Expected delay at ${dest}`}
              </span>
            </span>
            {waiting ? (
              <span className="font-display text-[20px] font-bold lg:text-[44px]">–</span>
            ) : t.state === 'cancelled' ? (
              <span className="font-display text-[22px] font-bold lg:text-[40px]">Cancelled</span>
            ) : (
              <Flap text={signedMin(done ? finalDelay : delay)} label={minLabel(done ? finalDelay : delay)} />
            )}
          </div>
          {waiting ? (
            <p className="text-[14px] leading-snug lg:text-[17px]">
              {t.is_replay
                ? 'The recording starts in a moment.'
                : notYet
                ? `Kurt starts watching at ${hhmm(new Date(new Date(b.dep).getTime() - 3 * 3600_000).toISOString())}.`
                : 'No live data yet. This updates by itself.'}
            </p>
          ) : cancelled ? (
            <p className="text-[14px] font-semibold leading-snug lg:text-[18px]">Ride any train to {dest}, or ask DB for a full refund.</p>
          ) : doneOk || t.booking_delay_excluded ? null : (
            <Meter delay={done ? finalDelay : delay} thresholds={t.thresholds} />
          )}
          {t.stale && !done && !waiting ? (
            <p className="rounded-lg bg-white/70 px-3 py-2 text-[13px] font-semibold lg:text-[16px]" role="alert">
              Live data is stale (last {t.updated_at ? hhmm(t.updated_at) : 'unknown'}). Check the DB app.
            </p>
          ) : atStop ? (
            t.at_stop && (
              <p className="text-[12px] lg:text-[16px]">
                {done ? 'Arrived' : 'Reached'} {stop} {hhmm(t.at_stop.actual_arr, 'UTC')}, timetable {hhmm(t.at_stop.planned_arr, 'UTC')}
              </p>
            )
          ) : (
            <p className="text-[12px] lg:text-[16px]">
              {t.updated_at ? `Updated ${timeAgo(t.updated_at)}` : ''}
              {t.expected_arr && !done ? ` · now expected ${hhmm(t.expected_arr)}` : ''}
            </p>
          )}
          {t.booking_delay_excluded && (
            <p className="text-[14px] leading-snug" role="status">
              This delay was already posted when you booked. It does not unlock your ticket or qualify for compensation.
            </p>
          )}
          {doneOk && !t.booking_delay_excluded && <OnTime t={t} />}
          {done && !waiting && !t.booking_delay_excluded && !doneOk && finalDelay < 60 && (
            <p className="text-[14px] font-semibold leading-snug lg:text-[18px]">Unlocked, but under 60 late pays nothing back.</p>
          )}
        </section>
        {((wonUnlocked && !done && !t.is_replay) || conductor) && <Zugbindung t={t} dest={dest} full={conductor} setFull={setConductor} />}
      </div>

      <div className="contents lg:flex lg:flex-col lg:gap-4">
        {alertBox('hidden lg:flex')}

        {t.connection_at_risk && !done && (
          <p className="rounded-xl border-2 border-ink p-3 text-[14px] font-semibold leading-snug lg:text-[17px]" role="alert">
            Your change is at risk.
          </p>
        )}

        {showSwitch && <SwitchOrStay t={t} ref_={ref_} reload={reload} />}

        {t.switched && (
          <p className="rounded-xl bg-surface p-3 text-[13px] lg:text-[15px]">
            Switched. Money back only at 60+ late.
          </p>
        )}

        {t.price_eur === null && !done && (
          <div className="rounded-2xl border border-line p-3 lg:p-4">
            <p className="mb-2 text-[13px] text-muted lg:text-[15px]">Add the price to see amounts in euros.</p>
            <InlinePrice cta="Save" onSave={async (n) => { await api.patchTrip(ref_, { price_eur: n }); reload() }} />
          </div>
        )}

        {showClaim && (
          <Link to={`/trip/${encodeURIComponent(ref_.id)}/claim`} className="btn-primary">
            {done ? 'Claim helper' : 'Prepare your claim'}
          </Link>
        )}

        {!done && !t.is_replay && <BannerLoader t={t} />}
        {!done && <PushButton ref_={ref_} />}
        <DeleteButton onDelete={onDelete} />
      </div>
    </div>
  )
}

const DE_DAY = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin',
})

// The 20-minute forecast is the rule's trigger, but it is Transitous' figure, not DB's: say whose it is.
function Zugbindung({ t, dest, full, setFull }: { t: Trip; dest: string; full: boolean; setFull: (v: boolean) => void }) {
  const opener = useRef<HTMLButtonElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const b = t.booked
  const trains = b.legs.map((l) => l.train).join(' + ')
  const cancelled = t.state === 'cancelled'
  const d = t.delay_min ?? 0
  const asOf = t.updated_at ? hhmm(t.updated_at) : null
  useEffect(() => {
    if (!full) return
    const root = document.getElementById('root')
    const back = opener.current
    root?.setAttribute('inert', '')
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      root?.removeAttribute('inert')
      back?.focus()
    }
  }, [full, setFull])
  return (
    <section aria-label="Zugbindung" className="flex flex-col gap-2 rounded-2xl border-2 border-ink bg-white p-3.5 lg:p-5">
      <span className="tag">ZUGBINDUNG LIFTED AT 20+ MIN</span>
      <p className="text-[14px] font-semibold leading-snug lg:text-[17px]">
        {cancelled
          ? 'Your train is cancelled: under DB’s rule 9.1.1 (BB Personenverkehr) your Zugbindung is lifted once DB shows the cancellation.'
          : `Expected +${d} min at ${dest}: under DB’s rule 9.1.1 (BB Personenverkehr) your Zugbindung is lifted once DB shows 20+ min (rule 9.1.4).`}
      </p>
      <p className="mono text-[13px]">
        {trains} · due {hhmm(b.arr)}{t.expected_arr && !cancelled ? ` · expected ${hhmm(t.expected_arr)}` : ''}
      </p>
      <p className="text-[12px] text-muted">
        {asOf ? `As of ${asOf}. ` : ''}Transitous real-time data, not DB’s own. Check DB Navigator shows the delay too: the conductor goes by DB.
      </p>
      <button ref={opener} type="button" className="btn-primary" onClick={() => setFull(true)}>Show to conductor</button>
      {full && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Zugbindung aufgehoben" className="fixed inset-0 z-50 flex flex-col gap-5 overflow-y-auto bg-white p-6 text-black">
          <p className="font-display text-[34px] font-bold leading-tight">{cancelled ? 'Zug fällt aus' : `Verspätung am Ziel erwartet: +${d} Min.`}</p>
          <p className="text-[18px] font-semibold">Zugbindung aufgehoben nach BB Personenverkehr 9.1.1, sobald die DB mindestens 20 Min. Verspätung am Ziel erwartet (9.1.4).</p>
          <div className="flex flex-col gap-1 border-y-4 border-black py-4">
            <p className="mono text-[26px] font-bold">{trains}</p>
            <p className="text-[18px]">{stopName(b.legs[0].from)} → {dest}</p>
            <p className="text-[18px]">{DE_DAY.format(new Date(b.arr))}</p>
          </div>
          <p className="mono text-[22px] leading-snug">
            Ankunft planmäßig {hhmm(b.arr)}
            {cancelled ? <><br />Zug fällt aus</> : t.expected_arr && <><br />erwartet {hhmm(t.expected_arr)} (+{d} Min.)</>}
          </p>
          <p className="text-[15px]">{asOf ? `Stand ${asOf} Uhr · ` : ''}Echtzeitdaten von Transitous, nicht von der DB</p>
          <button ref={close} type="button" className="btn-primary mt-auto !min-h-[56px]" onClick={() => setFull(false)}>Close</button>
        </div>,
        document.body,
      )}
    </section>
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
            `${a60 !== null ? eur(a60) : '25 %'} now, ${a120 !== null ? eur(a120) : '50 %'} if it reaches 120 min late`,
          ]
        : [`Stay on the ${train}`, `${a60 !== null ? eur(a60) : '25 %'} back if it reaches 60 min late`]
  return (
    <section className="flex flex-col gap-2.5 rounded-[22px] border-2 border-ink p-3.5 lg:gap-3.5 lg:rounded-[28px] lg:border-[3px] lg:p-6" aria-label="Switch or stay">
      <h2 className="font-display text-[20px] font-bold lg:text-[30px]">Switch or stay?</h2>
      <p className="text-[13px] leading-snug text-muted lg:text-[16px]">
        {cancelled
          ? 'Your ticket now works on these trains. Tap the one you take.'
          : 'Switching to an earlier arrival gives up the cash back unless you still arrive 60+ late. Tap a train if you switched.'}
      </p>
      {alts.length === 0 && (
        <p className="text-[13px] leading-snug lg:text-[16px]">
          {t.is_replay
            ? 'A replay does not look up other trains. On a live trip, the ones you can still catch appear here.'
            : t.switching_before_departure_only
              ? 'Switching is only offered before departure from your booked origin.'
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
          className="relative flex min-h-[64px] flex-col items-start gap-0.5 rounded-xl border-2 border-ink px-3.5 py-2.5 text-left lg:px-5 lg:py-3.5"
        >
          {i === 0 && (a.delta_vs_expected_min ?? 0) < 0 && (
            <span className="tag absolute -top-2.5 right-3 rounded bg-ink px-1.5 py-0.5 text-white">KURT’S TIP</span>
          )}
          <span className="text-[15px] font-bold lg:text-[19px]">
            Switch: {hhmm(a.dep)} {a.trains.join(' + ')} → {hhmm(a.arr)}
          </span>
          <span className="text-[12px] leading-snug text-muted lg:text-[15px]">
            {vsExpected(a.delta_vs_expected_min)}leaves in {a.catchable_min} min · {changesLabel(a.changes)}
          </span>
          {a.forfeits_compensation === false && a.compensation_eur ? (
            <span className="text-[12px] font-semibold lg:text-[15px]">Still {eur(a.compensation_eur)} back: you arrive 60+ late anyway.</span>
          ) : null}
        </button>
      ))}
      {!cancelled && (
        <div className="flex flex-col gap-0.5 rounded-xl bg-tint px-3.5 py-2.5 lg:gap-1 lg:rounded-2xl lg:px-5 lg:py-4">
          <span className="text-[15px] font-bold lg:text-[22px] lg:leading-tight">{stay[0]}</span>
          <span className="text-[12px] text-muted lg:text-[18px] lg:font-semibold lg:text-ink">{stay[1]}</span>
        </div>
      )}
      <p className="text-[12px] text-muted lg:text-[14px]">Based on live data. Check the DB app before you board another train.</p>
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
    unsupported: 'This browser cannot show notifications. On iPhone, add Kurt to your Home Screen first. The screen still updates while open.',
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

function OnTime({ t }: { t: Trip }) {
  const wasUnlocked = t.peak_delay_min !== null && t.peak_delay_min >= 20
  const kurts = t.is_replay || t.booked.is_kurts_pick
  const o = t.booked.odds ?? null
  const p = hasOdds(o) ? pctNum(o.p20) : null
  const onTime = p === null ? 0 : Math.round((100 - p) / 10)
  return (
    <div className="flex items-start gap-2.5 lg:gap-3.5">
      <Kurt width={44} className="mt-0.5 shrink-0" />
      <div className="flex flex-col gap-1 lg:gap-1.5">
        <p className="text-[15px] font-bold leading-snug lg:text-[20px]">
          Arrived on time.{!wasUnlocked && kurts && ' Kurt was wrong on this one.'}
        </p>
        <p className="text-[13px] leading-snug lg:text-[17px]">
          {wasUnlocked ? `Unlocked at +${t.peak_delay_min}, nothing back.` : 'Nothing comes back.'}
          {!wasUnlocked && kurts && p !== null && ` About ${onTime < 1 ? 'fewer than 1' : onTime} in 10 such picks run on time.`}
        </p>
      </div>
    </div>
  )
}
