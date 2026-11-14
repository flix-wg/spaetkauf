import { useCallback, useEffect, useRef, useState } from 'react'

export type Async<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ok'; data: T; stale?: boolean }

// Once data is shown, polls and retries refresh quietly: no loading flash, and a failed refresh keeps the old data.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [state, setState] = useState<Async<T>>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const shown = useRef(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void (shown.current = false), deps)

  useEffect(() => {
    let live = true
    const run = (quiet: boolean) => {
      if (!quiet) setState({ status: 'loading' })
      fnRef.current().then(
        (data) => {
          if (!live) return
          shown.current = true
          setState({ status: 'ok', data })
        },
        (error) => {
          if (!live) return
          setState((prev) => prev.status === 'ok'
            ? { ...prev, stale: true }
            : { status: 'error', error })
        },
      )
    }
    run(shown.current)
    const id = pollMs ? window.setInterval(() => run(true), pollMs) : undefined
    return () => {
      live = false
      if (id) window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, pollMs])

  const retry = useCallback(() => setTick((t) => t + 1), [])
  return [state, retry] as const
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}
