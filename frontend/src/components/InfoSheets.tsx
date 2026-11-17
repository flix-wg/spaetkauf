import { locale } from '../i18n-core'
import { tx, tr, useT } from '../i18n'
import { api, type Backtest } from '../api'
import { dateOnly } from '../format'
import { useAsync } from '../hooks'
import { useSheet } from '../sheets'
import { ErrorState, Loading } from './States'
import { HowItWorks } from './HowItWorks'

const SOURCES = () => [
  ['Transitous', 'https://transitous.org/sources/', tr('routesTrainsAndLiveDelaysOpenMotis')],
  ['piebro/deutsche-bahn-data', 'https://github.com/piebro/deutsche-bahn-data', tr('pastArrivalDelaysBehindEveryPercentageLicence')],
  ['OpenStreetMap', 'https://www.openstreetmap.org/copyright', tr('osmContributors')],
]

export function SourcesSheet() {
  useT()
  const { open } = useSheet()
  const [bt] = useAsync(() => api.backtest(), [])
  const range =
    bt.status === 'ok' ? tx('dateRange', dateOnly(bt.data.train_period.from), dateOnly(bt.data.test_period.to)) : null
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-snug lg:text-[16px]">
      <HowItWorks />
      <h3 className="mt-2 font-display text-[18px] font-bold lg:text-[20px]">{tr('sources')}</h3>
      <p className="rounded-xl bg-surface p-3 font-semibold">{tr('kurtIsIndependentItIsNotAffiliated')} </p>
      <ul className="flex flex-col divide-y divide-line">
        {SOURCES().map(([n, url, d]) => (
          <li key={n} className="flex flex-col py-2.5">
            <a className="self-start font-semibold underline decoration-line underline-offset-4 hover:decoration-current" href={url} target="_blank" rel="noopener noreferrer">{n}</a>
            <span className="text-muted">{d}</span>
          </li>
        ))}
      </ul>
      {range && (
        <p className="text-muted">{tr('historyDataRangeUsed')} <span className="mono text-ink">{range}</span>.
        </p>
      )}
      <p className="text-muted">{tr('oddsCountHowOftenTheSameTrain')} </p>
      <button type="button" className="btn-ghost" onClick={() => open('backtest')}>{tr('howGoodIsKurt')} </button>
      <button type="button" className="btn-ghost" onClick={() => open('addon')}>{tr('chromeAddOnForBahnDe')} </button>
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
  return tx('understatedOdds', lo, hi, g)
}

export function BacktestSheet() {
  useT()
  const [state, retry] = useAsync(() => api.backtest(), [])
  if (state.status === 'loading') return <Loading label={tr('loadingTheBacktest')} />
  if (state.status === 'error') return <ErrorState error={state.error} retry={retry} />
  const b = state.data
  const buckets = b.buckets.filter((k) => k.n > 0)
  const gap = understates(buckets)
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-snug lg:text-[16px]">
      <p>{tr('kurtLearnedFrom')} <b>{dateOnly(b.train_period.from)}</b> {tr('to')} <b>{dateOnly(b.train_period.to)}</b>{tr('thenHisOddsWereCheckedAgainstWhat')} <b>{dateOnly(b.test_period.from)}</b> {tr('to')}{' '}
        <b>{dateOnly(b.test_period.to)}</b>.
      </p>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          [`${pts(b.base_rate)} %`, tx('testRunsLate', b.threshold_min)],
          [`${pts(b.brier_skill)} %`, tx('lessError', pts(b.base_rate))],
          [`${pts(b.coverage)} %`, tr('ofArrivalsHadEnoughHistory')],
        ].map(([v, l]) => (
          <div key={l} className="flex flex-col gap-0.5 rounded-xl bg-surface px-2 py-2.5">
            <dt className="order-2 text-[11px] leading-tight text-muted lg:text-[13px]">{l}</dt>
            <dd className="mono text-[20px] font-bold lg:text-[28px]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-[16px] font-bold lg:text-[19px]">{tr('saidVsHappened')}</h3>
        <p className="flex items-center gap-3 text-[12px] text-muted lg:text-[14px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0.5 bg-ink" aria-hidden="true" /> {tr('kurtSaid')} </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-full bg-accent" aria-hidden="true" /> {tr('reallyLate')} </span>
        </p>
      </div>
      <ul className="-mt-1 flex flex-col gap-3" aria-label={tr('promisedOddsAgainstRealOutcome')}>
        {buckets.map((k) => {
          const said = pts(k.predicted_mean)
          const real = pts(k.observed_rate)
          const d = real - said
          return (
            <li key={k.bucket} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="mono text-[13px] font-semibold lg:text-[15px]">{k.bucket.replace('-', '–').replace('%', ' %')}</span>
                <span className="mono text-[13px] lg:text-[15px]">{tr('said')} {said} · <b>{tr('really')} {real}</b>
                  <span className={`ml-1.5 inline-block w-8 text-right ${Math.abs(d) >= 3 ? 'font-bold text-accent-text' : 'text-muted'}`}>
                    {d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0'}
                  </span>
                </span>
              </div>
              <div className="relative h-2.5 rounded-full bg-surface" role="img" aria-label={tx('predictedObserved', said, real)}>
                <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${real}%` }} />
                <span className="absolute -top-1 h-[18px] w-0.5 bg-ink" style={{ left: `${said}%` }} aria-hidden="true" />
              </div>
              <span className="text-[11px] text-muted lg:text-[13px]">{k.n.toLocaleString(locale())} {tr('runs')}</span>
            </li>
          )
        })}
      </ul>
      {gap && <p className="rounded-xl bg-tint p-3 font-semibold">{gap}</p>}
      <p className="text-muted">
        {b.runs.toLocaleString(locale())} {tr('runsScoredOddsCountPastRunsOf')} </p>
      <p className="text-[12px] text-muted lg:text-[14px]">{tr('data')} {b.source}.</p>
    </div>
  )
}
