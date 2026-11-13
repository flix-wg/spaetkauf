import { useEffect, useState } from 'react'

export function Flap({
  text,
  size = 'lg',
  label,
}: {
  text: string
  size?: 'sm' | 'lg'
  label?: string
}) {
  const [flipKey, setFlipKey] = useState(0)
  useEffect(() => setFlipKey((k) => k + 1), [text])
  const dims =
    size === 'sm'
      ? 'w-[19px] h-[28px] text-[18px] rounded-[5px] lg:w-[24px] lg:h-[36px] lg:text-[23px]'
      : text.length > 3
        ? 'w-[32px] h-[50px] text-[32px] lg:w-[64px] lg:h-[96px] lg:text-[64px] lg:rounded-xl 2xl:w-[80px] 2xl:h-[118px] 2xl:text-[80px]'
        : 'w-[38px] h-[56px] text-[38px] lg:w-[76px] lg:h-[112px] lg:text-[76px] lg:rounded-xl 2xl:w-[92px] 2xl:h-[136px] 2xl:text-[92px]'
  return (
    <span className="inline-flex gap-1 lg:gap-1.5" role="img" aria-label={label ?? text}>
      {[...text].map((ch, i) => (
        <span
          key={`${i}-${flipKey}-${ch}`}
          aria-hidden="true"
          className={`flap-in relative inline-flex items-center justify-center rounded-lg bg-ink font-mono font-bold leading-none text-white ${dims}`}
        >
          {ch}
          <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/25" />
        </span>
      ))}
    </span>
  )
}
