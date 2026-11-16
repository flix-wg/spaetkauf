import assert from 'node:assert/strict'
import { test } from 'node:test'
import { api, ApiError, type Pick } from '../src/api.ts'
import { berlinDate } from '../src/core/berlin.ts'
import { changeLang, tr } from '../src/i18n-core.ts'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: i => [...values.keys()][i] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: key => void values.delete(key),
    clear: () => values.clear(),
  }
}
const setGlobal = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, value })
const hub = [{ id: 'de-hbf', name: 'Berlin Hbf', lat: 52.5, lon: 13.4, type: 'STOP', modes: ['HIGHSPEED_RAIL'] }]
const status = (error: unknown) => (assert.ok(error instanceof ApiError), error.status)

test('api maps the static core onto the old response and error shapes', async () => {
  const names = ['localStorage', 'sessionStorage', 'fetch']
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))
  const local = memoryStorage()
  setGlobal('localStorage', local)
  setGlobal('sessionStorage', memoryStorage())
  const seen: string[] = []
  setGlobal('fetch', async (url: string) => {
    seen.push(new URL(url).hostname)
    return url.includes('/geocode') ? Response.json(hub) : new Response('busy', { status: 429 })
  })
  try {
    const query = { from: 'Berlin', to: 'Berlin', date: '2099-01-01', time: '10:00' }
    await assert.rejects(api.picks(query), e => status(e) === 503 && e.message === tr('theLiveTrainSourceIsNotAnswering'))
    local.setItem(`kurt.plan-budget.${berlinDate(new Date().toISOString())}`, '60')
    await assert.rejects(api.picks(query), e => status(e) === 429 && e.message === tr('kurtHasUsedUpTodaySRoute'))
    await assert.rejects(api.picks({ ...query, date: '2000-01-01' }), e => status(e) === 400)
    assert.deepEqual(new Set(seen), new Set(['api.transitous.org']))

    changeLang('de')
    assert.equal((await api.signals(query)).blocked, true)
    await assert.rejects(api.picks({ ...query, date: '2000-01-01' }), { message: 'Das Datum liegt in der Vergangenheit.' })
    await assert.rejects(api.trip({ id: 'abc', secret: 'x' }), e => status(e) === 404)

    setGlobal('localStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } })
    await assert.rejects(api.createTrip({ legs: [] } as unknown as Pick), { message: tr('tripsCannotBeSavedOnThisDevice') })
  } finally {
    changeLang('en')
    names.forEach((name, i) => originals[i] ? Object.defineProperty(globalThis, name, originals[i]) : Reflect.deleteProperty(globalThis, name))
  }
})
