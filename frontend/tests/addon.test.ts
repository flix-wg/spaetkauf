import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPhone } from '../src/addon.ts'

test('the add-on install is offered on computers only', () => {
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  assert.equal(isPhone(mac), false)
  assert.equal(isPhone('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'), false)
  assert.equal(isPhone('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'), true)
  assert.equal(isPhone('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'), true)
  // iPadOS asks for the desktop site and says Macintosh; only the touch points give it away.
  assert.equal(isPhone(mac, 5), true)
})
