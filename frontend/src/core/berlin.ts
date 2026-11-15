const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export function berlinLocal(isoUtc: string): string {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(isoUtc)).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

export function berlinDate(isoUtc: string): string { return berlinLocal(isoUtc).slice(0, 10) }

export function weekdayBerlin(isoUtc: string): number {
  return (new Date(`${berlinDate(isoUtc)}T00:00:00Z`).getUTCDay() + 6) % 7
}

export function zonedToUtc(day: string, hhmm: string): Date {
  const local = `${day}T${hhmm}:00`
  const target = Date.parse(`${local}Z`)
  const candidates = [...new Set([-12, 12].map(hours => {
    const probe = target + hours * 3_600_000
    const offset = Date.parse(`${berlinLocal(new Date(probe).toISOString())}Z`) - probe
    return target - offset
  }))]
  const exact = candidates.filter(value => berlinLocal(new Date(value).toISOString()) === local)
  // Python's default fold=0 uses the earlier occurrence, or the pre-transition offset in a gap.
  return new Date(exact.length ? Math.min(...exact) : Math.max(...candidates))
}
