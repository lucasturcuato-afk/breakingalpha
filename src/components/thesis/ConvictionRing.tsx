"use client";

interface ConvictionRingProps {
  conviction: string | null;
  size?: number;
}

const CONVICTION_MAP: Record<
  string,
  { fillPct: number; color: string; label: string }
> = {
  HIGH: { fillPct: 1.0, color: "#C9A84C", label: "HIGH" },
  BULLISH: { fillPct: 1.0, color: "#C9A84C", label: "HIGH" },
  MEDIUM: { fillPct: 0.75, color: "#D97706", label: "MED" },
  WATCH: { fillPct: 0.5, color: "#6B7280", label: "WATCH" },
  BEARISH: { fillPct: 0.25, color: "#DC2626", label: "BEAR" },
};

const DEFAULT = { fillPct: 0.2, color: "#4B5563", label: "—" };

export function ConvictionRing({ conviction, size = 36 }: ConvictionRingProps) {
  const cfg = conviction
    ? CONVICTION_MAP[conviction] ?? DEFAULT
    : DEFAULT;

  const { fillPct, color, label: labelText } = cfg;

  const STROKE = 3;
  const R = (size / 2) - STROKE - 2;
  const CIRC = 2 * Math.PI * R;
  const CENTER = size / 2;
  const filled = CIRC * fillPct;
  const empty = CIRC * (1 - fillPct);

  return (
    <div style={{ display: "flex", flexDirection: "column",
                  alignItems: "center", width: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block" }}
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R}
          fill="none"
          stroke="#2D2D2D"
          strokeWidth={STROKE}
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={`${filled} ${empty}`}
          strokeLinecap="round"
          transform={`rotate(-90, ${CENTER}, ${CENTER})`}
        />
      </svg>
      <span style={{
        fontSize: "9px",
        color: color,
        fontFamily: "Inter, sans-serif",
        letterSpacing: "0.05em",
        marginTop: "2px",
        lineHeight: 1,
      }}>
        {labelText}
      </span>
    </div>
  );
}
