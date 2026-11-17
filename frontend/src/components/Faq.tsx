import { useLocation } from 'react-router-dom'
import { useT } from '../i18n'
import { browserLang, savedLang } from '../i18n-core'
import { COPY, FAQ, landingPath, pathLang } from '../site'
import { IconChevron } from './Icons'

// A plain link, so the page loads in the other language the same way a search engine sees it.
function OtherLang({ className }: { className: string }) {
  const { lang, setLang } = useT()
  const other = lang === 'de' ? 'en' : 'de'
  // Saved, so a choice made earlier in Settings doesn't switch `/` back.
  return <a href={landingPath(other)} hrefLang={other} lang={other} onClick={() => setLang(other)} className={className}>{COPY[lang].other}</a>
}

// First visit on the landing page in a language the browser doesn't prefer: offer the other one.
export function LangHint() {
  const { lang } = useT()
  const { pathname } = useLocation()
  if (!pathLang(pathname) || savedLang() || browserLang() === lang) return null
  return <OtherLang className="mx-5 mt-3 block w-fit rounded-full border border-line px-4 py-2 text-[14px] font-semibold no-underline hover:bg-surface lg:mx-10" />
}

export function Faq() {
  const { lang } = useT()
  return (
    <section aria-labelledby="faq" className="px-5 pb-4 lg:max-w-[1000px] lg:px-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="faq" className="font-display text-[22px] font-bold lg:text-[30px]">{COPY[lang].faq}</h2>
        <OtherLang className="text-[14px] font-semibold text-accent-text underline" />
      </div>
      <div className="mt-3 flex flex-col divide-y divide-line rounded-[22px] border border-line">
        {FAQ[lang].map(([q, a]) => (
          <details key={q} className="group">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-[15px] font-semibold lg:text-[17px] [&::-webkit-details-marker]:hidden">
              {q}
              <IconChevron size={18} className="shrink-0 text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            </summary>
            <p className="px-4 pb-4 text-[14px] leading-relaxed text-muted lg:text-[16px]">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
