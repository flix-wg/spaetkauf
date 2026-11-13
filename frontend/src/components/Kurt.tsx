export function Kurt({
  width = 80,
  shell = '#FD4F00',
  body = '#14161A',
  className,
}: {
  width?: number
  shell?: string
  body?: string
  className?: string
}) {
  return (
    <svg width={width} height={(width * 60) / 80} viewBox="0 0 80 60" aria-hidden="true" className={className}>
      <rect x="4" y="44" width="68" height="10" rx="5" fill={body} />
      <path d="M11 46 C9 37 11 29 17 25" stroke={body} strokeWidth="6" strokeLinecap="round" fill="none" />
      <line x1="16" y1="25" x2="10" y2="11" stroke={body} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="19" y1="25" x2="23" y2="10" stroke={body} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="10" cy="10" r="3.2" fill={body} />
      <circle cx="23" cy="9" r="3.2" fill={body} />
      <circle cx="47" cy="27" r="19" fill={shell} stroke={body} strokeWidth="2.5" />
      <path
        d="M44 27 a3 3 0 1 1 6 0 a6 6 0 1 1 -12 0 a9 9 0 1 1 18 0 a12 12 0 1 1 -24 0"
        stroke={body}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Snails({ p20 }: { p20: number }) {
  const share = p20 <= 1 ? p20 : p20 / 100
  const filled = Math.min(5, Math.ceil(share * 5))
  return (
    <span className="flex gap-px" role="img" aria-label={`${filled} of 5 snails`}>
      {[0, 1, 2, 3, 4].map((i) =>
        i < filled ? (
          <Kurt key={i} width={18} />
        ) : (
          <Kurt key={i} width={18} shell="#FFFFFF" body="#C9CDD4" />
        ),
      )}
    </span>
  )
}
