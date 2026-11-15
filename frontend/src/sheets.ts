import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export type SheetName = 'sources' | 'backtest' | 'addon'
const NAMES: readonly string[] = ['sources', 'backtest', 'addon']

export function useSheet() {
  const [sp, setSp] = useSearchParams()
  const open = useCallback(
    (name: SheetName) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev)
          n.set('sheet', name)
          return n
        },
        { replace: false },
      ),
    [setSp],
  )
  const close = useCallback(
    () =>
      setSp((prev) => {
        const n = new URLSearchParams(prev)
        n.delete('sheet')
        return n
      }),
    [setSp],
  )
  const current = sp.get('sheet')
  return { current: current && NAMES.includes(current) ? (current as SheetName) : null, open, close }
}
