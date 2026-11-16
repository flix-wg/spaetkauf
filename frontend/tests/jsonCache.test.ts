import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jsonCachePlugin } from '../src/jsonCache.ts'

test('data caches accept successful JSON and reject Pages HTML fallbacks and errors', async () => {
  for (const [status, type, accepted] of [[200, 'application/json; charset=utf-8', true], [200, 'text/html', false], [404, 'application/json', false]] as const) {
    const response = new Response('{}', { status, headers: { 'content-type': type } })
    assert.equal(await jsonCachePlugin.cacheWillUpdate({ response }), accepted ? response : null)
  }
})
