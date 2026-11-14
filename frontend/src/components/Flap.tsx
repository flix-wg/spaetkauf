import { Fragment, useEffect, useState, type CSSProperties } from 'react'

// The cards in drum order: a change flips through every card in between, like a station board.
const DRUM = ' +−0123456789'
const FLIP_MS = 90

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const nextCard = (cur: string, target: string) => {
  const i = DRUM.indexOf(cur)
  return i < 0 || !DRUM.includes(target) ? target : DRUM[(i + 1) % DRUM.length]
}

function Tile({ ch, delay, dims }: { ch: string; delay: number; dims: string }) {
  const [cur, setCur] = useState(() => (still() ? ch : ' '))
  const [prev, setPrev] = useState(cur)
  const [flips, setFlips] = useState(0)
  useEffect(() => {
    if (cur === ch) {
      // Settle the static bottom too, so a paused animation (background tab) never leaves a split card.
      const t = setTimeout(() => setPrev(cur), FLIP_MS)
      return () => clearTimeout(t)
    }
    if (still()) {
      setPrev(ch)
      setCur(ch)
      return
    }
    const t = setTimeout(
      () => {
        setPrev(cur)
        setCur(nextCard(cur, ch))
        setFlips((n) => n + 1)
      },
      flips ? FLIP_MS : delay,
    )
    return () => clearTimeout(t)
  }, [cur, ch, delay, flips])
  // Static halves show the new top and the old bottom; the old top folds down, then the new bottom drops over it.
  return (
    <span aria-hidden="true" className={`flap rounded-lg ${dims}`} style={{ '--flip': `${FLIP_MS}ms` } as CSSProperties}>
      <span className="flap-half flap-top">
        <span>{cur}</span>
      </span>
      <span className="flap-half flap-bottom">
        <span>{prev}</span>
      </span>
      {flips > 0 && (
        <Fragment key={flips}>
          <span className="flap-half flap-top flap-fold">
            <span>{prev}</span>
          </span>
          <span className="flap-half flap-bottom flap-unfold">
            <span>{cur}</span>
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
}: {
  text: string
  size?: 'sm' | 'lg'
  label?: string
}) {
  const dims =
    size === 'sm'
      ? 'w-[22px] h-[32px] text-[21px] rounded-[5px] lg:w-[28px] lg:h-[40px] lg:text-[27px] lg:rounded-md'
      : text.length > 3
        ? 'w-[32px] h-[50px] text-[32px] lg:w-[64px] lg:h-[96px] lg:text-[64px] lg:rounded-xl 2xl:w-[80px] 2xl:h-[118px] 2xl:text-[80px]'
        : 'w-[38px] h-[56px] text-[38px] lg:w-[76px] lg:h-[112px] lg:text-[76px] lg:rounded-xl 2xl:w-[92px] 2xl:h-[136px] 2xl:text-[92px]'
  return (
    <span className={`inline-flex ${size === 'sm' ? 'gap-[3px]' : 'gap-1 lg:gap-1.5'}`} role="img" aria-label={label ?? text}>
      {[...text].map((ch, i) => (
        <Tile key={i} ch={ch} delay={i * 70} dims={dims} />
      ))}
    </span>
  )
}
