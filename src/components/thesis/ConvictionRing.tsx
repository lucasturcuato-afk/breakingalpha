"use client";

interface ConvictionRingProps {
  conviction: string | null;
  size?: number;
}

const CONVICTION_MAP: Record<
  string,
  { fillPct: number; color: string; label: string; tooltip: string }
> = {
  HIGH: {
    fillPct: 1.0,
    color: "#C9A84C",
    label: "HIGH",
    tooltip: "HIGH conviction — strong signal detected",
  },
  BULLISH: {
    fillPct: 1.0,
    color: "#C9A84C",
    label: "HIGH",
    tooltip: "HIGH conviction — strong signal detected",
  },
  MEDIUM: {
    fillPct: 0.75,
    color: "#D97706",
    label: "MED",
    tooltip: "MEDIUM conviction — moderate signal",
  },
  WATCH: {
    fillPct: 0.5,
    color: "#6B7280",
    label: "WATCH",
    tooltip: "WATCH — monitoring for confirmation",
  },
  BEARISH: {
    fillPct: 0.25,
    color: "#DC2626",
    label: "BEAR",
    tooltip: "BEARISH conviction — negative signal",
  },
};

const DEFAULT_CONVICTION = {
  fillPct: 0.2,
  color: "#4B5563",
  label: "—",
  tooltip: "Conviction not set",
};

export function ConvictionRing({ conviction, size = 36 }: ConvictionRingProps) {
  const cfg = conviction
    ? CONVICTION_MAP[conviction] ?? DEFAULT_CONVICTION
    : DEFAULT_CONVICTION;

  const SIZE = size;
  const STROKE = 3;
  const R = SIZE / 2 - STROKE - 1;
  const CIRCUMFERENCE = 2 * Math.PI * R;
  const CENTER = SIZE / 2;

  return (
    <div title={cfg.tooltip} className="flex flex-col items-center flex-shrink-0">
      <svg width={SIZE} height={SIZE + 14}>
        {/* Background track */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R}
          fill="none"
          stroke="#2D2D2D"
          strokeWidth={STROKE}
        />
        {/* Conviction arc */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R}
          fill="none"
          stroke={cfg.color}
          strokeWidth={STROKE}
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={CIRCUMFERENCE - (cfg.fillPct * CIRCUMFERENCE)}
          strokeLinecap="round"
          style={{ transform: "rotate(-90deg)", transformOrigin: `${CENTER}px ${CENTER}px` }}
        />
        {/* Label below */}
        <text
          x={CENTER}
          y={SIZE + 10}
          textAnchor="middle"
          fontSize="9"
          fill={cfg.color}
          fontFamily="Inter, sans-serif"
          letterSpacing="0.05em"
        >
          {cfg.label}
        </text>
      </svg>
    </div>
  );
}
