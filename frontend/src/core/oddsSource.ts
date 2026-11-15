export const GE_COLUMNS = ['ge5', 'ge10', 'ge15', 'ge20', 'ge30', 'ge45', 'ge60', 'ge90', 'ge120'] as const
export type Rates = Record<typeof GE_COLUMNS[number], number>
export type TrainRow = [string, string, string, number, number, number, number, number, number, number, number, number, number, number, number, string, string]
export interface TrainShard { type: string; number: string; rows: TrainRow[] }
export interface OddsIndex {
  meta: Record<string, string>
  numbers: Record<string, string[]>
  type_rates: Record<string, Rates>
  stations: Record<string, { eva: string; name: string }>
  eva_names: Record<string, string>
}
export interface OddsSource {
  index(): Promise<OddsIndex>
  train(type: string, number: string): Promise<TrainShard | null>
}

// Only answers that will not change (404, or the Pages HTML fallback) stay memoized as missing;
// 5xx, network errors and timeouts are retried on the next call.
export function httpOddsSource(base: string, init: RequestInit = {}, timeoutMs = 10000): OddsSource {
  const memo = new Map<string, Promise<unknown>>()
  function read<T>(path: string, missing = false): Promise<T> {
    const cached = memo.get(path)
    if (cached) return cached as Promise<T>
    const request = fetch(`${base}/odds/${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) }).then(async response => {
      if (missing && !response.ok) {
        if (response.status !== 404) memo.delete(path)
        return null as T
      }
      if (!response.ok) throw new Error(`Odds source returned ${response.status}`)
      try { return await response.json() as T }
      catch (error) { if (missing) return null as T; throw error }
    }).catch(error => { memo.delete(path); throw error })
    memo.set(path, request)
    return request
  }
  return {
    index: () => read<OddsIndex>('index.json'),
    train: (type, number) => read<TrainShard | null>(`trains/${encodeURIComponent(type)}-${encodeURIComponent(number)}.json`, true),
  }
}
