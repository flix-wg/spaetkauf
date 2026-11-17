import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHistory, NotFound, historyRoute } from '../../src/core/history.ts'

const require = createRequire(import.meta.url)
const dist = new URL('../../node_modules/@duckdb/duckdb-wasm/dist/', import.meta.url).pathname
const data = new URL('../../public/data/history/', import.meta.url)
const golden = JSON.parse(readFileSync(new URL('./golden/history.json', import.meta.url), 'utf8'))
const meta = JSON.parse(readFileSync(new URL('meta.json', data), 'utf8'))
const afterRange = new Date(Date.parse(`${meta.date_to}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
let db, conn, history
before(async () => {
  assert.ok(existsSync(data), 'History Parquet data missing; run scripts/export_static.py --history <history.duckdb> --out frontend/public/data')
  const extensions = new URL('../../public/duckdb/extensions/', import.meta.url).pathname
  const parquet = extensions + 'v1.4.3/wasm_eh/parquet.duckdb_extension.wasm'
  assert.ok(existsSync(parquet), `Offline DuckDB-WASM Parquet extension missing: ${parquet}; run scripts/fetch_duckdb_ext.sh`)
  const duck = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs')
  db = await duck.createDuckDB({ eh: { mainModule: dist + 'duckdb-eh.wasm' } }, new duck.VoidLogger(), duck.NODE_RUNTIME)
  await db.instantiate()
  conn = db.connect()
  // The pinned WASM extension loader uses synchronous XHR even in Node.
  globalThis.XMLHttpRequest = class {
    open(method, url) {
      assert.equal(method, 'GET')
      assert.equal(url, 'https://history.test/duckdb/extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm')
    }
    setRequestHeader() {}
    send() { this.response = Uint8Array.from(readFileSync(parquet)).buffer; this.status = 200 }
  }
  conn.query("SET custom_extension_repository = 'https://history.test/duckdb/extensions'")
  conn.query('LOAD parquet')
  for (const name of readdirSync(data).filter(n => n.endsWith('.parquet'))) {
    db.registerFileBuffer(name, new Uint8Array(readFileSync(new URL(name, data))))
  }
  for (const [view, file] of [['events', 'events-*.parquet'], ['stops', 'stops.parquet'], ['trains', 'trains.parquet']]) {
    conn.query(`CREATE VIEW ${view} AS SELECT * FROM read_parquet('${file}')`)
  }
  history = createHistory(async (sql, args = []) => {
    const stmt = conn.prepare(sql)
    try { return stmt.query(...args).toArray().map(row => [...row].map(([, value]) => value)) }
    finally { stmt.close() }
  }, JSON.parse(readFileSync(new URL('meta.json', data), 'utf8')))
})
after(() => { conn?.close(); delete globalThis.XMLHttpRequest })
test('runs match Python including Berlin timestamps across DST', async () => {
  assert.deepEqual(await history.historyRuns('ICE 785', 'München Hbf'), golden.runs)
})
test('Friday route matches Python', async () => {
  assert.deepEqual(await history.historyRoute('Hamburg Hbf', 'München Hbf', 4), golden.route)
})
test('train stops match Python', async () => {
  assert.deepEqual(await history.historyTrain('ICE 785', 4), golden.train)
})
test('DST stop-day matches Python', async () => {
  assert.deepEqual(await history.historyStopDay('München Hbf', golden.day.date), golden.day)
})
test('unknown train and out-of-range date retain the Python errors', async () => {
  await assert.rejects(history.historyRuns('ICE 99999', 'München Hbf'), new NotFound('No history for ICE 99999'))
  await assert.rejects(history.historyStopDay('München Hbf', afterRange), new NotFound(`The history covers ${meta.date_from} to ${meta.date_to}, not ${afterRange}`))
})

test('shares round exact halves to even like Python', async () => {
  const h = createHistory(async sql => sql.startsWith('SELECT id,')
    ? [[1, 'ICE', '785']] : [['muenchen', 'München Hbf', 32, 1]],
    { date_from: '2025-12-14', date_to: '2026-10-31', source: '' })
  assert.equal((await h.historyTrain('ICE 785')).stops[0].late20_share, 0.0312)
})
test('missing or HTML history metadata fails before any WASM download', async () => {
  const original = globalThis.fetch
  try {
    for (const response of [new Response('', { status: 404 }), new Response('<!doctype html>')]) {
      const urls = []
      globalThis.fetch = async url => { urls.push(url); return response }
      await assert.rejects(historyRoute('Hamburg', 'München'), new Error('Run history unavailable'))
      assert.deepEqual(urls, ['/data/history/meta.json'])
    }
  } finally { globalThis.fetch = original }
})
