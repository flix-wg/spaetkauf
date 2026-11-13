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
  const dims = size === 'lg' ? 'w-[38px] h-[56px] text-[38px]' : 'w-[19px] h-[28px] text-[18px] rounded-[5px]'
  return (
    <span className="inline-flex gap-1" role="img" aria-label={label ?? text}>
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
