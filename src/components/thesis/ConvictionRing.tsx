'use client'

interface ConvictionRingProps {
  conviction: string | null
  size?: number
}

export function ConvictionRing({
  conviction,
  size = 36
}: ConvictionRingProps) {
  const normalized = (conviction ?? '').toUpperCase()

  let color = '#4B5563'
  let fillPct = 0.2
  let label = '—'

  if (normalized === 'HIGH' || normalized === 'BULLISH') {
    color = '#C9A84C'
    fillPct = 1.0
    label = 'HIGH'
  } else if (normalized === 'MEDIUM') {
    color = '#D97706'
    fillPct = 0.75
    label = 'MED'
  } else if (normalized === 'WATCH') {
    color = '#6B7280'
    fillPct = 0.5
    label = 'WATCH'
  } else if (normalized === 'BEARISH') {
    color = '#DC2626'
    fillPct = 0.25
    label = 'BEAR'
  }

  const stroke = 3
  const r = (size / 2) - stroke - 1
  const circ = +(2 * Math.PI * r).toFixed(4)
  const filled = +(circ * fillPct).toFixed(4)
  const gap = +(circ - filled).toFixed(4)
  const cx = size / 2
  const cy = size / 2

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
        width: size,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* background track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#2D2D2D"
          strokeWidth={stroke}
        />
        {/* filled arc — starts at 12 o'clock via rotate */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${gap}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <span
        style={{
          fontSize: '9px',
          fontFamily: 'Inter, sans-serif',
          color: color,
          letterSpacing: '0.04em',
          lineHeight: '1',
          userSelect: 'none',
        }}
      >
        {label}
      </span>
    </div>
  )
}

export default ConvictionRing
