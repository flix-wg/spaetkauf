import type { HistoryRuns, TrainStops, RouteTrains } from '../api'

type Cell = string | number | bigint | boolean | null
type Query = (sql: string, args?: Cell[]) => Promise<Cell[][]>
interface Meta { date_from: string; date_to: string; source: string }
const SOURCE = 'Deutsche Bahn arrival data via piebro/deutsche-bahn-data, CC BY 4.0'
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export class NotFound extends Error {}

// Kept local until the parallel matching port is available.
function stationKey(name: string) {
  const spell: Record<string, string> = { m: 'main', fernbf: 'fernbahnhof' }
  const drop = new Set(['hbf', 'hauptbahnhof', 'bahnhof', 'bf', 'am', 'tief'])
  return [...new Set(name.normalize('NFC').toLowerCase().replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c]!)
    .replace(/\bs\s*\+\s*u\b/g, ' ').replace(/\s*\([a-z]{2}\)\s*$/, '').split(/[^0-9a-z]+/)
    .filter(t => t && !drop.has(t)).map(t => spell[t] ?? t))].sort().join(' ')
}
function stopMatch(name: string, rows: Cell[][], context: string): [string, string] {
  const keys = rows.map(r => String(r[0]))
  const key = stationKey(name)
  const alias: Record<string, string> = { frankfurt: 'frankfurt main', 'an brandenburg der havel': 'brandenburg' }
  const found = keys.includes(key) ? key : alias[key]
  if (!found || !keys.includes(found)) throw new NotFound(`'${name}' is not a stop ${context}`)
  return [found, rows.filter(r => r[0] === found).map(r => String(r[1])).sort()[0]]
}
function weekdayFilter(column: string, weekday?: number, parameter = 1): [string, Cell[]] {
  if (weekday === undefined) return ['', []]
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new RangeError('weekday must be between 0 and 6')
  return [` AND isodow(${column}) - 1 = $${parameter}`, [weekday]]
}
const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits
const hhmm = (n: Cell) => n === null ? null : `${String(Math.floor(Number(n) / 60) % 24).padStart(2, '0')}:${String(Number(n) % 60).padStart(2, '0')}`
const late = (alias: string, min: number) => `coalesce(${alias}.arr_cancelled OR ${alias}.arr_delay >= ${min}, false)`
const berlin = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' })
function iso(value: Cell): string | null {
  if (value === null) return null
  const local = String(value).replace(' ', 'T')
  // Parquet timestamps are Berlin wall times; Python attaches ZoneInfo with fold=0.
  const guess = new Date(local + 'Z').getTime()
  const offsetAt = (t: number) => berlin.formatToParts(t).find(p => p.type === 'timeZoneName')!.value.replace('GMT', '') || '+00:00'
  const offset = offsetAt(guess - 2 * 3600000)
  return local + offset
}

