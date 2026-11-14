import { Snails } from './Kurt'

const STEPS = [
  'Search your route. Kurt shows how often each train arrived 20+ min late in the past.',
  'Book the cheap saver ticket for one of those trains on bahn.de.',
  'Kurt watches it live and tells you what the delay gets you.',
]

const RULES = [
  ['20+ min', 'Take any other train there, or don’t go at all: full fare back'],
  ['60+ min', '25 % of the fare back'],
  ['120+ min', '50 % of the fare back'],
]

// What a delay at your destination gets you under DB passenger rights.
export function Rules({ big }: { big?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className={`text-[13px] font-bold ${big ? "lg:text-[16px]" : ""}`}>What a delay gets you</p>
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-white" aria-label="What a delay gets you">
        {RULES.map(([d, what]) => (
          <li key={d} className={`flex items-baseline gap-3 px-3 py-2 ${big ? 'lg:px-4 lg:py-3' : ''}`}>
            <span className={`mono w-[64px] shrink-0 whitespace-nowrap text-[13px] font-bold text-accent-text ${big ? 'lg:w-[84px] lg:text-[17px]' : ''}`}>{d}</span>
            <span className={`text-[14px] font-semibold leading-snug ${big ? 'lg:text-[18px]' : ''}`}>{what}</span>
          </li>
        ))}
      </ul>
      <p className={`text-[12px] leading-snug text-muted ${big ? 'lg:text-[14px]' : ''}`}>
        Late means at your destination. A delay already announced when you book doesn’t count.
      </p>
    </div>
  )
}

export function HowItWorks({ big }: { big?: boolean }) {
  return (
    <div className={`flex flex-col gap-4 ${big ? 'lg:gap-6' : ''}`}>
      <ol className="flex flex-col gap-3" aria-label="How it works">
        {STEPS.map((t, i) => (
          <li key={i} className={`flex gap-3 text-[15px] font-semibold leading-snug ${big ? 'lg:gap-4 lg:text-[20px]' : ''}`}>
            <span className={`mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-white ${big ? 'lg:h-10 lg:w-10 lg:text-[17px]' : ''}`}>
              {i + 1}
            </span>
            <span className={big ? 'lg:pt-1.5' : 'pt-0.5'}>{t}</span>
          </li>
        ))}
      </ol>
      <Rules big={big} />
      <div className="flex items-center gap-2.5">
        <Snails p20={0.6} />
        <span className={`text-[13px] leading-snug text-muted ${big ? 'lg:text-[15px]' : ''}`}>More snails: more often 20+ min late. Good for you.</span>
      </div>
    </div>
  )
}
