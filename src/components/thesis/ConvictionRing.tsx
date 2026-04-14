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
  let label = '—'

  if (normalized === 'HIGH' || normalized === 'BULLISH') {
    color = '#C9A84C'
    label = 'HIGH'
  } else if (normalized === 'MEDIUM') {
    color = '#D97706'
    label = 'MED'
  } else if (normalized === 'WATCH') {
    color = '#6B7280'
    label = 'WATCH'
  } else if (normalized === 'BEARISH') {
    color = '#DC2626'
    label = 'BEAR'
  }

  const borderSize = Math.max(3, Math.round(size * 0.1))

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
        border: `${borderSize}px solid ${color}`,
        flexShrink: 0,
        boxSizing: 'border-box',
      }} />
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
