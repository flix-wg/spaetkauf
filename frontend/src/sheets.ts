import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

export type SheetName = 'settings' | 'sources' | 'backtest' | 'addon'
const NAMES: readonly string[] = ['settings', 'sources', 'backtest', 'addon']

export function useSheet() {
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const opened = (useLocation().state as { sheet?: boolean } | null)?.sheet === true
  const showing = sp.get('sheet') !== null
  const open = useCallback(
    (name: SheetName) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev)
          n.set('sheet', name)
          return n
        },
        // From one sheet to another: replace it, so one close or Back still dismisses the overlay.
        showing ? { replace: true, state: opened ? { sheet: true } : null } : { state: { sheet: true } },
      ),
    [setSp, showing, opened],
  )
  // Opened here: step back to the entry before it, so Back never reopens a closed sheet.
  const close = useCallback(() => {
    if (opened) return nav(-1)
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev)
        n.delete('sheet')
        return n
      },
      { replace: true },
    )
  }, [opened, nav, setSp])
  const current = sp.get('sheet')
  return { current: current && NAMES.includes(current) ? (current as SheetName) : null, open, close }
}
