import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changeLang, getLang, initialLang, locale, tr, tx } from '../src/i18n-core.ts'

test('language preference, navigator fallback and blocked storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['de-DE', 'en'] } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value),
  } })
  try {
    assert.equal(initialLang(), 'de')
    changeLang('en')
    assert.equal(initialLang(), 'en')
    changeLang('de')
    assert.equal(getLang(), 'de')
    assert.equal(locale(), 'de-DE')
    assert.equal(tr('settings'), 'Einstellungen')
    assert.equal(tx('changes', 2), '2 Umstiege')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
    changeLang('en')
    assert.equal(tr('settings'), 'Settings')
    assert.equal(initialLang(), 'de')
  } finally {
    changeLang('en')
    Reflect.deleteProperty(globalThis, 'localStorage')
    if (original) Object.defineProperty(globalThis, 'navigator', original)
  }
})
