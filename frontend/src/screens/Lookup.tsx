import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type HistoryQuery, type RouteTrains, type TrainStops } from '../api'
import { HistorySheet, Missing } from '../components/HistorySheet'
import { IconChevron, IconSearch } from '../components/Icons'
import { ScreenHeader } from '../components/Shell'
import { Loading } from '../components/States'
import { pctNum, stopName, WEEKDAYS } from '../format'
import { useAsync } from '../hooks'

type Found = { kind: 'train'; d: TrainStops } | { kind: 'route'; d: RouteTrains } | null

const input = 'h-[52px] w-full min-w-0 rounded-xl border-[1.5px] border-line bg-white px-3 text-[16px] font-semibold focus:border-ink'
const label = 'mb-1 block text-[13px] font-semibold text-muted'

function Share({ v }: { v: number }) {
  return <span className="mono shrink-0 rounded-full bg-tint px-2.5 py-1 text-[14px] font-bold lg:text-[17px]">{pctNum(v)}%</span>
}

function Row({ title, sub, share, onClick }: { title: React.ReactNode; sub: string; share: number; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex min-h-[60px] w-full items-center justify-between gap-3 rounded-2xl border border-line bg-white px-3.5 py-2.5 text-left hover:border-ink lg:px-5">
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
  const [sp, setSp] = useSearchParams()
  const by = sp.get('by') === 'route' ? 'route' : 'train'
  const wdParam = sp.get('wd')
  const weekday = wdParam === null || wdParam === '' ? undefined : Number(wdParam)
  const [train, setTrain] = useState(sp.get('train') ?? '')
  const [from, setFrom] = useState(sp.get('from') ?? '')
  const [to, setTo] = useState(sp.get('to') ?? '')
  const [wd, setWd] = useState(wdParam ?? '')
  const [hist, setHist] = useState<HistoryQuery | null>(null)

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
      if (train.trim()) set({ train: train.trim() })
    } else if (from.trim() && to.trim()) set({ from: from.trim(), to: to.trim() })
  }
  const days = weekday === undefined ? 'runs' : `${WEEKDAYS[weekday]}s`

  return (
    <>
      <ScreenHeader title="Lookup" />
      <div className="flex flex-col gap-4 px-5 pb-8 lg:grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:items-start lg:gap-x-10 lg:px-10 lg:pb-12">
        <div className="flex flex-col gap-4">
          <p className="text-[15px] leading-snug text-muted lg:text-[17px]">
            Every number Kurt shows comes from past runs. Look up a train or a route and tap a row to see the runs.
          </p>
          <div role="radiogroup" aria-label="Look up by" className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
            {(['train', 'route'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={by === m}
                onClick={() => setSp(new URLSearchParams({ by: m }))}
                className={`min-h-[44px] rounded-lg text-[15px] font-semibold ${by === m ? 'bg-white text-ink shadow-[0_1px_2px_rgba(20,22,26,0.12)]' : 'text-muted hover:text-ink'}`}
              >
                {m === 'train' ? 'A train' : 'A route'}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3">
            {by === 'train' ? (
              <div>
                <label htmlFor="lk-train" className={label}>Train</label>
                <input id="lk-train" value={train} onChange={(e) => setTrain(e.target.value)} placeholder="ICE 1103" autoComplete="off" className={input} />
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="lk-from" className={label}>From</label>
                  <input id="lk-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Hamburg Hbf" autoComplete="off" className={input} />
                </div>
                <div>
                  <label htmlFor="lk-to" className={label}>To</label>
                  <input id="lk-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="München Hbf" autoComplete="off" className={input} />
                </div>
              </>
            )}
            <div>
              <label htmlFor="lk-wd" className={label}>Weekday</label>
              <select id="lk-wd" value={wd} onChange={(e) => setWd(e.target.value)} className={input}>
                <option value="">Any day</option>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary mt-1 !min-h-[54px] !text-[16px]">
              <IconSearch size={20} /> Look up
            </button>
          </form>
        </div>
        <div className="flex flex-col gap-3">
          {res.status === 'loading' && <Loading label="Kurt is reading the old timetables…" />}
          {res.status === 'error' && <Missing error={res.error} retry={retry} />}
          {res.status === 'ok' && res.data?.kind === 'train' && (
            <>
              <h2 className="font-display text-[20px] font-bold lg:text-[26px]">
                {res.data.d.train}
                <span className="block font-sans text-[13px] font-normal text-muted lg:text-[15px]">Share of {days} 20+ min late or cancelled at each stop</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {res.data.d.stops.map((s) => {
                  const t = (res.data!.d as TrainStops).train
                  return (
                    <Row key={s.key} title={stopName(s.stop) || s.stop} sub={`${s.late20} of ${s.n} ${days}`} share={s.late20_share}
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
                <span className="block font-sans text-[13px] font-normal text-muted lg:text-[15px]">
                  Trains that served both, by usual departure. Share of {days} 20+ min late or cancelled at {stopName(res.data.d.to) || res.data.d.to}.
                </span>
              </h2>
              {res.data.d.trains.length === 0 ? (
                <p className="rounded-2xl bg-surface p-4 text-[14px] text-muted">No train in the history ran from the first stop to the second.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {res.data.d.trains.map((t) => {
                    const d = res.data!.d as RouteTrains
                    return (
                      <Row
                        key={t.train}
                        title={<>{t.train} <span className="mono font-normal text-muted">{t.dep ?? '–'} → {t.arr ?? '–'}</span></>}
                        sub={`${t.late20} of ${t.n} ${days} · 60+ late: ${pctNum(t.late60_share)} %`}
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
