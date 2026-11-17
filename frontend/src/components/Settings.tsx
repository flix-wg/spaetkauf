import { useT, type Lang, type Theme } from '../i18n'
import { IconSettings } from './Icons'
import { useSheet } from '../sheets'
import { useLocation, useNavigate } from 'react-router-dom'
import { landingPath, pathLang } from '../site'
export function SettingsButton({ label = false }: { label?: boolean }) {
  const { t } = useT()
  const { open } = useSheet()
  return <button type="button" aria-label={t.settings} onClick={() => open('settings')} className={`flex min-h-11 shrink-0 items-center gap-3 rounded-full text-muted hover:bg-surface ${label ? 'px-4 font-semibold' : 'w-11 justify-center'}`}><IconSettings />{label && t.settings}</button>
}
export function Settings() {
  const { t, lang, setLang, theme, setTheme } = useT()
  const { pathname, search } = useLocation()
  const nav = useNavigate()
  // On a landing page the URL carries the language, so switching it moves between / and /en/.
  const pick = (value: Lang) => {
    setLang(value)
    if (pathLang(pathname)) nav(landingPath(value) + search, { replace: true })
  }
  return <div className="flex flex-col gap-6">
    <fieldset><legend className="mb-2 font-semibold">{t.language}</legend><div className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
      {(['de', 'en'] as Lang[]).map(value => <button key={value} type="button" aria-pressed={lang === value} onClick={() => pick(value)} className={`min-h-11 rounded-lg px-3 font-semibold ${lang === value ? 'bg-page text-ink ring-1 ring-ink' : 'text-muted'}`}>{value === 'de' ? t.german : t.english}</button>)}
    </div></fieldset>
    <fieldset><legend className="mb-2 font-semibold">{t.appearance}</legend><div className="grid grid-cols-3 gap-1 rounded-xl bg-surface p-1">
      {(['system', 'light', 'dark'] as Theme[]).map(value => <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)} className={`min-h-11 rounded-lg px-3 font-semibold ${theme === value ? 'bg-page text-ink ring-1 ring-ink' : 'text-muted'}`}>{t[value]}</button>)}
    </div></fieldset>
  </div>
}
