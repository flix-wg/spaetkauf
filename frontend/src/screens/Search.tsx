import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Station } from '../api'
import { Kurt } from '../components/Kurt'
import { IconSearch, IconSwap } from '../components/Icons'
import { ScreenHeader } from '../components/Shell'
import { useSheet } from '../sheets'
import { useDebounced } from '../hooks'
import { nowHHMM, todayISO } from '../format'

interface Field {
  text: string
  station: Station | null
}

function StationField({
  label,
  field,
  onChange,
  error,
}: {
  label: string
  field: Field
  onChange: (f: Field) => void
  error?: string
}) {
  const [list, setList] = useState<Station[] | null>(null)
  const [focus, setFocus] = useState(false)
  const q = useDebounced(field.text, 200)
  const id = useRef(`st-${label}`).current
  useEffect(() => {
    if (!focus || field.station || q.trim().length < 2) return setList(null)
    let live = true
    api.stations(q.trim()).then(
      (r) => live && setList(r),
      () => live && setList(null),
    )
    return () => {
      live = false
    }
  }, [q, focus, field.station])

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        value={field.text}
        autoComplete="off"
        autoCapitalize="words"
        placeholder={label === 'From' ? 'Hamburg Hbf' : 'München Hbf'}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onChange={(e) => onChange({ text: e.target.value, station: null })}
        role="combobox"
        aria-expanded={!!list}
        aria-controls={`${id}-list`}
        className={`h-[52px] w-full rounded-xl border-[1.5px] bg-white px-4 text-[17px] font-semibold focus:border-ink ${error ? 'border-accent-text' : 'border-line'}`}
      />
      {error && <p className="mt-1 text-[13px] text-accent-text" role="alert">{error}</p>}
      {focus && list && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-[240px] overflow-auto rounded-xl border border-ink bg-white shadow-lg"
        >
          {list.length === 0 ? (
            <li className="px-4 py-3 text-[14px] text-muted">Nothing found. Keep typing or try another spelling.</li>
          ) : (
            list.map((s) => (
              <li key={s.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({ text: s.name, station: s })
                    setList(null)
                  }}
                  className="flex min-h-[48px] w-full items-center px-4 text-left text-[16px] hover:bg-surface"
                >
                  {s.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

export function Search() {
  const nav = useNavigate()
  const { open } = useSheet()
  const [sp] = useSearchParams()
  const [from, setFrom] = useState<Field>({ text: sp.get('fn') ?? '', station: null })
  const [to, setTo] = useState<Field>({ text: sp.get('tn') ?? '', station: null })
  const [date, setDate] = useState(sp.get('date') ?? todayISO())
  const [time, setTime] = useState(sp.get('time') ?? nowHHMM())
  const [errs, setErrs] = useState<{ from?: string; to?: string }>({})
  const [busy, setBusy] = useState(false)

  async function resolve(f: Field, who: 'from' | 'to') {
    if (f.station) return f.station
    const t = f.text.trim()
    if (!t) return who === 'from' ? Promise.reject('Where do you start?') : Promise.reject('Where are you going?')
    const r = await api.stations(t).catch(() => [])
    const exact = r.find((s) => s.name.toLowerCase() === t.toLowerCase()) ?? r[0]
    if (!exact) throw 'Kurt does not know that station.'
    return exact
  }

  async function go(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const [a, b] = await Promise.allSettled([resolve(from, 'from'), resolve(to, 'to')])
    const next = {
      from: a.status === 'rejected' ? String(a.reason) : undefined,
      to: b.status === 'rejected' ? String(b.reason) : undefined,
    }
    setErrs(next)
    setBusy(false)
    if (a.status !== 'fulfilled' || b.status !== 'fulfilled') return
    setFrom({ text: a.value.name, station: a.value })
    setTo({ text: b.value.name, station: b.value })
    const p = new URLSearchParams({ from: a.value.id, to: b.value.id, fn: a.value.name, tn: b.value.name, date, time })
    const path = `/picks?${p}`
    try {
      sessionStorage.setItem('spaetkauf.lastSearch', path)
    } catch {
      /* ignore */
    }
    nav(path)
  }

  const quick = (a: string, b: string) => {
    setFrom({ text: a, station: null })
    setTo({ text: b, station: null })
    setErrs({})
  }

  return (
    <>
      <ScreenHeader title="Spätkauf" />
      <div className="flex flex-col gap-5 px-5 pb-8">
        <div className="flex items-end gap-3 rounded-[22px] bg-tint p-4">
          <Kurt width={76} className="shrink-0" />
          <p className="text-[15px] font-semibold leading-snug">
            Buy the cheap ticket for the train that’s usually late. Ride the better one.
          </p>
        </div>
        <form onSubmit={go} className="flex flex-col gap-3">
          <div className="relative flex flex-col gap-3">
            <StationField label="From" field={from} onChange={setFrom} error={errs.from} />
            <StationField label="To" field={to} onChange={setTo} error={errs.to} />
            <button
              type="button"
              aria-label="Swap from and to"
              onClick={() => {
                setFrom(to)
                setTo(from)
              }}
              className="absolute right-3 top-[calc(50%-18px)] flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-muted hover:bg-surface"
            >
              <IconSwap size={20} className="rotate-90" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="date" className="mb-1 block text-[13px] font-semibold text-muted">Date</label>
              <input id="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)}
                className="h-[52px] w-full min-w-0 rounded-xl border-[1.5px] border-line bg-white px-3 text-[16px] font-semibold focus:border-ink" />
            </div>
            <div>
              <label htmlFor="time" className="mb-1 block text-[13px] font-semibold text-muted">Time</label>
              <input id="time" type="time" required value={time} onChange={(e) => setTime(e.target.value)}
                className="h-[52px] w-full min-w-0 rounded-xl border-[1.5px] border-line bg-white px-3 text-[16px] font-semibold focus:border-ink" />
            </div>
          </div>
          <button type="submit" disabled={busy} className="btn-primary mt-1 !min-h-[54px] !text-[16px]">
            <IconSearch size={20} /> {busy ? 'Looking…' : 'Find late trains'}
          </button>
        </form>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-muted">Try a busy route</span>
          <div className="flex flex-wrap gap-2">
            {[['Hamburg Hbf', 'München Hbf'], ['Berlin Hbf', 'Köln Hbf'], ['Frankfurt(Main)Hbf', 'Hannover Hbf']].map(([a, b]) => (
              <button key={a} type="button" onClick={() => quick(a, b)}
                className="min-h-[44px] rounded-full border border-line px-4 text-[14px] font-semibold hover:bg-surface">
                {a.replace(' Hbf', '').replace('(Main)Hbf', '')} → {b.replace(' Hbf', '')}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => open('backtest')} className="min-h-[44px] self-start text-[14px] font-semibold text-accent-text underline">
          How good is Kurt?
        </button>
      </div>
    </>
  )
}
