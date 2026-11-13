import { useCallback, useEffect, useRef, useState } from 'react'

export type Async<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ok'; data: T }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [state, setState] = useState<Async<T>>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let live = true
    const run = (first: boolean) => {
      if (first) setState({ status: 'loading' })
      fnRef.current().then(
        (data) => live && setState({ status: 'ok', data }),
        (error) => live && (first ? setState({ status: 'error', error }) : undefined),
      )
    }
    run(true)
    const id = pollMs ? window.setInterval(() => run(false), pollMs) : undefined
    return () => {
      live = false
      if (id) window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

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
