'use client'

// ConvictionRing — label-only conviction indicator.
// Hard Constraint #11: no numeric score inside the ring. The conviction TEXT
// enum (HIGH / MEDIUM / WATCH / BEARISH / BULLISH) is the only source of
// truth surfaced in this component.

interface ConvictionRingProps {
  conviction: string | null
  size?: number
}

export function ConvictionRing({
  conviction,
  size = 36,
}: ConvictionRingProps) {
  const normalized = (conviction ?? '').toUpperCase()

  let color = 'var(--text-faint)'
  let label = '—'

  if (normalized === 'HIGH' || normalized === 'BULLISH') {
    color = 'var(--gold)'
    label = 'HIGH'
  } else if (normalized === 'MEDIUM') {
    color = 'var(--gold-dark)'
    label = 'MED'
  } else if (normalized === 'WATCH') {
    color = 'var(--text-muted)'
    label = 'WATCH'
  } else if (normalized === 'BEARISH') {
    color = 'var(--signal-dn)'
    label = 'BEAR'
  }

  const thickness = Math.max(2, Math.round(size * 0.1))
  const innerSize = size - thickness * 2
  const fontSize = Math.max(8, Math.round(size * 0.26))

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
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: `${thickness}px solid ${color}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
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
          <span
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: `${fontSize}px`,
              fontWeight: 700,
              letterSpacing: '0.04em',
              lineHeight: '1',
              color,
              userSelect: 'none',
            }}
          >
            {label}
          </span>
        </div>
      </div>
    </div>
  )
}

export default ConvictionRing
