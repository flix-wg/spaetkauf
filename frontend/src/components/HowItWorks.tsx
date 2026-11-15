import { tr, useT } from '../i18n'
import { Snails } from './Kurt'

const STEPS = () => [
  tr('searchYourRouteKurtShowsHowOften'),
  tr('bookTheCheapestTicketBoundToThat'),
  tr('kurtWatchesItLiveAndTellsYou'),
]

// Checked against bahn.de/fahrgastrechte on 2026-11-14 (national trips).
const RULES = () => [
  [tr('20Min'), tr('yourSaverTicketIsValidOnOther')],
  [tr('60Min'), tr('25OfTheFareBackKnownBefore')],
  [tr('120Min'), tr('50OfTheFareBack')],
]

// `full` adds the exceptions; the short version links to them instead.
// `untitled` drops the heading where a disclosure already says it.
export function Rules({ big, full, untitled }: { big?: boolean; full?: boolean; untitled?: boolean }) {
  useT()
  return (
    <div className="flex flex-col gap-1.5">
      {!untitled && <p className={`text-[13px] font-bold ${big ? "lg:text-[16px]" : ""}`}>{tr('whatADelayGetsYou')}</p>}
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-page" aria-label={tr('whatADelayGetsYou')}>
        {RULES().map(([d, what]) => (
          <li key={d} className={`flex items-baseline gap-3 px-3 py-2 ${big ? 'lg:px-4 lg:py-3' : ''}`}>
            <span className={`mono w-[64px] shrink-0 whitespace-nowrap text-[13px] font-bold text-accent-text ${big ? 'lg:w-[84px] lg:text-[17px]' : ''}`}>{d}</span>
            <span className={`text-[14px] font-semibold leading-snug ${big ? 'lg:text-[18px]' : ''}`}>{what}</span>
          </li>
        ))}
      </ul>
      <p className={`text-[12px] leading-snug text-muted ${big ? 'lg:text-[14px]' : ''}`}>{tr('lateMeansExpectedOrActualAtYour')} {full &&
          tr('amountsUnder4AreNotPaidNo')}
      </p>
    </div>
  )
}

export function HowItWorks({ big }: { big?: boolean }) {
  useT()
  return (
    <div className={`flex flex-col gap-4 ${big ? 'lg:gap-6' : ''}`}>
      <ol className="flex flex-col gap-3" aria-label={tr('howItWorks')}>
        {STEPS().map((t, i) => (
          <li key={i} className={`flex gap-3 text-[15px] font-semibold leading-snug ${big ? 'lg:gap-4 lg:text-[20px]' : ''}`}>
            <span className={`mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-page ${big ? 'lg:h-10 lg:w-10 lg:text-[17px]' : ''}`}>
              {i + 1}
            </span>
            <span className={big ? 'lg:pt-1.5' : 'pt-0.5'}>{t}</span>
          </li>
        ))}
      </ol>
      <p className={`rounded-xl bg-tint p-3 text-[13px] font-semibold leading-snug ${big ? 'lg:text-[16px]' : ''}`}>{tr('skipTheFlexpreisItCostsMoreAnd')} </p>
      <Rules big={big} full />
      <div className="flex items-center gap-2.5">
        <Snails p20={0.6} />
        <span className={`text-[13px] leading-snug text-muted ${big ? 'lg:text-[15px]' : ''}`}>{tr('moreSnailsMoreOften20MinLate')}</span>
      </div>
    </div>
  )
}
