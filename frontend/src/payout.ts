export const MIN_PAYOUT = 4

// Same rule as backend/app/claim.py: pct of the price, rounded up to the next 5 cents (in whole cents).
export const payout = (price: number, pct: number) => (Math.ceil((Math.round(price * 100) * pct) / 500) * 5) / 100
