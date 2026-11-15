import { useState } from 'react'
import { ADDON_SOURCE, ADDON_ZIP, cardHidden, hideCard, onPhone } from '../addon'
import { useSheet } from '../sheets'
import { IconClose, IconExternal } from './Icons'
import { Kurt } from './Kurt'

const WHAT = 'Shows Kurt’s odds and pick as badges next to your bahn.de results. It only reads the page: it never clicks, books or buys.'

const STEPS = [
  <>Download the add-on and unzip it.</>,
  <>
    Open <span className="mono rounded bg-surface px-1.5 py-0.5 text-[13px]">chrome://extensions</span> in the address bar.
  </>,
  <>Turn on Developer mode, top right.</>,
  <>Click Load unpacked and pick the unzipped kurt-extension folder.</>,
]

// What the badge looks like on bahn.de, so people know what to look for.
function SampleBadge() {
  return (
    <span className="self-start rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-white">
      Kurt’s pick: 63 % chance of 20+ min late
    </span>
  )
}

export function AddonSheet() {
  const phone = onPhone()
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-snug lg:text-[16px]">
      <p>{WHAT}</p>
      <SampleBadge />
      {phone ? (
        <p className="rounded-xl bg-surface p-3 font-semibold">
          It is an add-on for Chrome on a computer. Open Kurt there to set it up.
        </p>
      ) : (
        <>
          <ol className="flex flex-col gap-3" aria-label="Install steps">
            {STEPS.map((t, i) => (
              <li key={i} className="flex gap-3 text-[15px] font-semibold leading-snug lg:text-[16px]">
                <span className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="pt-0.5">{t}</span>
              </li>
            ))}
          </ol>
          <a href={ADDON_ZIP} download className="btn-primary">
            Download the add-on
          </a>
          <p className="text-muted">
            Then open a search on bahn.de and the badges appear next to the results. Works in Chrome and other
            Chromium browsers such as Edge or Brave.
          </p>
        </>
      )}
      <p className="text-[12px] text-muted lg:text-[14px]">
        Not in the Chrome Web Store yet.{' '}
        <a href={ADDON_SOURCE} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-text underline">
          Source on GitHub <IconExternal size={14} />
        </a>
      </p>
    </div>
  )
}

// A one-time card on the picks screen, desktop only.
export function AddonCard() {
  const { open } = useSheet()
  const [hidden, setHidden] = useState(() => onPhone() || cardHidden())
  if (hidden) return null
  return (
    <section className="relative flex items-start gap-3 rounded-[22px] bg-surface p-4 pr-12 lg:gap-4 lg:p-6 lg:pr-14" aria-label="Kurt for bahn.de">
      <Kurt width={44} className="mt-0.5 shrink-0" />
      <span className="flex flex-col gap-1">
        <span className="font-display text-[17px] font-bold leading-tight lg:text-[20px]">Kurt for bahn.de</span>
        <span className="text-[13px] leading-snug text-muted lg:text-[15px]">{WHAT}</span>
        <button type="button" onClick={() => open('addon')} className="-my-2 inline-flex min-h-[44px] items-center self-start text-[13px] font-semibold text-accent-text underline lg:text-[15px]">
          Add it to Chrome
        </button>
      </span>
      <button
        type="button"
        onClick={() => {
          hideCard()
          setHidden(true)
        }}
        aria-label="Hide this"
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-white"
      >
        <IconClose size={18} />
      </button>
    </section>
  )
}
