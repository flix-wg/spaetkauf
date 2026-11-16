import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Pages headers allow browser data, DuckDB and the inline bootstrap scripts', () => {
  const blocks = new Map<string, Map<string, string>>()
  let headers: Map<string, string>
  for (const line of readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').split('\n')) {
    if (line.startsWith('/')) blocks.set(line, headers = new Map())
    else if (line.trim()) {
      const [key, ...value] = line.trim().split(': ')
      headers!.set(key.toLowerCase(), value.join(': '))
    }
  }
  const site = blocks.get('/*')!
  const csp = new Map(site.get('content-security-policy')!.split(';').map(d => {
    const [name, ...sources] = d.trim().split(/\s+/)
    return [name, sources]
  }))
  for (const [directive, sources] of Object.entries({
    'default-src': ["'self'"], 'connect-src': ["'self'", 'blob:', 'https://api.transitous.org'],
    'script-src': ["'self'", "'wasm-unsafe-eval'"], 'worker-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"], 'frame-ancestors': ["'none'"], 'base-uri': ["'self'"], 'object-src': ["'none'"],
  })) for (const source of sources) assert.ok(csp.get(directive)?.includes(source), `${directive}: ${source}`)
  assert.deepEqual(csp.get('worker-src'), ["'self'"])
  assert.ok(!csp.get('script-src')!.includes("'unsafe-inline'"))
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.ok(csp.get('script-src')!.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`))
  }
  assert.equal(site.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.equal(site.get('x-content-type-options'), 'nosniff')
  assert.equal(blocks.get('/data/*')!.get('cache-control'), 'public, max-age=86400')
  assert.equal(blocks.get('/assets/*')!.get('cache-control'), 'public, max-age=31536000, immutable')
  const wasm = blocks.get('/duckdb/duckdb-eh.wasm.gz')!
  assert.equal(wasm.get('content-type'), 'application/octet-stream')
  assert.ok(wasm.has('! content-encoding'))
})
