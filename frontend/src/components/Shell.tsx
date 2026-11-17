import { tr, useT } from '../i18n'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import QRCode from 'qrcode'
import { Settings, SettingsButton } from './Settings'
import { Kurt } from './Kurt'
import { IconClock, IconHistory, IconInfo, IconTicket, IconTrain } from './Icons'
import { Sheet } from './Sheet'
import { SourcesSheet, BacktestSheet } from './InfoSheets'
import { AddonSheet } from './Addon'
import { useSheet } from '../sheets'
import { MOCK } from '../api'

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const f = () => setM(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [q])
  return m
}

export function lastSearchPath() {
  try {
    return sessionStorage.getItem('spaetkauf.lastSearch') ?? '/'
  } catch {
    return '/'
  }
}

function InfoButton() {
  useT()
  const { open } = useSheet()
  return (
    <button
      type="button"
      onClick={() => open('sources')}
      aria-label={tr('howKurtWorks')}
      className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface"
    >
      <IconInfo />
    </button>
  )
}

// Phone: the title scrolls with the page under the fixed top bar. Desktop: it sticks, since the logo is in the side bar.
// `deskOnly` hides it on a phone where it would repeat the top bar.
export function ScreenHeader({ title, back, deskOnly }: { title: string; back?: React.ReactNode; deskOnly?: boolean }) {
  useT()
  return (
    <header
      className={`${deskOnly ? 'hidden lg:flex' : 'flex'} items-center justify-between gap-2 bg-page px-5 pb-1 pt-4 lg:sticky lg:top-0 lg:z-10 lg:min-h-[96px] lg:px-10 lg:pb-3 lg:pt-6`}
    >
      <div className="flex min-w-0 items-center gap-1">
        {back}
        <h1 className="truncate font-display text-[26px] font-bold leading-tight lg:text-[38px]">{title}</h1>
      </div>
      <div className="hidden lg:block">
        <div className="flex items-center"><SettingsButton /><InfoButton /></div>
      </div>
    </header>
  )
}

// Phone only. It sits outside the scrolling area, so neither scrolling nor a pull at the top can move it.
function TopBar() {
  useT()
  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-line bg-page px-5">
      <NavLink to="/" aria-label={tr('kurtHome')} className="flex items-center gap-2.5 no-underline">
        <Kurt width={48} motion="blink" />
        <span className="font-display text-[26px] font-bold leading-none tracking-[-0.01em] text-ink">{tr('kurt')}</span>
      </NavLink>
      <div className="flex items-center"><SettingsButton /><InfoButton /></div>
    </header>
  )
}

const navItems = (pathname: string) => [
  { to: lastSearchPath(), label: tr('picks'), icon: IconTrain, on: pathname === '/' || pathname === '/picks' },
  { to: '/trips', label: tr('myTrips'), icon: IconTicket, on: pathname.startsWith('/trip') },
  { to: '/late', label: tr('lateNow'), icon: IconClock, on: pathname === '/late' },
  { to: '/lookup', label: tr('lookup'), icon: IconHistory, on: pathname === '/lookup' },
]

