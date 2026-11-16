import { tr, useT } from '../i18n'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Pick } from '../api'
import { eur, hhmm } from '../format'
import { MIN_PAYOUT, payout } from '../payout'
import { Sheet } from './Sheet'
import { PriceInput, parsePrice } from './PriceForm'

export function BookSheet({ pick, tz, onClose }: { pick: Pick; tz: string; onClose: () => void }) {
  useT()
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const nav = useNavigate()
  const parsed = parsePrice(price)
  const even120 = parsed !== null && payout(parsed, 50) < MIN_PAYOUT

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (price.trim() && parsed === null) return setErr(tr('thatPriceDoesNotLookRightTry'))
    setBusy(true)
    setErr('')
    try {
      const c = await api.createTrip(pick, parsed ?? undefined)
      nav(`/trip/${encodeURIComponent(c.trip_id)}`)
    } catch (x) {
      setErr((x as Error).message || tr('couldNotSaveTheTrip'))
      setBusy(false)
    }
  }

  return (
    <Sheet title={tr('bookedIt')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-[14px] leading-snug text-muted">{tr('kurtWillWatchThe')} <span className="mono font-bold text-ink">{hhmm(pick.dep, tz)} → {hhmm(pick.arr, tz)}</span>{' '}
          ({pick.legs.map((l) => l.train).join(' + ')}{tr('andTellYouIfItIsLate')} </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="price" className="text-[14px] font-semibold">{tr('priceYouPaid')} <span className="font-normal text-muted">{tr('optionalShowsCashAmounts')}</span>
          </label>
          <PriceInput id="price" value={price} onChange={setPrice} />
          {parsed !== null && payout(parsed, 25) < MIN_PAYOUT && (
            <p className="text-[13px] leading-snug text-muted">{tr('at')} {eur(parsed)} {even120 ? tr('evenA120Minute') : tr('a60Minute')} {tr('delayPaysNothingInCash')}{even120 ? 50 : 25} % ={' '}
              {eur(payout(parsed, even120 ? 50 : 25))}{tr('dbSMinimumIs4ALifted')} </p>
          )}
        </div>
        {err && <p className="text-[13px] text-accent-text" role="alert">{err}</p>}
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? tr('saving') : tr('watchThisTrip')}
        </button>
      </form>
    </Sheet>
  )
}
