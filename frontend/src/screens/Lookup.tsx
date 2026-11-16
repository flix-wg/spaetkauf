import { tx, tr, useT } from '../i18n'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type HistoryQuery, type RouteTrains, type TrainStops } from '../api'
import { HistorySheet, Missing } from '../components/HistorySheet'
import { IconChevron, IconSearch } from '../components/Icons'
import { ScreenHeader } from '../components/Shell'
import { Loading } from '../components/States'
import { pctNum, stopName, weekdays, WEEKDAYS, weekdayPlural } from '../format'
import { useAsync } from '../hooks'

type Found = { kind: 'train'; d: TrainStops } | { kind: 'route'; d: RouteTrains } | null

const input = 'h-[52px] w-full min-w-0 rounded-xl border-[1.5px] border-line bg-page px-3 text-[16px] font-semibold focus:border-ink'
const label = 'mb-1 block text-[13px] font-semibold text-muted'

function Share({ v }: { v: number }) {
  useT()
  return <span className="mono shrink-0 rounded-full bg-tint px-2.5 py-1 text-[14px] font-bold lg:text-[17px]">{pctNum(v)}%</span>
}

function Row({ title, sub, share, onClick }: { title: React.ReactNode; sub: string; share: number; onClick: () => void }) {
  useT()
  return (
    <li>
      <button type="button" onClick={onClick} className="flex min-h-[60px] w-full items-center justify-between gap-3 rounded-2xl border border-line bg-page px-3.5 py-2.5 text-left hover:border-ink lg:px-5">
        <span className="flex min-w-0 flex-col">
          <span className="text-[16px] font-semibold leading-snug lg:text-[18px]">{title}</span>
          <span className="text-[12px] leading-snug text-muted lg:text-[14px]">{sub}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Share v={share} />
          <IconChevron size={18} className="text-muted" />
        </span>
      </button>
    </li>
  )
}

