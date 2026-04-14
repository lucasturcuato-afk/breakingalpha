'use client'

interface ConvictionRingProps {
  conviction: string | null
  size?: number
  score?: number | null
}

export function ConvictionRing({
  conviction,
  size = 36,
  score,
}: ConvictionRingProps) {
  const normalized = (conviction ?? '').toUpperCase()

  let color = '#9CA3AF'
  let label = '—'

  if (normalized === 'HIGH' || normalized === 'BULLISH') {
    color = '#D4A843'
    label = 'HIGH'
  } else if (normalized === 'MEDIUM') {
    color = '#A89060'
    label = 'MED'
  } else if (normalized === 'WATCH') {
    color = '#9CA3AF'
    label = 'WATCH'
  } else if (normalized === 'BEARISH') {
    color = '#DC2626'
    label = 'BEAR'
  }

  const thickness = Math.max(4, Math.round(size * 0.14))
  const innerSize = size - (thickness * 2)
  const isNull = score === null || score === undefined
  const fillDegrees = isNull ? 0 : Math.round((score / 100) * 360)
  const fontSize = Math.max(9, Math.round(size * 0.3))

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
        background: isNull
          ? 'transparent'
          : `conic-gradient(
              ${color} 0deg ${fillDegrees}deg,
              #3a3530 ${fillDegrees}deg 360deg
            )`,
        border: isNull ? `2px dashed ${color}` : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
      }}>
        <div
          className="conviction-ring-bg"
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontVariantNumeric: 'tabular-nums',
            fontSize: `${fontSize}px`,
            lineHeight: '1',
            color: color,
            userSelect: 'none',
          }}>
            {isNull ? '?' : score}
          </span>
        </div>
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
