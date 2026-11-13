import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { IconBack, IconCheck, IconCopy, IconExternal } from '../components/Icons'
import { Kurt } from '../components/Kurt'
import { InlinePrice } from '../components/PriceForm'
import { ScreenHeader } from '../components/Shell'
import { Empty, ErrorState, Loading } from '../components/States'
import { eur } from '../format'
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

export function ClaimScreen() {
  const { id = '' } = useParams()
  const ref = findTrip(id)
  const [state, retry] = useAsync(() => (ref ? api.claim(ref) : Promise.reject(new ApiError(404, 'missing'))), [id])
  const [copied, setCopied] = useState('')
  const timer = useRef<number>(0)
  const back = (
    <Link to={`/trip/${encodeURIComponent(id)}`} aria-label="Back to the trip" className="-ml-3 flex h-11 w-11 items-center justify-center text-ink">
      <IconBack />
    </Link>
  )

  if (state.status === 'error' && state.error instanceof ApiError && state.error.status === 404) {
    if (ref) removeTrip(id)
    return (
      <>
        <ScreenHeader title="Claim helper" back={back} />
        <Empty title="Trip not found" action={<Link to="/trips" className="btn-primary">My trips</Link>}>
          This trip is not saved on this device or the server forgot it.
        </Empty>
      </>
    )
  }

  const c = state.status === 'ok' ? state.data : null
  const needsPrice = !!c && c.due && c.amount_eur === null
  const noPayout = !!c && !c.due

  return (
    <>
      <ScreenHeader title="Claim helper" back={back} />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {state.status === 'loading' && <Loading label="Kurt is doing the sums…" />}
        {state.status === 'error' && <ErrorState error={state.error} retry={retry} />}
        {c && (
          <>
            <section
              className={`${noPayout ? 'bg-surface' : 'bg-accent on-accent'} flex items-center gap-3 rounded-[22px] p-4`}
              aria-label="Compensation"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="tag">{noPayout ? 'NO PAYOUT DUE' : needsPrice ? `${c.pct} % OWED` : 'CASH BACK'}</span>
                {c.amount_eur !== null && !noPayout ? (
                  <span className="mono text-[42px] font-bold leading-[1.1]">{eur(c.amount_eur)}</span>
                ) : needsPrice ? (
                  <span className="mono text-[42px] font-bold leading-[1.1]">{c.pct} %</span>
                ) : (
                  <span className="font-display text-[24px] font-bold leading-tight">Nothing to claim</span>
                )}
                <span className="text-[13px] leading-snug">{c.reason}</span>
              </div>
              <Kurt width={72} shell="#FFFFFF" className="shrink-0" />
            </section>

            {needsPrice && (
              <div className="rounded-2xl border border-line p-3">
                <p className="mb-2 text-[13px] text-muted">Enter the price you paid and Kurt works out the amount.</p>
                <InlinePrice
                  cta="Calculate"
                  onSave={async (n) => {
                    await api.patchTrip(ref!, { price_eur: n })
                    retry()
                  }}
                />
              </div>
            )}

            {c.due && (
              <ul className="flex flex-col" aria-label="Details to paste into the claim form">
                {c.fields.filter((f) => f.value).map((f) => ({ ...f, value: pasteable(f.value) })).map((f) => (
                  <li key={f.label} className="border-b border-line">
                    <button
                      type="button"
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
                        <span className="text-[15px] font-semibold leading-snug">{f.value}</span>
                      </span>
                      <span
                        className={`flex min-h-[44px] min-w-[76px] shrink-0 items-center justify-center gap-1 rounded-[10px] border-[1.5px] border-ink px-2 text-[13px] font-semibold ${copied === f.label ? 'bg-ink text-white' : 'bg-white'}`}
                      >
                        {copied === f.label ? <><IconCheck size={16} /> Copied</> : <><IconCopy size={16} /> Copy</>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="sr-only" role="status" aria-live="polite">{copied ? `${copied} copied` : ''}</p>

            <div className="flex flex-col gap-2 rounded-2xl bg-surface p-3.5">
              <h2 className="font-display text-[16px] font-bold">Where to file</h2>
              <p className="text-[13px] leading-snug">{c.where}</p>
              {c.due && (
                <a href="https://www.bahn.de/service/fahrgastrechte" target="_blank" rel="noopener noreferrer" className="btn-primary mt-1">
                  Open DB’s refund page <IconExternal size={18} />
                </a>
              )}
              <p className="text-[12px] text-muted">You paste, you add your bank details yourself, you send. Spätkauf never files for you.</p>
            </div>
          </>
        )}
      </div>
    </>
  )
}
