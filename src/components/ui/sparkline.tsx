"use client";

interface SparklineProps {
  values: number[];
  w?: number;
  h?: number;
  stroke?: string;
  fill?: string | null;
  strokeWidth?: number;
  className?: string;
  testId?: string;
}

export function Sparkline({ values, w = 120, h = 32, stroke = "var(--gold)", fill = null, strokeWidth = 1.5, className, testId }: SparklineProps) {
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(1, max - min);
  const denom = Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = (i / denom) * (w - 4) + 2;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = `${d} L${w - 2},${h - 2} L2,${h - 2} Z`;
  return (
    <svg width={w} height={h} className={className} data-testid={testId ?? "trend-sparkline"} style={{ display: "block", overflow: "visible" }}>
      {fill && <path d={area} fill={fill} stroke="none" />}
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
