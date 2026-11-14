const KURT = {
  foot: 'M14 54 C8 54 4.5 51.5 4.5 47 L4.5 33 C4.5 24 19 24 19 33 L19 40 C19 43.5 21 45 24 45 L64 45 C70 45 74 47 77 52.5 C75.5 53.5 73.5 54 70 54 Z',
  stalks: 'M9 26 L7.2 14.5 M15 26 L21.5 13.5',
  mouth: 'M7.5 33.5 q2.4 2.4 5 0.6',
  spiral: 'M47.5 28 a2.3 2.3 0 0 0 -4.6 0 a4.6 4.6 0 0 0 9.2 0 a6.9 6.9 0 0 0 -13.8 0 a9.2 9.2 0 0 0 18.4 0 a11.5 11.5 0 0 0 -23 0',
  // Below about 30 px the fine spiral blurs, so small Kurts get fewer, bolder turns.
  spiralSmall: 'M47 28 a3.4 3.4 0 0 0 -6.8 0 a6.8 6.8 0 0 0 13.6 0 a10.2 10.2 0 0 0 -20.4 0',
  shine: 'M33.5 15.5 a16 16 0 0 1 9 -4.6',
}

export function Kurt({
  width = 80,
  shell = '#FD4F00',
  body = '#14161A',
  motion,
  className,
}: {
  width?: number
  shell?: string
  body?: string
  motion?: 'crawl' | 'blink'
  className?: string
}) {
  const small = width < 30
  const glint = body.toUpperCase() === '#FFFFFF' ? shell : '#FFFFFF'
  const line = small ? 4 : 2.6
  return (
    <svg
      width={width}
      height={(width * 60) / 80}
      viewBox="0 0 80 60"
      aria-hidden="true"
      className={['kurt', motion && `kurt-${motion}`, className].filter(Boolean).join(' ')}
    >
      <path className="kurt-body" d={KURT.foot} fill={body} />
      <g className="kurt-head">
        <path d={KURT.stalks} stroke={body} strokeWidth={small ? 3.4 : 2.6} strokeLinecap="round" />
        <g className="kurt-eye">
          <circle cx="7.2" cy="10.5" r={small ? 4 : 4.4} fill={body} />
          {!small && <circle cx="6" cy="9.2" r="1.4" fill={glint} />}
        </g>
        <g className="kurt-eye">
          <circle cx="21.5" cy="9.5" r={small ? 4 : 4.4} fill={body} />
          {!small && <circle cx="20.3" cy="8.2" r="1.4" fill={glint} />}
        </g>
        {!small && <path d={KURT.mouth} stroke={glint} strokeWidth="1.8" fill="none" strokeLinecap="round" />}
      </g>
      <g className="kurt-shell">
        <circle cx="46" cy="27" r="19" fill={shell} stroke={body} strokeWidth={line} />
        <path
          className="kurt-spiral"
          d={small ? KURT.spiralSmall : KURT.spiral}
          stroke={body}
          strokeWidth={line}
          fill="none"
          strokeLinecap="round"
        />
        {!small && <path d={KURT.shine} stroke="#FFFFFF" strokeOpacity=".55" strokeWidth="2.4" fill="none" strokeLinecap="round" />}
      </g>
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