export function Lookup() {
  useT()
  const [sp, setSp] = useSearchParams()
  const by = sp.get('by') === 'route' ? 'route' : 'train'
  const wdParam = sp.get('wd')
  const weekday = wdParam === null || wdParam === '' ? undefined : Number(wdParam)
  const [train, setTrain] = useState(sp.get('train') ?? '')
  const [from, setFrom] = useState(sp.get('from') ?? '')
  const [to, setTo] = useState(sp.get('to') ?? '')
  const [wd, setWd] = useState(wdParam ?? '')
  const [hist, setHist] = useState<HistoryQuery | null>(null)
  const [err, setErr] = useState('')

  const asked = by === 'train' ? sp.get('train') : sp.get('from') && sp.get('to') ? `${sp.get('from')}|${sp.get('to')}` : null
  const [res, retry] = useAsync<Found>(
    () =>
      !asked
        ? Promise.resolve(null)
        : by === 'train'
          ? api.historyTrain(sp.get('train')!, weekday).then((d) => ({ kind: 'train' as const, d }))
          : api.historyRoute(sp.get('from')!, sp.get('to')!, weekday).then((d) => ({ kind: 'route' as const, d })),
    [by, asked, weekday],
  )

  const set = (o: Record<string, string>) => setSp(new URLSearchParams({ by, ...(wd ? { wd } : {}), ...o }))
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (by === 'train') {
      if (!train.trim()) return setErr(tr('enterATrainNumberForExampleIce'))
      set({ train: train.trim() })
    } else {
      if (!from.trim() || !to.trim()) return setErr(tr('enterBothStationsForExampleHamburgHbf'))
      set({ from: from.trim(), to: to.trim() })
    }
    setErr('')
  }
  const days = weekday === undefined ? tr('runs') : weekdayPlural(WEEKDAYS[weekday])

  return (
    <>
      <ScreenHeader title={tr('lookup')} />
      <div className="flex flex-col gap-4 px-5 pb-8 lg:grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:items-start lg:gap-x-10 lg:px-10 lg:pb-12">
        <div className="flex flex-col gap-4">
          <p className="text-[15px] leading-snug text-muted lg:text-[17px]">{tr('lookUpATrainOrARoute')} </p>
          <div role="radiogroup" aria-label={tr('lookUpBy')} className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
            {(['train', 'route'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={by === m}
                onClick={() => {
                  setErr('')
                  setSp(new URLSearchParams({ by: m }))
                }}
                className={`min-h-[44px] rounded-lg text-[15px] font-semibold ${by === m ? 'bg-page text-ink shadow-[0_1px_2px_var(--color-shadow)]' : 'text-muted hover:text-ink'}`}
              >
                {m === 'train' ? tr('aTrain') : tr('aRoute')}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3">
            {by === 'train' ? (
              <div>
                <label htmlFor="lk-train" className={label}>{tr('train')}</label>
                <input id="lk-train" value={train} onChange={(e) => setTrain(e.target.value)} placeholder={tr('eGIce1103')} autoComplete="off" className={input} />
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="lk-from" className={label}>{tr('from')}</label>
                  <input id="lk-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={tr('eGHamburgHbf')} autoComplete="off" className={input} />
                </div>
                <div>
                  <label htmlFor="lk-to" className={label}>{tr('to335')}</label>
                  <input id="lk-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder={tr('eGMNchenHbf')} autoComplete="off" className={input} />
                </div>
              </>
            )}
            <div>
              <label htmlFor="lk-wd" className={label}>{tr('weekday')}</label>
              <select id="lk-wd" value={wd} onChange={(e) => setWd(e.target.value)} className={input}>
                <option value="">{tr('anyDay')}</option>
                {weekdays().map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </div>
            {err && <p className="text-[13px] font-semibold text-accent-text" role="alert">{err}</p>}
            <button type="submit" className="btn-primary mt-1 !min-h-[54px] !text-[16px]">
              <IconSearch size={20} /> {tr('lookUp')} </button>
          </form>
        </div>
        <div className="flex flex-col gap-3">
          {res.status === 'loading' && <Loading label={tr('kurtIsReadingTheOldTimetables')} />}
          {res.status === 'error' && <Missing error={res.error} retry={retry} />}
          {res.status === 'ok' && res.data?.kind === 'train' && (
            <>
              <h2 className="font-display text-[20px] font-bold lg:text-[26px]">
                {res.data.d.train}
                <span className="block font-sans text-[13px] font-normal text-muted lg:text-[15px]">{tr('shareOf')} {days} {tr('20MinLateOrCancelledAtEach')}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {res.data.d.stops.map((s) => {
                  const t = (res.data!.d as TrainStops).train
                  return (
                    <Row key={s.key} title={stopName(s.stop) || s.stop} sub={tx('lookupRunCount', s.late20, s.n, days)} share={s.late20_share}
                      onClick={() => setHist({ train: t, stop: s.stop, weekday })} />
                  )
                })}
              </ul>
              <p className="text-[12px] leading-snug text-muted lg:text-[13px]">{res.data.d.source}</p>
            </>
          )}
          {res.status === 'ok' && res.data?.kind === 'route' && (
            <>
              <h2 className="font-display text-[20px] font-bold lg:text-[26px]">
                {stopName(res.data.d.from) || res.data.d.from} → {stopName(res.data.d.to) || res.data.d.to}
                <span className="block font-sans text-[13px] font-normal text-muted lg:text-[15px]">{tr('shareOf')} {days} {tr('20LateOrCancelledAt')} {stopName(res.data.d.to) || res.data.d.to}
                </span>
              </h2>
              {res.data.d.trains.length === 0 ? (
                <p className="rounded-2xl bg-surface p-4 text-[14px] text-muted">{tr('noTrainInTheHistoryRanFrom')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {res.data.d.trains.map((t) => {
                    const d = res.data!.d as RouteTrains
                    return (
                      <Row
                        key={t.train}
                        title={<>{t.train} <span className="mono font-normal text-muted">{t.dep ?? '–'} → {t.arr ?? '–'}</span></>}
                        sub={tx('lookupRunSummary', t.late20, t.n, days, pctNum(t.late60_share))}
                        share={t.late20_share}
                        onClick={() => setHist({ train: t.train, stop: d.to, weekday })}
                      />
                    )
                  })}
                </ul>
              )}
              <p className="text-[12px] leading-snug text-muted lg:text-[13px]">{res.data.d.source}</p>
            </>
          )}
        </div>
      </div>
      {hist && <HistorySheet q={hist} onClose={() => setHist(null)} />}
    </>
  )
}
