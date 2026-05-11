"use client";

interface DeltaProps {
  value: number;
  size?: number;
  mono?: boolean;
  className?: string;
  testId?: string;
}

export function Delta({ value, size = 11, mono = true, className, testId }: DeltaProps) {
  const up = value >= 0;
  const dir = value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
  return (
    <span
      className={className}
      data-testid={testId ?? `delta-${dir}`}
      style={{
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: size,
        fontWeight: 600,
        color: up ? "var(--signal-up)" : "var(--signal-dn)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(2)}%
    </span>
  );
}