export function createHistory(query: Query, meta: Meta) {
  async function findTrain(train: string): Promise<[Cell, string, string]> {
    const parsed = /^\s*([A-Za-z]+)\s+0*(\d+)\s*$/.exec(train)
    if (!parsed) throw new NotFound(`'${train}' is not a train like 'ICE 1103'`)
    const kind = parsed[1].toUpperCase(), number = parsed[2]
    const family = [['ICE', 'IC'], ['EC', 'ECE'], ['RJ', 'RJX'], ['EN', 'NJ']].find(f => f.includes(kind)) ?? [kind]
    family.sort()
    const rows = await query(`SELECT id, train_type::VARCHAR, train_number FROM trains WHERE train_number = $1 AND train_type::VARCHAR IN (${family.map((_, i) => '$' + (i + 2)).join(',')}) ORDER BY train_type::VARCHAR = $${family.length + 2} DESC`, [number, ...family, kind])
    if (rows.length !== 1 && !(rows.length && rows[0][1] === kind)) throw new NotFound(`No history for ${kind} ${number}`)
    return [Number(rows[0][0]), String(rows[0][1]), String(rows[0][2])]
  }
  const allStops = () => query('SELECT station_key, name FROM stops')
  return {
    async historyRuns(train: string, stop: string, weekday?: number): Promise<HistoryRuns> {
      const [id, kind, number] = await findTrain(train)
      const stops = await query('SELECT DISTINCT s.station_key, s.name FROM events e JOIN stops s ON s.id = e.stop_id WHERE e.train_id = $1', [id])
      const [key, name] = stopMatch(stop, stops, `of ${kind} ${number}; stops: ${[...new Set(stops.map(r => String(r[1])))].sort().join(', ')}`)
      const [extra, args] = weekdayFilter('e.day', weekday, 3)
      const rows = await query(`SELECT e.day::VARCHAR, e.arr_planned::VARCHAR, e.arr_delay, e.arr_cancelled FROM events e JOIN stops s ON s.id = e.stop_id WHERE e.train_id = $1 AND s.station_key = $2 AND e.arr_planned IS NOT NULL${extra} ORDER BY e.arr_planned DESC`, [id, key, ...args])
      const runs = rows.map(([day, planned, delay, cancelled]) => ({ date: String(day), planned: iso(planned)!, delay_min: delay === null ? null : Number(delay), cancelled: cancelled === null ? null : Boolean(cancelled) }))
      const count = (min: number) => runs.filter(r => r.cancelled || (r.delay_min !== null && r.delay_min >= min)).length
      return { train: `${kind} ${number}`, stop: name, weekday: weekday === undefined ? null : WEEKDAYS[weekday], runs, summary: { n: runs.length, late20: count(20), late60: count(60), late120: count(120), cancelled: runs.filter(r => r.cancelled).length }, source: SOURCE }
    },
    async historyTrain(train: string, weekday?: number): Promise<TrainStops> {
      const [id, kind, number] = await findTrain(train)
      const [extra, args] = weekdayFilter('e.day', weekday, 2)
      const rows = await query(`SELECT s.station_key, min(s.name), count(*), sum(${late('e', 20)}::INT) FROM events e JOIN stops s ON s.id = e.stop_id WHERE e.train_id = $1 AND e.arr_planned IS NOT NULL${extra} GROUP BY s.station_key ORDER BY min(s.name)`, [id, ...args])
      return { train: `${kind} ${number}`, weekday: weekday === undefined ? null : WEEKDAYS[weekday], stops: rows.map(([key, name, n, l]) => ({ stop: String(name), key: String(key), n: Number(n), late20: Number(l), late20_share: round(Number(l) / Number(n)) })), source: SOURCE }
    },
    async historyRoute(from: string, to: string, weekday?: number): Promise<RouteTrains> {
      const stops = await allStops()
      const [a, aName] = stopMatch(from, stops, 'in the history'), [b, bName] = stopMatch(to, stops, 'in the history')
      const [extra, args] = weekdayFilter('f.dep_planned', weekday, 3)
      const rows = await query(`WITH f AS (
        SELECT e.run_id, e.seq, e.train_id, e.dep_planned FROM events e
        WHERE e.stop_id IN (SELECT id FROM stops WHERE station_key = $1) AND e.run_id IS NOT NULL AND e.dep_planned IS NOT NULL),
        j AS (SELECT f.train_id, e.arr_delay, e.arr_cancelled,
        date_part('hour', f.dep_planned) * 60 + date_part('minute', f.dep_planned) AS dep_min,
        date_part('hour', e.arr_planned) * 60 + date_part('minute', e.arr_planned) AS arr_min
        FROM f JOIN events e ON e.run_id = f.run_id AND e.seq > f.seq
        WHERE e.stop_id IN (SELECT id FROM stops WHERE station_key = $2) AND e.arr_planned IS NOT NULL ${extra})
        SELECT t.train_type::VARCHAR, t.train_number, count(*) AS n,
        sum(${late('j', 20)}::INT), sum(${late('j', 60)}::INT), median(j.arr_delay), mode(j.dep_min), mode(j.arr_min)
        FROM j JOIN trains t ON t.id = j.train_id GROUP BY t.train_type, t.train_number ORDER BY n DESC LIMIT 100`, [a, b, ...args])
      const trains = rows.map(([kind, number, n, l20, l60, med, dep, arr]) => ({ train: `${kind} ${number}`, n: Number(n), dep: hhmm(dep), arr: hhmm(arr), late20: Number(l20), late20_share: round(Number(l20) / Number(n)), late60: Number(l60), late60_share: round(Number(l60) / Number(n)), median_delay_min: med === null ? null : round(Number(med), 1) }))
      trains.sort((a, b) => a.dep! < b.dep! ? -1 : a.dep! > b.dep! ? 1 : a.train < b.train ? -1 : a.train > b.train ? 1 : 0)
      return { from: aName, to: bName, weekday: weekday === undefined ? null : WEEKDAYS[weekday], trains, source: SOURCE }
    },
    async historyStopDay(stop: string, date: string) {
      const [key, name] = stopMatch(stop, await allStops(), 'in the history')
      if (date < meta.date_from || date > meta.date_to) throw new NotFound(`The history covers ${meta.date_from} to ${meta.date_to}, not ${date}`)
      const rows = await query(`SELECT t.train_type::VARCHAR, t.train_number, e.arr_planned::VARCHAR, e.arr_delay, e.arr_cancelled, e.dep_planned::VARCHAR, e.dep_delay, e.dep_cancelled FROM events e JOIN trains t ON t.id = e.train_id JOIN stops s ON s.id = e.stop_id WHERE s.station_key = $1 AND e.day = $2 AND e.arr_planned IS NOT NULL ORDER BY e.arr_planned, t.train_type, t.train_number LIMIT 1001`, [key, date])
      return { stop: name, date, truncated: rows.length > 1000, arrivals: rows.slice(0, 1000).map(([kind, number, planned, delay, cancelled, dep, depDelay, depCancelled]) => ({ train: `${kind} ${number}`, planned: iso(planned), delay_min: delay === null ? null : Number(delay), cancelled, departs: iso(dep), dep_delay_min: depDelay === null ? null : Number(depDelay), dep_cancelled: depCancelled })), source: SOURCE }
    },
  }
}

