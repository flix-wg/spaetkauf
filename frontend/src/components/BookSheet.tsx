import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Pick } from '../api'
import { eur, hhmm } from '../format'
import { MIN_PAYOUT, payout } from '../payout'
import { addTrip } from '../store'
import { Sheet } from './Sheet'
import { PriceInput, parsePrice } from './PriceForm'

export function BookSheet({ pick, tz, onClose }: { pick: Pick; tz: string; onClose: () => void }) {
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const nav = useNavigate()
  const parsed = parsePrice(price)
  const even120 = parsed !== null && payout(parsed, 50) < MIN_PAYOUT

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (price.trim() && parsed === null) return setErr('That price does not look right. Try 34.99 or leave it empty.')
    setBusy(true)
    setErr('')
    try {
      const c = await api.createTrip(pick, parsed ?? undefined)
      addTrip(c)
      nav(`/trip/${encodeURIComponent(c.trip_id)}`)
    } catch (x) {
      setErr((x as Error).message || 'Could not save the trip.')
      setBusy(false)
    }
  }

  return (
    <Sheet title="Booked it?" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-[14px] leading-snug text-muted">
          Kurt will watch the <span className="mono font-bold text-ink">{hhmm(pick.dep, tz)} → {hhmm(pick.arr, tz)}</span>{' '}
          ({pick.legs.map((l) => l.train).join(' + ')}) and tell you if it is late. The trip stays on this device.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="price" className="text-[14px] font-semibold">
            Price you paid <span className="font-normal text-muted">(optional, shows cash amounts)</span>
          </label>
          <PriceInput id="price" value={price} onChange={setPrice} />
          {parsed !== null && payout(parsed, 25) < MIN_PAYOUT && (
            <p className="text-[13px] leading-snug text-muted">
              At {eur(parsed)} {even120 ? 'even a 120-minute' : 'a 60-minute'} delay pays nothing in cash ({even120 ? 50 : 25} % ={' '}
              {eur(payout(parsed, even120 ? 50 : 25))}, DB’s minimum is €4). A lifted Zugbindung at 20+ min, and a full refund if you give up the trip at 60+ min, still apply.
            </p>
          )}
        </div>
        {err && <p className="text-[13px] text-accent-text" role="alert">{err}</p>}
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Saving…' : 'Watch this trip'}
        </button>
      </form>
    </Sheet>
  )
}
