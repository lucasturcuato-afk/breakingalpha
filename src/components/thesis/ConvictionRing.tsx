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

  const degrees = Math.round(fillPct * 360)
  const thickness = Math.max(4, Math.round(size * 0.14))
  const innerSize = size - (thickness * 2)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '3px',
      width: size,
    }}>
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `conic-gradient(
          ${color} 0deg ${degrees}deg,
          #3a3530 ${degrees}deg 360deg
        )`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <div
          className="conviction-ring-bg"
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: '50%',
          }}
        />
      </div>
      <span style={{
        fontSize: '9px',
        fontFamily: 'Inter, sans-serif',
        color: color,
        letterSpacing: '0.04em',
        lineHeight: '1',
        userSelect: 'none',
      }}>
        {label}
      </span>
    </div>
  )
}

export default ConvictionRing
