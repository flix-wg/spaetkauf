import { tx } from '../i18n-core'
import type { Threshold } from '../api'
import { eur } from '../format'

const MAX = 130
const POS = (m: number) => `${(Math.min(m, MAX) / MAX) * 100}%`

export function Meter({ delay, thresholds }: { delay: number; thresholds: Threshold[] }) {
  return (
    <div className="pb-1 pt-1">
      <div className="relative mx-3 h-3 rounded-full bg-black/15 lg:mx-5 lg:h-4" role="img" aria-label={tx('meterDescription', delay)}>
        <div className="meter-fill absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: POS(Math.max(delay, 0)) }} />
        {thresholds.map((t) => (
          <span
            key={t.at}
            className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink lg:h-8 lg:w-8 lg:border-[3px] ${t.reached ? 'bg-ink' : 'bg-page'}`}
            style={{ left: POS(t.at) }}
          />
        ))}
      </div>
      <div className="relative mx-3 mt-2 h-[40px] lg:mx-5 lg:mt-3 lg:h-[56px]">
        {thresholds.map((t, i) => (
          <div
            key={t.at}
            className={`absolute flex flex-col whitespace-nowrap ${i === thresholds.length - 1 ? 'right-[-12px] items-end text-right lg:right-[-20px]' : '-translate-x-1/2 items-center text-center'}`}
            style={i === thresholds.length - 1 ? undefined : { left: POS(t.at) }}
          >
            <span className={`font-mono text-[13px] font-bold lg:text-[20px] ${t.reached ? '' : 'opacity-90'}`}>+{t.at}</span>
            <span className="text-[11px] leading-tight lg:text-[16px] lg:font-semibold">{t.amount_eur !== null ? eur(t.amount_eur) : t.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
