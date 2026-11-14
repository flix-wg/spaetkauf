import assert from 'node:assert/strict'
import { test } from 'node:test'
import { payout } from '../src/payout.ts'

test('payout matches the claim-helper spec', () => {
  assert.equal(payout(34.99, 25), 8.75)
  assert.equal(payout(12.9, 25), 3.25)
  assert.equal(payout(40, 50), 20)
})
