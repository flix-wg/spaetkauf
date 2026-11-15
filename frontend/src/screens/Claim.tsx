import { en, de } from '../i18n-core'
import { tx, tr, useT } from '../i18n'
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, type Claim } from '../api'
import { IconBack, IconCheck, IconCopy, IconExternal } from '../components/Icons'
import { Kurt } from '../components/Kurt'
import { InlinePrice } from '../components/PriceForm'
import { ScreenHeader } from '../components/Shell'
import { Empty, ErrorState, Loading } from '../components/States'
import { eur, hhmm, signedMin } from '../format'
import { useAsync } from '../hooks'
import { findTrip, removeTrip } from '../store'

async function copyText(v: string) {
  try {
    await navigator.clipboard.writeText(v)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = v
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

// The API sends ISO times; DB's form wants German dates and Berlin clock times.
const DE = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
})
function pasteable(v: string) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return DE.format(new Date(v)).replace(',', '')
  const d = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return d ? `${d[3]}.${d[2]}.${d[1]}` : v
}

// Copy-ready evidence for DB stays German in either UI language.
function proofText(c: Claim) {
  const ev = c.evidence!
  const f = Object.fromEntries(c.fields.map((x) => [x.label, pasteable(x.value)]))
  const field = (key: 'train' | 'date' | 'from' | 'to335') => f[en[key]] ?? f[de[key]] ?? ''
  const obs = ev.observations.map((o) => tx('proofObservation', hhmm(o.at), o.cancelled ? tr('proofCancellation') : tx('proofMinutes', signedMin(o.delay_min ?? 0))))
  return [
    tx('proofTrain', field('train')),
    tx('proofDate', field('date')),
    tx('proofRoute', field('from'), field('to335')),
    tx('proofScheduled', pasteable(ev.scheduled_arr)),
    ev.observed_arr && tx('proofArrival', c.provisional, pasteable(ev.observed_arr), signedMin(ev.delay_min)),
    tx('proofDelay', ev.delay_min),
    tr('proofObservations'),
    ...obs,
    c.is_replay ? tx('proofReplay', c.replay_of) : tr('proofSource'),
  ].filter(Boolean).join('\n')
}

function Proof({ c }: { c: Claim }) {
  useT()
  const ev = c.evidence!
  const [copied, setCopied] = useState(false)
  return (
    <details className="rounded-2xl border border-line p-3.5">
      <summary className="cursor-pointer font-display text-[16px] font-bold lg:text-[20px]">{tr('proofOfTheDelay')}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="mono text-[14px] font-semibold">{tr('scheduled')} {pasteable(ev.scheduled_arr)}
          {ev.observed_arr && <><br />{c.provisional ? tr('expected') : tr('observed')} {pasteable(ev.observed_arr)} ({signedMin(ev.delay_min)} {tr('min')}</>}
        </p>
        <ol className="flex flex-col border-l-2 border-line pl-3" aria-label={tr('observations')}>
          {ev.observations.map((o) => (
            <li key={o.at} className="mono flex justify-between gap-3 py-0.5 text-[13px]">
              <span className="text-muted">{hhmm(o.at)}</span>
              <span className="font-semibold">{o.cancelled ? tr('cancelled') : tx('claimDelayMinutes', signedMin(o.delay_min ?? 0))}</span>
            </li>
          ))}
        </ol>
        <p className="text-[12px] text-muted">{ev.source}</p>
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            await copyText(proofText(c))
            setCopied(true)
          }}
        >
          {copied ? <><IconCheck size={16} /> {tr('copied')}</> : <><IconCopy size={16} /> {tr('copyAsText')}</>}
        </button>
        <p className="sr-only" role="status" aria-live="polite">{copied ? tr('proofCopied') : ''}</p>
      </div>
    </details>
  )
}

