import type { ReactNode } from 'react'

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}
const I = (children: ReactNode) => (p: { size?: number; className?: string }) => (
  <svg {...base} width={p.size ?? 22} height={p.size ?? 22} className={p.className}>
    {children}
  </svg>
)

export const IconInfo = I(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>)
export const IconSearch = I(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>)
export const IconTrain = I(<><rect x="5" y="3" width="14" height="14" rx="4" /><path d="M5 11h14M9 21l2-4M15 21l-2-4M9 14h.01M15 14h.01" /></>)
export const IconTicket = I(<><path d="M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6Z" /><path d="M14 5v3M14 11v2M14 16v3" /></>)
export const IconClock = I(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)
export const IconExternal = I(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>)
export const IconBell = I(<><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15Z" /><path d="M10 21h4" /></>)
export const IconCopy = I(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>)
export const IconCheck = I(<path d="m5 12.5 4.5 4.5L19 7" />)
export const IconClose = I(<path d="M6 6l12 12M18 6 6 18" />)
export const IconTrash = I(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>)
export const IconHistory = I(<><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" /><path d="M3.5 3.5v5h5M12 7.5V12l3 2" /></>)
export const IconChevron = I(<path d="m9 6 6 6-6 6" />)
export const IconBack = I(<path d="m15 6-6 6 6 6" />)
export const IconSwap = I(<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />)
export const IconAlert = I(<><path d="M12 3 2.5 20h19Z" /><path d="M12 10v5M12 17.5v.01" /></>)
export const IconShield = I(<path d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6Z" />)

export const IconSettings = I(<><path d="m9 3-1 3-3 1v4l2 2-1 3 3 3 3-1 2 2h4l1-3 3-1v-4l-2-2 1-3-3-3-3 1-2-2Z"/><circle cx="12" cy="12" r="3"/></>)
