import { tr, useT } from '../i18n'
import { useState } from 'react'
import { ADDON_SOURCE, ADDON_STORE, cardHidden, hideCard, onPhone } from '../addon'
import { useSheet } from '../sheets'
import { IconClose, IconExternal } from './Icons'
import { Kurt } from './Kurt'

const WHAT = () => tr('showsKurtSOddsAndPickAs')

// What the badge looks like on bahn.de, so people know what to look for.
function SampleBadge() {
  useT()
  return (
    <span className="self-start rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-page">{tr('kurtSPick63ChanceOf20')} </span>
  )
}

export function AddonSheet() {
  useT()
  const phone = onPhone()
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-snug lg:text-[16px]">
      <p>{WHAT()}</p>
      <SampleBadge />
      {phone ? (
        <p className="rounded-xl bg-surface p-3 font-semibold">{tr('itIsAnAddOnForChrome')} </p>
      ) : (
        <>
          <a href={ADDON_STORE} target="_blank" rel="noopener noreferrer" className="btn-primary">{tr('getItInTheChromeWebStore')} </a>
          <p className="text-muted">{tr('thenOpenASearchOnBahnDe')} </p>
        </>
      )}
      <p className="text-[12px] text-muted lg:text-[14px]"><a href={ADDON_SOURCE} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-text underline">{tr('sourceOnGithub')} <IconExternal size={14} />
        </a>
      </p>
    </div>
  )
}

// A one-time card on the picks screen, desktop only.
export function AddonCard() {
  useT()
  const { open } = useSheet()
  const [hidden, setHidden] = useState(() => onPhone() || cardHidden())
  if (hidden) return null
  return (
    <section className="relative flex items-start gap-3 rounded-[22px] bg-surface p-4 pr-12 lg:gap-4 lg:p-6 lg:pr-14" aria-label={tr('kurtForBahnDe')}>
      <Kurt width={44} className="mt-0.5 shrink-0" />
      <span className="flex flex-col gap-1">
        <span className="font-display text-[17px] font-bold leading-tight lg:text-[20px]">{tr('kurtForBahnDe')}</span>
        <span className="text-[13px] leading-snug text-muted lg:text-[15px]">{WHAT()}</span>
        <button type="button" onClick={() => open('addon')} className="-my-2 inline-flex min-h-[44px] items-center self-start text-[13px] font-semibold text-accent-text underline lg:text-[15px]">{tr('addItToChrome')} </button>
      </span>
      <button
        type="button"
        onClick={() => {
          hideCard()
          setHidden(true)
        }}
        aria-label={tr('hideThis')}
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-page"
      >
        <IconClose size={18} />
      </button>
    </section>
  )
}
