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
