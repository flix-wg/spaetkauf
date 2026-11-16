export interface ClaimResult { due: boolean; pct: number; amount_eur: number | null; reason: string }
export function computeClaim(price: number | null, delayMin: number | null, switched: boolean): ClaimResult {
  if (switched) return { due: false, pct: 0, amount_eur: null, reason: 'You switched trains: compensation depends on your actual arrival on the train you took. If you arrived under 60 minutes late, nothing is owed; 60–119 minutes gives 25 % of the ticket price, 120+ gives 50 % (minimum payout 4 EUR). Fill in your actual arrival yourself.' }
  if (delayMin === null) return { due: false, pct: 0, amount_eur: null, reason: 'No delay recorded yet.' }
  if (delayMin < 60) return { due: false, pct: 0, amount_eur: null, reason: `Under 60 minutes late (${delayMin} min): no compensation is due.` }
  const pct = delayMin >= 120 ? 50 : 25
  if (price === null) return { due: true, pct, amount_eur: null, reason: `${pct} % of the ticket price is owed. Enter the price to see the amount.` }
  const cents = Math.ceil(Math.round(price * 100) * pct / 500) * 5
  if (cents < 400) return { due: false, pct, amount_eur: null, reason: `${pct} % would be ${(cents / 100).toFixed(2)} EUR; DB pays nothing under 4.00 EUR. Still yours: the lifted Zugbindung from 20 minutes late, and a full refund if you give up the trip at an expected 60+ minutes.` }
  return { due: true, pct, amount_eur: cents / 100, reason: `${delayMin} min late: ${pct} % of ${price.toFixed(2)} EUR, rounded up to 5 cents.` }
}
interface Snapshot { at: string; delay_min: number | null; cancelled: boolean }
export function timeline(snaps: Snapshot[]): Snapshot[] {
  const rows = snaps.filter(s => s.delay_min !== null || s.cancelled)
  const kept: Snapshot[] = []
  rows.forEach((s, i) => {
    const prev = kept.at(-1)
    if (!prev || i === rows.length - 1 || !!s.cancelled !== prev.cancelled || Math.abs((s.delay_min ?? 0) - (prev.delay_min ?? 0)) >= 5 || [20, 60, 120].some(line => ((s.delay_min ?? 0) >= line) !== ((prev.delay_min ?? 0) >= line))) {
      kept.push({ at: s.at, delay_min: s.delay_min, cancelled: !!s.cancelled })
    }
  })
  return kept
}