function Nav() {
  useT()
  const { pathname } = useLocation()
  const items = navItems(pathname)
  return (
    <nav aria-label={tr('main')} className="grid shrink-0 grid-cols-4 border-t border-line bg-page pb-[env(safe-area-inset-bottom)]">
      {items.map(({ to, label, icon: Icon, on }) => (
        <NavLink
          key={label}
          to={to}
          aria-current={on ? 'page' : undefined}
          className={`relative flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[12px] no-underline ${on ? 'font-bold text-ink' : 'font-medium text-muted'}`}
        >
          {on && <span className="absolute inset-x-0 top-0 mx-auto h-1 w-8 rounded-b bg-accent" />}
          <Icon size={22} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

// Desktop: the bottom tab bar becomes a side bar, with the QR code so the audience can open it on a phone.
function SideNav() {
  useT()
  const { pathname } = useLocation()
  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toString(window.location.origin, { type: 'svg', margin: 1, color: { dark: '#14161A', light: '#FFFFFF' } }).then(setQr)
  }, [])
  return (
    <aside className="flex w-[264px] shrink-0 flex-col gap-8 border-r border-line bg-surface px-5 py-7">
      <div className="flex items-center gap-3 px-2">
        <Kurt width={60} motion="blink" />
        <span className="font-display text-[30px] font-bold">{tr('kurt')}</span>
      </div>
      <nav aria-label={tr('main')} className="flex flex-col gap-1.5">
        {navItems(pathname).map(({ to, label, icon: Icon, on }) => (
          <NavLink
            key={label}
            to={to}
            aria-current={on ? 'page' : undefined}
            className={`relative flex min-h-[56px] items-center gap-3.5 rounded-2xl px-4 text-[18px] no-underline ${on ? 'bg-page font-bold text-ink shadow-[0_1px_2px_var(--color-shadow)]' : 'font-medium text-muted hover:bg-page/60'}`}
          >
            {on && <span className="absolute inset-y-0 left-0 my-auto h-7 w-1 rounded-r bg-accent" />}
            <Icon size={24} />
            {label}
          </NavLink>
        ))}
        <SettingsButton label />
      </nav>
      <div className="mt-auto flex flex-col gap-3 px-2">
        <div
          className="h-[132px] w-[132px] rounded-2xl border border-line bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
          role="img"
          aria-label={tr('qrCodeThatOpensThisSiteOn')}
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <p className="text-[14px] leading-snug text-muted">{tr('scanToOpenOnYourPhone')} <br />
          <span className="mono break-all text-ink">{window.location.host}</span>
        </p>
        {MOCK && <span className="tag w-fit rounded-md bg-tint px-2 py-1 text-accent-text">{tr('mockData')}</span>}
      </div>
    </aside>
  )
}

function Footer() {
  useT()
  const { open } = useSheet()
  const link = 'underline-offset-2 hover:text-ink hover:underline'
  return (
    <footer className="px-5 pb-8 pt-12 text-[13px] text-muted">
      <nav className="mx-auto flex max-w-[640px] flex-wrap justify-center gap-x-5 gap-y-2">
        <a className={link} href="https://github.com/flix-wg/spaetkauf/issues" target="_blank" rel="noopener noreferrer">{tr('reportProblem')}</a>
        <button type="button" className={link} onClick={() => open('sources')}>{tr('dataAndSources')}</button>
        <a className={link} href="https://github.com/flix-wg/spaetkauf" target="_blank" rel="noopener noreferrer">{tr('quellcode')}</a>
        <Link className={link} to="/impressum">{tr('impressum')}</Link>
        <Link className={link} to="/datenschutz">{tr('datenschutz')}</Link>
      </nav>
    </footer>
  )
}

export function Shell() {
  useT()
  const desk = useMedia('(min-width: 1024px)')
  const { current, close } = useSheet()
  const sheets = (
    <>
      {current === 'settings' && <Sheet title={tr('settings')} onClose={close}><Settings /></Sheet>}
      {current === 'sources' && (
        <Sheet title={tr('howKurtWorks')} onClose={close}>
          <SourcesSheet />
        </Sheet>
      )}
      {current === 'backtest' && (
        <Sheet title={tr('howGoodIsKurt')} onClose={close}>
          <BacktestSheet />
        </Sheet>
      )}
      {current === 'addon' && (
        <Sheet title={tr('kurtForBahnDe')} onClose={close}>
          <AddonSheet />
        </Sheet>
      )}
    </>
  )
  if (desk)
    return (
      <div className="desk-fit relative flex h-dvh w-full overflow-hidden bg-page">
        <SideNav />
        <main className="scroll-y min-h-0 min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1680px]">
            <Outlet />
            <Footer />
          </div>
        </main>
        {sheets}
      </div>
    )
  return (
    <div className="relative mx-auto h-dvh w-full max-w-[480px] overflow-hidden bg-page">
      <div className="flex h-full flex-col">
        <TopBar />
        <main className="scroll-y min-h-0 flex-1">
          <Outlet />
          <Footer />
        </main>
        <Nav />
      </div>
      {sheets}
    </div>
  )
}
