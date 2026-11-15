import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as matching from '../../src/core/matching.ts'
import * as odds from '../../src/core/odds.ts'
import * as berlin from '../../src/core/berlin.ts'
import { httpOddsSource } from '../../src/core/oddsSource.ts'

const data = new URL('../../public/data/odds/', import.meta.url)
const fileSource = {
  async index() { return JSON.parse(await readFile(new URL('index.json', data), 'utf8')) },
  async train(type: string, number: string) {
    try { return JSON.parse(await readFile(new URL(`trains/${type}-${number}.json`, data), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  },
}
const cases = JSON.parse(await readFile(new URL('./golden/odds.json', import.meta.url), 'utf8'))
for (const c of cases) {
  test(`${c.fn}: ${c.label || JSON.stringify(c.args)}`, async () => {
    const fn = { ...matching, ...odds, ...berlin }[c.fn]
    const args = ['findStats', 'connectionOdds', 'missOdds', 'legOdds'].includes(c.fn) ? [fileSource, ...c.args] : c.args
    let actual = await fn(...args)
    if (actual instanceof Date) actual = actual.toISOString()
    assert.deepStrictEqual(actual, c.expected)
  })
}

test('HTTP source memoizes successes and missing shards; failed loads can retry', async () => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    if (String(url).endsWith('ICE-99999.json')) return new Response('', { status: 404 })
    if (urls.length === 1) return new Response('', { status: 503 })
    return Response.json({ numbers: {} })
  }
  try {
    const src = httpOddsSource('/data')
    await assert.rejects(src.index())
    const [a, b] = await Promise.all([src.index(), src.index()])
    assert.deepStrictEqual(a, { numbers: {} })
    assert.strictEqual(a, b)
    assert.equal(await src.train('ICE', '99999'), null)
    assert.equal(await src.train('ICE', '99999'), null)
    assert.deepStrictEqual(urls, ['/data/odds/index.json', '/data/odds/index.json', '/data/odds/trains/ICE-99999.json'])
  } finally { globalThis.fetch = original }
})

test('HTTP odds requests pass fetch options and abort stalled fetches so a retry refetches', async () => {
  const original = globalThis.fetch
  const inits: RequestInit[] = []
  globalThis.fetch = (_url, init) => {
    inits.push(init!)
    if (inits.length > 1) return Promise.resolve(Response.json({ numbers: {} }))
    return new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))
  }
  try {
    const src = httpOddsSource('/data', { redirect: 'error' }, 20)
    await assert.rejects(src.index())
    assert.deepStrictEqual(await src.index(), { numbers: {} })
    assert.equal(inits.length, 2)
    assert.equal(inits[0].redirect, 'error')
  } finally { globalThis.fetch = original }
})


test('HTTP matching skips unindexed shards, including family fallbacks', async () => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async (url) => {
    const path = String(url)
    urls.push(path)
    if (path.endsWith('index.json')) return Response.json(await fileSource.index())
    if (path.endsWith('ICE-785.json')) return Response.json(await fileSource.train('ICE', '785'))
    return new Response('<!doctype html><html>App</html>', { headers: { 'Content-Type': 'text/html' } })
  }
  try {
    const src = httpOddsSource('/data')
    for (const label of ['unknown_train', 'family fallback']) {
      const c = cases.find(c => c.fn === 'findStats' && c.label === label)
      assert.deepStrictEqual(await matching.findStats(src, ...c.args), c.expected)
    }
    assert.deepStrictEqual(urls, ['/data/odds/index.json', '/data/odds/trains/ICE-785.json'])
  } finally { globalThis.fetch = original }
})

test('HTTP train shards return null for non-ok responses and invalid JSON', async () => {
  const original = globalThis.fetch
  try {
    for (const status of [200, 404, 503]) {
      globalThis.fetch = async () => new Response('<html>App</html>', { status })
      assert.equal(await httpOddsSource('/data').train('ICE', '99999'), null)
    }
    let calls = 0
    globalThis.fetch = async () => ++calls === 1 ? new Response('', { status: 503 }) : Response.json({ type: 'ICE', number: '1', rows: [] })
    const src = httpOddsSource('/data')
    assert.equal(await src.train('ICE', '1'), null)
    assert.deepStrictEqual(await src.train('ICE', '1'), { type: 'ICE', number: '1', rows: [] })
  } finally { globalThis.fetch = original }
})
