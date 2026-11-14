import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Station } from '../api'
import { Kurt } from '../components/Kurt'
import { HowItWorks, Rules } from '../components/HowItWorks'
import { IconChevron, IconSearch, IconSwap } from '../components/Icons'
import { ScreenHeader } from '../components/Shell'
import { useSheet } from '../sheets'
import { useDebounced } from '../hooks'
import { nowHHMM, todayISO } from '../format'
import { loadTrips } from '../store'

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
  const [active, setActive] = useState(-1)
  const [focus, setFocus] = useState(false)
  const q = useDebounced(field.text, 200)
  const id = useRef(`st-${label}`).current
  useEffect(() => {
    setActive(-1)
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
        onChange={(e) => {
          setActive(-1)
          setList(null)
          onChange({ text: e.target.value, station: null })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setList(null)
            setActive(-1)
          } else if (focus && list?.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            const next = e.key === 'ArrowDown'
              ? (active + 1) % list.length
              : (active < 0 ? list.length - 1 : (active - 1 + list.length) % list.length)
            setActive(next)
            document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: 'nearest' })
          } else if (e.key === 'Enter' && focus && list && active >= 0) {
            e.preventDefault()
            const station = list[active]
            onChange({ text: station.name, station })
            setList(null)
            setActive(-1)
          }
        }}
        role="combobox"
        aria-expanded={focus && !!list}
        aria-autocomplete="list"
        aria-activedescendant={focus && list && active >= 0 ? `${id}-option-${active}` : undefined}
        aria-controls={`${id}-list`}
        className={`h-[52px] w-full rounded-xl border-[1.5px] bg-white pl-4 pr-14 text-[17px] font-semibold focus:border-ink ${error ? 'border-accent-text' : 'border-line'}`}
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
            list.map((s, i) => (
              <li key={s.id} id={`${id}-option-${i}`} role="option" aria-selected={active === i}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({ text: s.name, station: s })
                    setList(null)
                  }}
                  className={`flex min-h-[48px] w-full items-center px-4 text-left text-[16px] hover:bg-surface ${active === i ? 'bg-surface outline outline-2 outline-inset outline-ink' : ''}`}
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

const SEEN = 'spaetkauf.seen'

// Someone who has searched or booked before knows the idea; on a phone they get the form first.
function seenBefore() {
  try {
    return localStorage.getItem(SEEN) === '1' || loadTrips().length > 0
  } catch {
    return false
  }
}

export function Search() {
  const nav = useNavigate()
  const [seen] = useState(seenBefore)
  const { open } = useSheet()
  const [sp] = useSearchParams()
  const [from, setFrom] = useState<Field>({ text: sp.get('fn') ?? '', station: null })
  const [to, setTo] = useState<Field>({ text: sp.get('tn') ?? '', station: null })
  const [date, setDate] = useState(sp.get('date') ?? todayISO())
  const [time, setTime] = useState(sp.get('time') ?? nowHHMM())
  const [mode, setMode] = useState<'depart' | 'arrive'>(sp.get('mode') === 'arrive' ? 'arrive' : 'depart')
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
    if (mode === 'arrive') p.set('mode', 'arrive')
    const path = `/picks?${p}`
    try {
      sessionStorage.setItem('spaetkauf.lastSearch', path)
      localStorage.setItem(SEEN, '1')
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
      <ScreenHeader title="Kurt" deskOnly />
      <div className="flex flex-col gap-5 px-5 pb-8 pt-4 lg:pt-0 lg:grid lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)] lg:items-start lg:gap-x-14 lg:px-10 lg:pb-12">
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className={`${seen ? 'hidden lg:flex' : 'flex'} flex-col gap-3 rounded-[22px] bg-tint p-4 lg:p-6`}>
            <div className="flex items-end gap-3">
              <Kurt width={76} className="hidden shrink-0 lg:block" />
              <p className="text-[15px] font-semibold leading-snug lg:text-[20px]">
                Buy the cheap ticket for the train that’s usually late. Ride the better one.
              </p>
            </div>
            <div className="flex flex-col gap-2 lg:hidden">
              <Rules />
              <button type="button" onClick={() => open('sources')} className="min-h-[36px] self-start text-[14px] font-semibold text-accent-text underline">
                How it works, and exceptions
              </button>
            </div>
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
              className="absolute right-3 top-[58px] flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-muted hover:bg-surface"
            >
              <IconSwap size={20} className="rotate-90" />
            </button>
          </div>
          <div role="radiogroup" aria-label="The time is when you" className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
            {(['depart', 'arrive'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`min-h-[44px] rounded-lg text-[15px] font-semibold ${mode === m ? 'bg-white text-ink shadow-[0_1px_2px_rgba(20,22,26,0.12)]' : 'text-muted hover:text-ink'}`}
              >
                {m === 'depart' ? 'Depart at' : 'Arrive by'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="date" className="mb-1 block text-[13px] font-semibold text-muted">Date</label>
              <input id="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)}
                className="h-[52px] w-full min-w-0 rounded-xl border-[1.5px] border-line bg-white px-3 text-[16px] font-semibold focus:border-ink" />
            </div>
            <div>
              <label htmlFor="time" className="mb-1 block text-[13px] font-semibold text-muted">{mode === 'arrive' ? 'Arrive by' : 'Depart at'}</label>
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
        {seen && (
          <details className="group rounded-[22px] bg-tint lg:hidden">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-4 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
              What a delay gets you
              <IconChevron size={18} className="text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            </summary>
            <div className="flex flex-col gap-2 px-4 pb-4">
              <Rules untitled />
              <button type="button" onClick={() => open('sources')} className="min-h-[36px] self-start text-[14px] font-semibold text-accent-text underline">
                How it works, and exceptions
              </button>
            </div>
          </details>
        )}
        <button type="button" onClick={() => open('backtest')} className="min-h-[44px] self-start text-[14px] font-semibold text-accent-text underline">
          How good is Kurt?
        </button>
        </div>
        <div className="hidden rounded-[28px] bg-surface p-8 lg:block">
          <HowItWorks big />
        </div>
      </div>
    </>
  )
}
