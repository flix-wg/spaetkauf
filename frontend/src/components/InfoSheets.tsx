import { api, type Backtest } from '../api'
import { dateOnly } from '../format'
import { useAsync } from '../hooks'
import { useSheet } from '../sheets'
import { ErrorState, Loading } from './States'
import { HowItWorks } from './HowItWorks'

const SOURCES = [
  ['Transitous', 'Routes, trains and live delays (open MOTIS service).'],
  ['piebro/deutsche-bahn-data', 'Past arrival delays behind every percentage, licence CC BY 4.0.'],
  ['Exa', 'Cited news on strikes, closures and track works for your day. Kurt’s pick warns when past runs may not cover them.'],
  ['Context.dev', 'Watches strike announcement pages for changes.'],
]

export function SourcesSheet() {
  const { open } = useSheet()
  const [bt] = useAsync(() => api.backtest(), [])
  const range =
    bt.status === 'ok' ? `${dateOnly(bt.data.train_period.from)} to ${dateOnly(bt.data.test_period.to)}` : null
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-snug lg:text-[16px]">
      <HowItWorks />
      <h3 className="mt-2 font-display text-[18px] font-bold lg:text-[20px]">Sources</h3>
      <p className="rounded-xl bg-surface p-3 font-semibold">
        Kurt is independent. It is not affiliated with Deutsche Bahn and does not sell or book tickets.
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {SOURCES.map(([n, d]) => (
          <li key={n} className="flex flex-col py-2.5">
            <span className="font-semibold">{n}</span>
            <span className="text-muted">{d}</span>
          </li>
        ))}
      </ul>
      {range && (
        <p className="text-muted">
          History data range used: <span className="mono text-ink">{range}</span>.
        </p>
      )}
      <p className="text-muted">
        Odds count how often the same train number was late in the past. They are not forecasts. Train numbers
        change with the timetable on 13 Dec 2026.
      </p>
      <button type="button" className="btn-ghost" onClick={() => open('backtest')}>
        How good is Kurt?
      </button>
    </div>
  )
}

const pts = (f: number) => Math.round(f * 100)

// Buckets where the outcome beat the promise by 3+ points, as one honest sentence.
function understates(b: Backtest['buckets']) {
  const off = b.filter((k) => k.n >= 1000 && pts(k.observed_rate) - pts(k.predicted_mean) >= 3)
  if (!off.length) return null
  const gaps = off.map((k) => pts(k.observed_rate) - pts(k.predicted_mean))
  const lo = off[0].bucket.split('-')[0]
  const hi = off[off.length - 1].bucket.split('-')[1].replace('%', ' %')
  const g = Math.min(...gaps) === Math.max(...gaps) ? `${gaps[0]}` : `${Math.min(...gaps)}–${Math.max(...gaps)}`
  return `Between ${lo} and ${hi} Kurt understates: those trains were late ${g} points more often than he said.`
}

export function BacktestSheet() {
  const [state, retry] = useAsync(() => api.backtest(), [])
  if (state.status === 'loading') return <Loading label="Loading the backtest…" />
  if (state.status === 'error') return <ErrorState error={state.error} retry={retry} />
  const b = state.data
  const buckets = b.buckets.filter((k) => k.n > 0)
  const gap = understates(buckets)
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-snug lg:text-[16px]">
      <p>
        Kurt learned from <b>{dateOnly(b.train_period.from)}</b> to <b>{dateOnly(b.train_period.to)}</b>, then
        his odds were checked against what really happened from <b>{dateOnly(b.test_period.from)}</b> to{' '}
        <b>{dateOnly(b.test_period.to)}</b>.
      </p>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          [`${pts(b.base_rate)} %`, `of test runs ${b.threshold_min}+ min late`],
          [`${pts(b.brier_skill)} %`, `less error than always saying ${pts(b.base_rate)} %`],
          [`${pts(b.coverage)} %`, 'of arrivals had enough history'],
        ].map(([v, l]) => (
          <div key={l} className="flex flex-col gap-0.5 rounded-xl bg-surface px-2 py-2.5">
            <dt className="order-2 text-[11px] leading-tight text-muted lg:text-[13px]">{l}</dt>
            <dd className="mono text-[20px] font-bold lg:text-[28px]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-[16px] font-bold lg:text-[19px]">Said vs. happened</h3>
        <p className="flex items-center gap-3 text-[12px] text-muted lg:text-[14px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0.5 bg-ink" aria-hidden="true" /> Kurt said
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-full bg-accent" aria-hidden="true" /> really late
          </span>
        </p>
      </div>
      <ul className="-mt-1 flex flex-col gap-3" aria-label="Promised odds against real outcome">
        {buckets.map((k) => {
          const said = pts(k.predicted_mean)
          const real = pts(k.observed_rate)
          const d = real - said
          return (
            <li key={k.bucket} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="mono text-[13px] font-semibold lg:text-[15px]">{k.bucket.replace('-', '–').replace('%', ' %')}</span>
                <span className="mono text-[13px] lg:text-[15px]">
                  said {said} · <b>really {real}</b>
                  <span className={`ml-1.5 inline-block w-8 text-right ${Math.abs(d) >= 3 ? 'font-bold text-accent-text' : 'text-muted'}`}>
                    {d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0'}
                  </span>
                </span>
              </div>
              <div className="relative h-2.5 rounded-full bg-surface" role="img" aria-label={`Kurt said ${said} %, really late ${real} %`}>
                <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${real}%` }} />
                <span className="absolute -top-1 h-[18px] w-0.5 bg-ink" style={{ left: `${said}%` }} aria-hidden="true" />
              </div>
              <span className="text-[11px] text-muted lg:text-[13px]">{k.n.toLocaleString('en-GB')} runs</span>
            </li>
          )
        })}
      </ul>
      {gap && <p className="rounded-xl bg-tint p-3 font-semibold">{gap}</p>}
      <p className="text-muted">
        {b.runs.toLocaleString('en-GB')} runs scored. Odds count past runs of the same train at the same stop and
        weekday, pulled toward the average when there are few runs. They are not a forecast. Connections with changes are estimates that assume the legs run
        independently.
      </p>
      <p className="text-[12px] text-muted lg:text-[14px]">Data: {b.source}.</p>
    </div>
  )
}
