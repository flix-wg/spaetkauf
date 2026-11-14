import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import QRCode from 'qrcode'
import { Kurt } from './Kurt'
import { IconClock, IconInfo, IconTicket, IconTrain } from './Icons'
import { Sheet } from './Sheet'
import { SourcesSheet, BacktestSheet } from './InfoSheets'
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

export function ScreenHeader({ title, back }: { title: string; back?: React.ReactNode }) {
  const { open } = useSheet()
  return (
    <header className="sticky top-0 z-10 flex min-h-[64px] items-center justify-between gap-2 bg-white px-5 pb-2 pt-3 lg:min-h-[96px] lg:px-10 lg:pb-3 lg:pt-6">
      <div className="flex min-w-0 items-center gap-1">
        {back}
        <h1 className="truncate font-display text-[26px] font-bold leading-tight lg:text-[38px]">{title}</h1>
      </div>
      <button
        type="button"
        onClick={() => open('sources')}
        aria-label="About and sources"
        className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface"
      >
        <IconInfo />
      </button>
    </header>
  )
}

const navItems = (pathname: string) => [
  { to: lastSearchPath(), label: 'Picks', icon: IconTrain, on: pathname === '/' || pathname === '/picks' },
  { to: '/trips', label: 'My trips', icon: IconTicket, on: pathname.startsWith('/trip') },
  { to: '/late', label: 'Late now', icon: IconClock, on: pathname === '/late' },
]

function Nav() {
  const { pathname } = useLocation()
  const items = navItems(pathname)
  return (
    <nav aria-label="Main" className="grid shrink-0 grid-cols-3 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
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
  const { pathname } = useLocation()
  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toString(window.location.origin, { type: 'svg', margin: 1, color: { dark: '#14161A', light: '#FFFFFF' } }).then(setQr)
  }, [])
  return (
    <aside className="flex w-[264px] shrink-0 flex-col gap-8 border-r border-line bg-surface px-5 py-7">
      <div className="flex items-center gap-3 px-2">
        <Kurt width={60} />
        <span className="font-display text-[30px] font-bold">Spätkauf</span>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1.5">
        {navItems(pathname).map(({ to, label, icon: Icon, on }) => (
          <NavLink
            key={label}
            to={to}
            aria-current={on ? 'page' : undefined}
            className={`relative flex min-h-[56px] items-center gap-3.5 rounded-2xl px-4 text-[18px] no-underline ${on ? 'bg-white font-bold text-ink shadow-[0_1px_2px_rgba(20,22,26,0.08)]' : 'font-medium text-muted hover:bg-white/60'}`}
          >
            {on && <span className="absolute inset-y-0 left-0 my-auto h-7 w-1 rounded-r bg-accent" />}
            <Icon size={24} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3 px-2">
        <div
          className="h-[132px] w-[132px] rounded-2xl border border-line bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
          role="img"
          aria-label="QR code that opens this site on a phone"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <p className="text-[14px] leading-snug text-muted">
          Scan to open on your phone.
          <br />
          <span className="mono break-all text-ink">{window.location.host}</span>
        </p>
        {MOCK && <span className="tag w-fit rounded-md bg-tint px-2 py-1 text-accent-text">MOCK DATA</span>}
      </div>
    </aside>
  )
}

export function Shell() {
  const desk = useMedia('(min-width: 1024px)')
  const { current, close } = useSheet()
  const sheets = (
    <>
      {current === 'sources' && (
        <Sheet title="Sources" onClose={close}>
          <SourcesSheet />
        </Sheet>
      )}
      {current === 'backtest' && (
        <Sheet title="How good is Kurt?" onClose={close}>
          <BacktestSheet />
        </Sheet>
      )}
    </>
  )
  if (desk)
    return (
      <div className="desk-fit relative flex h-dvh w-full overflow-hidden bg-white">
        <SideNav />
        <main className="scroll-y min-h-0 min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1680px]">
            <Outlet />
          </div>
        </main>
        {sheets}
      </div>
    )
  return (
    <div className="relative mx-auto h-dvh w-full max-w-[480px] overflow-hidden bg-white">
      <div className="flex h-full flex-col">
        <main className="scroll-y min-h-0 flex-1">
          <Outlet />
        </main>
        <Nav />
      </div>
      {sheets}
    </div>
  )
}
