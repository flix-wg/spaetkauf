import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { changeLang, getLang, en, de, type Lang } from './i18n-core'
export { tr, tx } from './i18n-core'
export type { Lang } from './i18n-core'
export type Theme = 'system' | 'light' | 'dark'
function initialTheme(): Theme {
  try {
    const value = localStorage.getItem('spaetkauf.theme')
    if (value === 'light' || value === 'dark') return value
  } catch { /* storage unavailable */ }
  return 'system'
}
const Context = createContext<{
  t: typeof en; lang: Lang; setLang: (lang: Lang) => void
  theme: Theme; setTheme: (theme: Theme) => void
} | null>(null)
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, updateLang] = useState(getLang)
  const [theme, setTheme] = useState(initialTheme)
  const setLang = (value: Lang) => { changeLang(value); updateLang(value) }
  useEffect(() => {
    document.documentElement.lang = lang
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then(registration => {
        registration.active?.postMessage({ type: 'language', lang })
      }).catch(() => undefined)
    }
  }, [lang])
  useEffect(() => {
    try { localStorage.setItem('spaetkauf.theme', theme) } catch { /* storage unavailable */ }
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = theme === 'system' ? media.matches ? 'dark' : 'light' : theme
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
      document.documentElement.style.backgroundColor = 'var(--color-page)'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#121316' : '#FD4F00')
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
  return <Context.Provider value={{ t: lang === 'de' ? de : en, lang, setLang, theme, setTheme }}>{children}</Context.Provider>
}
export function useT() {
  const value = useContext(Context)
  if (!value) throw new Error('I18nProvider is missing')
  return value
}
