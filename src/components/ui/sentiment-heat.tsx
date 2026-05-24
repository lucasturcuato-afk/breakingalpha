"use client";

interface SentimentHeatProps {
  values: number[];
  w?: number;
  h?: number;
  gap?: number;
  className?: string;
  testId?: string;
}

function colorOf(v: number): string {
  if (v < 0.4) return `rgba(220,38,38,${(0.30 + 0.5 * (1 - v / 0.4)).toFixed(3)})`;
  if (v < 0.55) return "rgba(245,158,11,0.45)";
  return `rgba(22,163,74,${(0.30 + 0.5 * Math.min(1, (v - 0.55) / 0.45)).toFixed(3)})`;
}

export function SentimentHeat({ values, w = 120, h = 12, gap = 2, className, testId }: SentimentHeatProps) {
  const n = Math.max(1, values.length);
  const cw = (w - gap * (n - 1)) / n;
  return (
    <svg width={w} height={h} className={className} data-testid={testId ?? "trend-sentiment-heat"} style={{ display: "block" }}>
      {values.map((v, i) => (
        <rect key={i} x={i * (cw + gap)} y={0} width={cw} height={h} fill={colorOf(v)} rx={2} data-testid="sentiment-heat-cell" />
      ))}
    </svg>
  );
}
