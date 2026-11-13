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
    <header className="sticky top-0 z-10 flex min-h-[64px] items-center justify-between gap-2 bg-white px-5 pb-2 pt-3">
      <div className="flex min-w-0 items-center gap-1">
        {back}
        <h1 className="truncate font-display text-[26px] font-bold leading-tight">{title}</h1>
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

function Nav() {
  const { pathname } = useLocation()
  const items = [
    { to: lastSearchPath(), label: 'Picks', icon: IconTrain, on: pathname === '/' || pathname === '/picks' },
    { to: '/trips', label: 'My trips', icon: IconTicket, on: pathname.startsWith('/trip') },
    { to: '/late', label: 'Late now', icon: IconClock, on: pathname === '/late' },
  ]
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

function Panel() {
  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toString(window.location.origin, { type: 'svg', margin: 1, color: { dark: '#14161A', light: '#FFFFFF' } }).then(setQr)
  }, [])
  return (
    <aside className="flex w-[420px] flex-col gap-7">
      <div className="flex items-center gap-3">
        <Kurt width={72} />
        <span className="font-display text-[34px] font-bold">Spätkauf</span>
      </div>
      <h2 className="font-display text-[40px] font-bold leading-[1.08]">
        Buy the cheap ticket for the train that’s usually late. Ride the better one.
      </h2>
      <ol className="flex flex-col gap-3 text-[16px] leading-snug text-ink">
        {[
          'Search a route and see which trains arrive 20+ minutes late most often.',
          'Book the cheap saver ticket on bahn.de. Kurt names the train you would ride instead.',
          'Kurt watches your trip live and tells you when the ticket unlocks and when money is back.',
        ].map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-white">
              {i + 1}
            </span>
            <span className="pt-0.5">{t}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-5">
        <div
          className="h-[132px] w-[132px] shrink-0 rounded-2xl border border-line bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
          role="img"
          aria-label="QR code that opens this site on a phone"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <p className="text-[14px] leading-snug text-muted">
          Scan to open on your phone.
          <br />
          <span className="mono text-ink">{window.location.host}</span>
        </p>
      </div>
      {MOCK && <span className="tag w-fit rounded-md bg-tint px-2 py-1 text-accent-text">MOCK DATA</span>}
    </aside>
  )
}

export function Shell() {
  const wide = useMedia('(min-width: 1280px)')
  const { current, close } = useSheet()
  const app = (
    <div
      className={
        wide
          ? 'relative box-content h-[min(844px,calc(100dvh-80px))] w-[390px] overflow-hidden rounded-[48px] border-[10px] border-ink bg-white shadow-[0_30px_80px_rgba(20,22,26,0.25)]'
          : 'relative mx-auto h-dvh w-full max-w-[480px] overflow-hidden bg-white'
      }
    >
      <div className="flex h-full flex-col">
        <main className="scroll-y min-h-0 flex-1">
          <Outlet />
        </main>
        <Nav />
      </div>
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
    </div>
  )
  if (!wide) return app
  return (
    <div className="flex min-h-full items-center justify-center gap-24 px-10 py-10">
      {app}
      <Panel />
    </div>
  )
}
