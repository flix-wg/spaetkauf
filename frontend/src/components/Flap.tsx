import { Fragment, useEffect, useState, type CSSProperties } from 'react'

const DIGITS = '0123456789'
// Every tile makes the same flips, fast at first and easing into its card, so a board lands as one wave.
const STEPS = [50, 50, 50, 55, 65, 80, 105, 150]
const TILE_STAGGER = 35

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// The cards shown on the way to `ch`: digits roll through the digits before them; a sign rolls the digits, then lands.
const route = (ch: string) => {
  const n = STEPS.length
  const i = DIGITS.indexOf(ch)
  if (i >= 0) return STEPS.map((_, k) => DIGITS[(i - (n - 1 - k) + 20) % 10])
  if (ch === '+' || ch === '−') return [...DIGITS.slice(10 - (n - 1)), ch]
  return [ch]
}

type Face = { cur: string; prev: string; n: number; ms: number; last: boolean }

function Tile({ ch, delay, dims }: { ch: string; delay: number; dims: string }) {
  const [f, setF] = useState<Face>(() => {
    const c = still() ? ch : ' '
    return { cur: c, prev: c, n: 0, ms: STEPS[0], last: false }
  })
  useEffect(() => {
    if (still()) {
      setF((s) => ({ ...s, cur: ch, prev: ch }))
      return
    }
    const cards = route(ch)
    const steps = cards.length === 1 ? [STEPS[STEPS.length - 1]] : STEPS
    const timers: ReturnType<typeof setTimeout>[] = []
    let at = delay
    cards.forEach((card, k) => {
      timers.push(setTimeout(() => setF((s) => ({ cur: card, prev: s.cur, n: s.n + 1, ms: steps[k], last: k === cards.length - 1 })), at))
      at += steps[k]
    })
    // Settle the static bottom too, so a paused animation (background tab) never leaves a split card.
    timers.push(setTimeout(() => setF((s) => ({ ...s, prev: s.cur })), at + 200))
    return () => timers.forEach(clearTimeout)
  }, [ch, delay])
  // Static halves show the new top and the old bottom; the old top folds down, then the new bottom drops over it.
  return (
    <span aria-hidden="true" className={`flap rounded-lg ${dims}`} style={{ '--flip': `${f.ms}ms` } as CSSProperties}>
      <span className="flap-half flap-top">
        <span>{f.cur}</span>
      </span>
      <span className="flap-half flap-bottom">
        <span>{f.prev}</span>
      </span>
      {f.n > 0 && f.prev !== f.cur && (
        <Fragment key={f.n}>
          <span className="flap-half flap-top flap-fold">
            <span>{f.prev}</span>
          </span>
          <span className={`flap-half flap-bottom flap-unfold${f.last ? ' flap-land' : ''}`}>
            <span>{f.cur}</span>
          </span>
        </Fragment>
      )}
    </span>
  )
}

export function Flap({
  text,
  size = 'lg',
  label,
  delay = 0,
}: {
  text: string
  size?: 'sm' | 'lg'
  label?: string
  /** ms before the first tile flips, to cascade several boards. */
  delay?: number
}) {
  const dims =
    size === 'sm'
      ? 'w-[22px] h-[32px] text-[21px] rounded-[5px] max-[359px]:w-[19px] max-[359px]:h-[28px] max-[359px]:text-[18px] lg:w-[28px] lg:h-[40px] lg:text-[27px] lg:rounded-md'
      : text.length > 3
        ? 'w-[32px] h-[50px] text-[32px] lg:w-[64px] lg:h-[96px] lg:text-[64px] lg:rounded-xl 2xl:w-[80px] 2xl:h-[118px] 2xl:text-[80px]'
        : 'w-[38px] h-[56px] text-[38px] lg:w-[76px] lg:h-[112px] lg:text-[76px] lg:rounded-xl 2xl:w-[92px] 2xl:h-[136px] 2xl:text-[92px]'
  return (
    <span className={`inline-flex ${size === 'sm' ? 'gap-[3px]' : 'gap-1 lg:gap-1.5'}`} role="img" aria-label={label ?? text}>
      {[...text].map((ch, i) => (
        <Tile key={i} ch={ch} delay={120 + delay + i * TILE_STAGGER} dims={dims} />
      ))}
    </span>
  )
}
