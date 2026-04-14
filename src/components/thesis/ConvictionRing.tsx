"use client";

export function ConvictionRing({
  score,
  size = 36,
}: {
  score: number | null | undefined;
  size?: number;
}) {
  // FIX 1: negative → null, treat as unknown
  const raw = score ?? null;
  const s = raw !== null && raw < 0 ? null : raw;
  const r = (size - 6) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const pct = s !== null ? Math.max(0, Math.min(100, s)) / 100 : 0;
  const strokeDash = pct * circumference;

  let strokeColor = "var(--text-faint)"; // null/undefined → gray
  if (s !== null) {
    if (s >= 70) strokeColor = "var(--gold)";
    else if (s >= 40) strokeColor = "var(--signal-warn)";
    else strokeColor = "var(--signal-dn)";
  }

  const fontSize = size <= 36 ? 10 : 13;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="flex-shrink-0"
    >
      {/* Background circle */}
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="var(--border-base)"
        strokeWidth={3}
      />
      {/* Progress arc */}
      {s !== null && (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={3}
          strokeDasharray={`${strokeDash} ${circumference - strokeDash}`}
          strokeDashoffset={circumference * 0.25}
          strokeLinecap="round"
        />
      )}
      {/* Score text — "?" for null/negative */}
      <text
        x={c}
        y={c}
        textAnchor="middle"
        dominantBaseline="central"
        className="font-data"
        fontSize={fontSize}
        fill={strokeColor}
      >
        {s !== null ? Math.round(s) : "?"}
      </text>
    </svg>
  );
}