export function ClaimScreen() {
  useT()
  const { id = '' } = useParams()
  const ref = findTrip(id)
  const [state, retry] = useAsync(() => (ref ? api.claim(ref) : Promise.reject(new ApiError(404, 'missing'))), [id])
  const [copied, setCopied] = useState('')
  const timer = useRef<number>(0)
  const back = (
    <Link to={`/trip/${encodeURIComponent(id)}`} aria-label={tr('backToTheTrip')} className="-ml-3 flex h-11 w-11 items-center justify-center text-ink">
      <IconBack />
    </Link>
  )

  if (state.status === 'error' && state.error instanceof ApiError && state.error.status === 404) {
    if (ref) removeTrip(id)
    return (
      <>
        <ScreenHeader title={tr('claimHelper')} back={back} />
        <Empty title={tr('tripNotFound')} action={<Link to="/trips" className="btn-primary">{tr('myTrips')}</Link>}>{tr('thisTripIsNotSavedOnThis')} </Empty>
      </>
    )
  }

  const c = state.status === 'ok' ? state.data : null
  const needsPrice = !!c && c.due && c.amount_eur === null
  const noPayout = !!c && !c.due

  return (
    <>
      <ScreenHeader title={tr('claimHelper')} back={back} />
      <div className={`flex flex-col gap-3 px-4 pb-8 lg:px-10 lg:pb-12 ${c ? 'lg:grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:items-start lg:gap-x-10' : ''}`}>
        {state.status === 'loading' && <Loading label={tr('kurtIsDoingTheSums')} />}
        {state.status === 'error' && <ErrorState error={state.error} retry={retry} />}
        {c && (
          <>
            <div className="contents lg:flex lg:flex-col lg:gap-3">
              {c.is_replay && <p className="tag">{tr('replayOf')} {c.replay_of} {tr('historicalDemoNoClaimToFile')}</p>}
              <section
                className={`${noPayout ? 'bg-surface' : 'bg-accent on-accent'} flex items-center gap-3 rounded-[22px] p-4 lg:rounded-[28px] lg:p-7`}
                aria-label={tr('compensation')}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="tag lg:!text-[15px]">{c.switched ? tr('actualArrivalNeeded') : c.provisional ? tr('compensationForecast') : noPayout ? tr('noPayoutDue') : needsPrice ? tx('percentOwed', c.pct) : tr('cashBack')}</span>
                  {c.amount_eur !== null && !noPayout ? (
                    <span className="mono text-[42px] font-bold leading-[1.1] lg:text-[64px]">{eur(c.amount_eur)}</span>
                  ) : needsPrice ? (
                    <span className="mono text-[42px] font-bold leading-[1.1] lg:text-[64px]">{c.pct} %</span>
                  ) : (
                    <span className="font-display text-[24px] font-bold leading-tight">{c.switched ? tr('checkYourArrival') : c.provisional ? tr('noPayoutForecast') : tr('nothingToClaim')}</span>
                  )}
                  <span className="text-[13px] leading-snug lg:text-[16px]">{c.reason}</span>
                  {c.provisional && !c.switched && <p className="mt-2 text-[13px]">{tr('thisAmountIsAForecastUntilKurt')}</p>}
                </div>
                <Kurt width={72} shell="#FFFFFF" body={noPayout ? 'var(--color-ink)' : '#14161A'} className="shrink-0" />
              </section>

              {needsPrice && (
                <div className="rounded-2xl border border-line p-3">
                  <p className="mb-2 text-[13px] text-muted">{tr('enterThePriceYouPaidAndKurt')}</p>
                  <InlinePrice
                    cta={tr('calculate')}
                    onSave={async (n) => {
                      await api.patchTrip(ref!, { price_eur: n })
                      retry()
                    }}
                  />
                </div>
              )}
            </div>

            <div className="contents lg:flex lg:flex-col lg:gap-3">
              {(c.due || c.switched) && (
                <ul className="flex flex-col" aria-label={tr('detailsToPasteIntoTheClaimForm')}>
                  {c.fields.filter((f) => f.value || (c.switched && (f.label === en.actualArrival || f.label === de.actualArrival))).map((f) => ({ ...f, value: pasteable(f.value) })).map((f) => (
                    <li key={f.label} className="border-b border-line">
                      <button
                        type="button"
                        disabled={!f.value}
                        onClick={async () => {
                          await copyText(f.value)
                          setCopied(f.label)
                          window.clearTimeout(timer.current)
                          timer.current = window.setTimeout(() => setCopied(''), 1800)
                        }}
                        className="flex min-h-[58px] w-full items-center justify-between gap-3 py-2 text-left"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[12px] text-muted">{f.label}</span>
                          <span className="text-[15px] font-semibold leading-snug">{f.value || tr('fillInYourActualArrival')}</span>
                        </span>
                        <span
                          className={`flex min-h-[44px] min-w-[76px] shrink-0 items-center justify-center gap-1 rounded-[10px] border-[1.5px] border-ink px-2 text-[13px] font-semibold ${copied === f.label ? 'bg-ink text-page' : 'bg-page'}`}
                        >
                          {!f.value ? tr('fillIn') : copied === f.label ? <><IconCheck size={16} /> {tr('copied')}</> : <><IconCopy size={16} /> {tr('copy')}</>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="sr-only" role="status" aria-live="polite">{copied ? tx('fieldCopied', copied) : ''}</p>

              {c.evidence && (c.due || Math.abs(c.evidence.delay_min - 60) <= 10) && <Proof c={c} />}

              <div className="flex flex-col gap-2 rounded-2xl bg-surface p-3.5">
                <h2 className="font-display text-[16px] font-bold lg:text-[20px]">{tr('whereToFile')}</h2>
                <p className="text-[13px] leading-snug lg:text-[15px]">{c.where}</p>
                {c.due && !c.is_replay && !c.provisional && (
                  <a href="https://www.bahn.de/service/fahrgastrechte" target="_blank" rel="noopener noreferrer" className="btn-primary mt-1">{tr('openDbSRefundPage')} <IconExternal size={18} />
                  </a>
                )}
                <p className="text-[12px] text-muted">{tr('youPasteYouAddYourBankDetails')}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
