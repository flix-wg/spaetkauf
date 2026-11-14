import type { Pick, SignalItem } from './api'

// Exa news for a route often names a closure elsewhere in the region ("ICE trains between Munich
// and Nuremberg" for München → Zürich). A pick warns only when the news names a place its trains
// pass, other than where the journey starts and ends, or when it says it is nationwide.
const GENERIC = new Set(['bad', 'ost', 'sud', 'hbf', 'bhf', 'bahnhof', 'hauptbahnhof', 'fernbf', 'flughafen', 'airport', 'messe', 'main', 'saale', 'nord', 'west', 'mitte', 'stadt'])
const ALIAS: Record<string, string[]> = {
  munchen: ['munich'],
  nurnberg: ['nuremberg'],
  koln: ['cologne'],
  hannover: ['hanover'],
  braunschweig: ['brunswick'],
}
const nationwide = /\b(nationwide|nationally|bundesweit|across germany)\b/i

// Frankfurt (Oder) is a different city from Frankfurt (Main): one word on both sides.
const oder = (s: string) => s.replace(/frankfurt\W*\(?oder\)?/gi, 'frankfurtoder')
const fold = (s: string) => s.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
const spelled = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')

// "S+U Berlin Hauptbahnhof" → berlin; "Halle (Saale) Hbf" → halle; "Hamburg-Harburg" → hamburg, harburg.
export function places(name: string): string[] {
  const words = oder(name)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*(S\+U|S|U)\s+/i, '')
    .split(/[\s,/-]+/)
  const out = new Set<string>()
  for (const w of words) {
    const f = fold(w)
    if (f.length < 3 || GENERIC.has(f)) continue
    out.add(f)
    out.add(spelled(w)) // Nürnberg → nuernberg
    for (const a of ALIAS[f] ?? []) out.add(a)
  }
  return [...out]
}

export function onPick(items: SignalItem[], pick: Pick): SignalItem[] {
  const legs = pick.legs
  // Picks saved before via existed, or without stop data: keep the route-level warning.
  if (!legs.length || legs.every((l) => l.via === undefined)) return items
  const ends = new Set([...places(legs[0].from), ...places(legs[legs.length - 1].to)])
  const stops = new Set(legs.flatMap((l) => [l.from, ...(l.via ?? []), l.to]).flatMap(places))
  const names = [...stops].filter((p) => !ends.has(p))
  return items.filter((it) => {
    if (nationwide.test(it.reason)) return true
    const text = ` ${fold(oder(it.reason)).replace(/[^a-z0-9]+/g, ' ')} `
    return names.some((p) => text.includes(` ${p} `))
  })
}
