import { api } from '../api'
import { dateOnly } from '../format'
import { useAsync } from '../hooks'
import { useSheet } from '../sheets'
import { ErrorState, Loading } from './States'

const SOURCES = [
  ['Transitous', 'Routes, trains and live delays (open MOTIS service).'],
  ['piebro/deutsche-bahn-data', 'Past arrival delays behind every percentage, licence CC BY 4.0.'],
  ['Exa', 'Cited web signals such as strikes and track works for your day.'],
  ['Context.dev', 'Watches strike announcement pages for changes.'],
]

export function SourcesSheet() {
  const { open } = useSheet()
  const [bt] = useAsync(() => api.backtest(), [])
  const range =
    bt.status === 'ok' ? `${dateOnly(bt.data.train_from)} to ${dateOnly(bt.data.test_to)}` : null
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-snug">
      <p className="rounded-xl bg-surface p-3 font-semibold">
        Spätkauf is independent. It is not affiliated with Deutsche Bahn and does not sell or book tickets.
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
        Odds are base rates from past runs of the same train number, not forecasts. Train numbers change with the
        timetable on 13 Dec 2026.
      </p>
      <button type="button" className="btn-ghost" onClick={() => open('backtest')}>
        How good is Kurt?
      </button>
    </div>
  )
}

export function BacktestSheet() {
  const [state, retry] = useAsync(() => api.backtest(), [])
  if (state.status === 'loading') return <Loading label="Loading the backtest…" />
  if (state.status === 'error') return <ErrorState error={state.error} retry={retry} />
  const b = state.data
  const base = Math.round(b.base_rate <= 1 ? b.base_rate * 100 : b.base_rate)
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-snug">
      <p>
        Kurt’s odds were computed from <b>{dateOnly(b.train_from)}</b> to <b>{dateOnly(b.train_to)}</b>, then compared
        with what really happened from <b>{dateOnly(b.test_from)}</b> to <b>{dateOnly(b.test_to)}</b>.
      </p>
      <div className="flex items-baseline justify-between rounded-xl bg-tint px-4 py-3">
        <span>Overall: trains 20+ min late</span>
        <span className="mono text-[26px] font-bold">{base} %</span>
      </div>
      <ul className="flex flex-col gap-3" aria-label="Odds bucket against outcome">
        {b.buckets
          .filter((k) => k.n > 0)
          .map((k) => {
            const real = Math.round(k.rate <= 1 ? k.rate * 100 : k.rate)
            return (
              <li key={k.lo} className="flex flex-col gap-1">
                <div className="flex justify-between">
                  <span className="mono font-semibold">
                    Kurt said {k.lo}–{k.hi} %
                  </span>
                  <span className="mono font-bold">late {real} %</span>
                </div>
                <div className="relative h-3 rounded-full bg-surface">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${real}%` }} />
                  <span
                    className="absolute -top-1 h-5 w-0.5 bg-ink"
                    style={{ left: `${(k.lo + k.hi) / 2}%` }}
                    aria-hidden="true"
                  />
                </div>
                <span className="text-[12px] text-muted">{k.n.toLocaleString('en-GB')} runs</span>
              </li>
            )
          })}
      </ul>
      <p className="text-[12px] text-muted">Orange bar: how often trains were really 20+ min late. Black tick: middle of the bucket Kurt promised.</p>
      <p className="text-muted">
        {b.runs.toLocaleString('en-GB')} runs in the test period. Connections with changes are estimates that assume
        the legs run independently.
      </p>
    </div>
  )
}
