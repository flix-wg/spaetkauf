import { Snails } from './Kurt'

const STEPS = [
  'Search your route. Kurt shows how often each train arrived 20+ min late in the past.',
  'Book the cheapest ticket bound to that train on bahn.de: a Super Sparpreis or Sparpreis.',
  'Kurt watches it live and tells you what the delay gets you.',
]

// Checked against bahn.de/fahrgastrechte on 2026-11-14 (national trips).
const RULES = [
  ['20+ min', 'Your saver ticket is valid on other trains there, except reservation-only ones'],
  ['60+ min', '25 % of the fare back. Known before you set off? Skip the trip and get the full fare back'],
  ['120+ min', '50 % of the fare back'],
]

// `full` adds the exceptions; the short version links to them instead.
// `untitled` drops the heading where a disclosure already says it.
export function Rules({ big, full, untitled }: { big?: boolean; full?: boolean; untitled?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {!untitled && <p className={`text-[13px] font-bold ${big ? "lg:text-[16px]" : ""}`}>What a delay gets you</p>}
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-white" aria-label="What a delay gets you">
        {RULES.map(([d, what]) => (
          <li key={d} className={`flex items-baseline gap-3 px-3 py-2 ${big ? 'lg:px-4 lg:py-3' : ''}`}>
            <span className={`mono w-[64px] shrink-0 whitespace-nowrap text-[13px] font-bold text-accent-text ${big ? 'lg:w-[84px] lg:text-[17px]' : ''}`}>{d}</span>
            <span className={`text-[14px] font-semibold leading-snug ${big ? 'lg:text-[18px]' : ''}`}>{what}</span>
          </li>
        ))}
      </ul>
      <p className={`text-[12px] leading-snug text-muted ${big ? 'lg:text-[14px]' : ''}`}>
        Late means expected or actual at your destination.
        {full &&
          ' Amounts under 4 € are not paid. No money back when the delay comes from outside the railway, such as people on the tracks, cable theft or police operations. Strikes do count. A delay already announced when you book doesn’t count.'}
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
      <p className={`rounded-xl bg-tint p-3 text-[13px] font-semibold leading-snug ${big ? 'lg:text-[16px]' : ''}`}>
        Skip the Flexpreis. It costs more and already lets you take any train, so a delay gains you little. The
        cheaper the train-bound ticket, the bigger the win.
      </p>
      <Rules big={big} full />
      <div className="flex items-center gap-2.5">
        <Snails p20={0.6} />
        <span className={`text-[13px] leading-snug text-muted ${big ? 'lg:text-[15px]' : ''}`}>More snails: more often 20+ min late. Good for you.</span>
      </div>
    </div>
  )
}
