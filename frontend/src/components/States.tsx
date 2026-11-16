import { tr, useT } from '../i18n'
import type { ReactNode } from 'react'
import { Kurt } from './Kurt'

export function Loading({ label = tr('kurtIsChecking') }: { label?: string }) {
  useT()
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-muted" role="status">
      <Kurt width={64} body="#8A9099" shell="#E4E4E0" motion="crawl" />
      <span className="text-[14px]">{label}</span>
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  useT()
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Kurt width={88} />
      <h2 className="font-display text-[20px] font-bold">{title}</h2>
      {children && <p className="max-w-[300px] text-[14px] leading-snug text-muted">{children}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  useT()
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" role="alert">
      <Kurt width={88} shell="var(--color-page)" className="-rotate-12" />
      <h2 className="font-display text-[20px] font-bold">{tr('kurtTripped')}</h2>
      <p className="max-w-[300px] text-[14px] leading-snug text-muted">{error.message || tr('somethingWentWrong')}</p>
      <button type="button" onClick={retry} className="btn-primary">{tr('tryAgain')} </button>
    </div>
  )
}
