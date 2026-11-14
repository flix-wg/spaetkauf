import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Pick, SignalItem } from '../src/api.ts'
import { onPick, places } from '../src/onroute.ts'

const item = (reason: string): SignalItem => ({ kind: 'event', reason, source: 'x', published: null, url: 'u' })
const pick = (legs: { from: string; to: string; via?: string[] }[]) =>
  ({ legs: legs.map((l) => ({ train: 'ICE 1', dep: '', arr: '', trip_id: 't', ...l })) }) as unknown as Pick

const closure = item('Full closure between Nuremberg and Ingolstadt; ICE trains between Munich and Nuremberg diverted.')

test('station names reduce to places', () => {
  assert.deepEqual(places('S+U Berlin Hauptbahnhof'), ['berlin'])
  assert.deepEqual(places('Halle (Saale) Hbf'), ['halle'])
  assert.deepEqual(places('Hamburg-Harburg'), ['hamburg', 'harburg'])
  assert.deepEqual(places('Nürnberg Hbf'), ['nurnberg', 'nuernberg', 'nuremberg'])
})

test('news warns only when it names a stop the pick passes', () => {
  const hamMuc = pick([{ from: 'Hamburg Hbf', to: 'München Hbf', via: ['Erfurt Hbf', 'Nürnberg Hbf', 'Augsburg Hbf'] }])
  const mucZrh = pick([{ from: 'München Hbf', to: 'Zürich HB', via: ['Buchloe', 'Memmingen', 'Lindau-Reutin'] }])
  assert.equal(onPick([closure], hamMuc).length, 1)
  // Munich is only where the journey starts.
  assert.equal(onPick([closure], mucZrh).length, 0)
  // A change station counts.
  const viaChange = pick([{ from: 'Leipzig Hbf', to: 'Nürnberg Hbf', via: [] }, { from: 'Nürnberg Hbf', to: 'Ingolstadt Hbf', via: [] }])
  assert.equal(onPick([closure], viaChange).length, 1)
  assert.equal(onPick([item('Nationwide strike: all ICE services cancelled.')], mucZrh).length, 1)
  assert.equal(onPick([item('All long-distance trains between Nuremberg and Ingolstadt diverted.')], mucZrh).length, 0)
  const viaUlm = pick([{ from: 'Stuttgart Hbf', to: 'München Hbf', via: ['Ulm Hbf', 'Augsburg Hbf'] }])
  assert.equal(onPick([item('ICE services disrupted by a closure at Ulm.')], viaUlm).length, 1)
  const viaFfm = pick([{ from: 'Köln Hbf', to: 'Berlin Hbf', via: ['Frankfurt(Main)Hbf'] }])
  assert.equal(onPick([item('Closure between Frankfurt (Oder) and Berlin hits ICE trains.')], viaFfm).length, 0)
  assert.equal(onPick([item('ICE trains via Frankfurt (Main) diverted.')], viaFfm).length, 1)
})

test('picks without via keep the route-level warning', () => {
  assert.equal(onPick([closure], pick([{ from: 'München Hbf', to: 'Zürich HB' }])).length, 1)
})
