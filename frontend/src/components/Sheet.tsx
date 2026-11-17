import { tr, useT } from '../i18n'
import { useId, type ReactNode } from 'react'
import { IconClose } from './Icons'
import { Modal } from './Modal'

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useT()
  const titleId = useId()
  return (
    <Modal
      onClose={onClose}
      lightDismiss
      aria-labelledby={titleId}
      className="sheet-in m-auto mb-0 max-h-[88dvh] w-full max-w-[480px] flex-col rounded-t-3xl border-0 bg-page p-0 text-ink outline-none open:flex lg:mb-auto lg:max-h-[calc(100dvh-80px)] lg:w-[640px] lg:max-w-[calc(100vw-80px)] lg:rounded-3xl lg:shadow-[0_30px_80px_var(--color-shadow)]"
    >
      <div className="flex items-center justify-between px-5 pb-2 pt-4 lg:px-8 lg:pt-6">
        <h2 id={titleId} className="font-display text-[22px] font-bold lg:text-[28px]">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={tr('close')}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface"
        >
          <IconClose />
        </button>
      </div>
      <div className="scroll-y px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-8">{children}</div>
    </Modal>
  )
}