let loading: Promise<ReturnType<typeof createHistory>> | undefined
async function loadHistory() {
  if (!loading) loading = initialize().catch(error => { loading = undefined; throw error })
  return loading
}
async function initialize() {
  const duck = await import('@duckdb/duckdb-wasm')
  const bundle = await duck.selectBundle({ mvp: { mainModule: '/duckdb/duckdb-mvp.wasm', mainWorker: '/duckdb/duckdb-browser-mvp.worker.js' }, eh: { mainModule: '/duckdb/duckdb-eh.wasm', mainWorker: '/duckdb/duckdb-browser-eh.worker.js' } })
  const worker = new Worker(bundle.mainWorker!)
  const db = new duck.AsyncDuckDB(new duck.VoidLogger(), worker)
  try {
    await db.instantiate(bundle.mainModule)
    const response = await fetch('/data/history/meta.json')
    if (!response.ok) throw new Error('Run history unavailable')
    const meta: Meta = await response.json()
    const files = ['trains.parquet', 'stops.parquet']
    for (let month = meta.date_from.slice(0, 7); month <= meta.date_to.slice(0, 7);) {
      files.push(`events-${month}.parquet`)
      const d = new Date(`${month}-01T00:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() + 1)
      month = d.toISOString().slice(0, 7)
    }
    for (const file of files) await db.registerFileURL(file, new URL(`/data/history/${file}`, location.href).href, duck.DuckDBDataProtocol.HTTP, false)
    const conn = await db.connect()
    await conn.query(`SET custom_extension_repository = '${location.origin}/duckdb/extensions'`)
    for (const [view, pattern] of [['events', 'events-*.parquet'], ['stops', 'stops.parquet'], ['trains', 'trains.parquet']]) await conn.query(`CREATE VIEW ${view} AS SELECT * FROM read_parquet('${pattern}')`)
    return createHistory(async (sql, args = []) => {
      const stmt = await conn.prepare(sql)
      try { return (await stmt.query(...args)).toArray().map(row => [...row].map(([, value]) => value as Cell)) }
      finally { await stmt.close() }
    }, meta)
  } catch (error) { await db.terminate(); worker.terminate(); throw error }
}
export async function historyRuns(train: string, stop: string, weekday?: number) { return (await loadHistory()).historyRuns(train, stop, weekday) }
export async function historyTrain(train: string, weekday?: number) { return (await loadHistory()).historyTrain(train, weekday) }
export async function historyRoute(from: string, to: string, weekday?: number) { return (await loadHistory()).historyRoute(from, to, weekday) }
export async function historyStopDay(stop: string, date: string) { return (await loadHistory()).historyStopDay(stop, date) }
