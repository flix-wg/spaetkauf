import { useEffect, useRef, type ReactNode } from 'react'
import { IconClose } from './Icons'

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose])
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end lg:items-center lg:justify-center lg:p-10">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/45" onClick={onClose} tabIndex={-1} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="sheet-in relative flex max-h-[88%] flex-col rounded-t-3xl bg-white outline-none lg:max-h-full lg:w-[640px] lg:rounded-3xl lg:shadow-[0_30px_80px_rgba(20,22,26,0.3)]"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4 lg:px-8 lg:pt-6">
          <h2 className="font-display text-[22px] font-bold lg:text-[28px]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface"
          >
            <IconClose />
          </button>
        </div>
        <div className="scroll-y px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-8">{children}</div>
      </div>
    </div>
  )
}
