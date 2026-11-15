import { tr, useT } from '../i18n'
import { useState } from 'react'

export const parsePrice = (s: string) => {
  const n = Number(s.trim().replace(',', '.'))
  return s.trim() !== '' && Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 100) / 100 : null
}

export function PriceInput({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (v: string) => void
  id: string
}) {
  useT()
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-muted">€</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder={tr('priceExample')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mono h-12 w-full rounded-xl border-[1.5px] border-line bg-page pl-9 pr-3 text-[18px] font-bold focus:border-ink"
      />
    </div>
  )
}

export function InlinePrice({ onSave, cta }: { onSave: (n: number) => Promise<void>; cta: string }) {
  useT()
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const n = parsePrice(v)
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (n === null) return setErr(tr('enterThePriceYouPaidLike34'))
        setBusy(true)
        setErr('')
        try {
          await onSave(n)
        } catch {
          setErr(tr('couldNotSaveThePriceTryAgain'))
        } finally {
          setBusy(false)
        }
      }}
    >
      <label htmlFor="inline-price" className="text-[13px] font-semibold">{tr('ticketPrice')} </label>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <PriceInput id="inline-price" value={v} onChange={setV} />
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {cta}
        </button>
      </div>
      {err && <p className="text-[13px] text-accent-text" role="alert">{err}</p>}
    </form>
  )
}
