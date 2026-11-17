import { useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react'

// Safari has no closedby yet: there, click-outside is done by hand. Esc and back work everywhere.
const noClosedBy = typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)

function outside(e: PointerEvent<HTMLDialogElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
}

// A native modal <dialog>, open while mounted. The browser makes the page behind it inert, keeps
// focus inside, closes it on Esc or the Android back gesture, and returns focus when it closes.
export function Modal({
  onClose,
  lightDismiss = false,
  initialFocus,
  className,
  children,
  ...aria
}: {
  onClose: () => void
  lightDismiss?: boolean
  initialFocus?: RefObject<HTMLElement | null>
  className: string
  children: ReactNode
  'aria-label'?: string
  'aria-labelledby'?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const latest = useRef(onClose)
  const pressedOutside = useRef(false)
  useLayoutEffect(() => {
    latest.current = onClose
  })
  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    // A close queued by an earlier unmount (StrictMode remount) can land after reopening: ignore it.
    const closed = () => { if (!d.open) latest.current() }
    d.addEventListener('close', closed)
    d.showModal()
    ;(initialFocus?.current ?? d).focus()
    return () => {
      d.removeEventListener('close', closed)
      if (d.open) d.close()
    }
  }, [initialFocus])
  const fallback = lightDismiss && noClosedBy
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      closedby={lightDismiss ? 'any' : 'closerequest'}
      className={className}
      onPointerDown={fallback ? (e) => { pressedOutside.current = outside(e) } : undefined}
      onPointerUp={fallback ? (e) => { if (pressedOutside.current && outside(e)) e.currentTarget.close() } : undefined}
      {...aria}
    >
      {children}
    </dialog>
  )
}
