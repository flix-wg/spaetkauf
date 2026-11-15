import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './index.css'
import { I18nProvider } from './i18n'

if (import.meta.env.PROD) registerSW({ immediate: true })

// The splash from index.html stays for Kurt's first crawl, then he dashes off. Once per session.
const splash = document.getElementById('splash')
if (splash) {
  const skip = document.documentElement.classList.contains('splash-skip')
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  setTimeout(
    () => {
      splash.classList.add('out')
      try {
        sessionStorage.setItem('spaetkauf.splash', '1')
      } catch {
        /* private mode: the splash shows again next time */
      }
      setTimeout(() => splash.remove(), 900)
    },
    skip ? 0 : Math.max(0, (still ? 700 : 2000) - performance.now()),
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider><App /></I18nProvider>
  </StrictMode>,
)
