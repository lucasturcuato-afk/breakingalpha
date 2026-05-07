"use client";

interface MiniBarsProps {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
  gap?: number;
  className?: string;
  testId?: string;
}

export function MiniBars({ values, w = 120, h = 28, color = "var(--gold)", gap = 2, className, testId }: MiniBarsProps) {
  const max = values.length ? Math.max(...values, 1) : 1;
  const n = Math.max(1, values.length);
  const bw = (w - gap * (n - 1)) / n;
  return (
    <svg width={w} height={h} className={className} data-testid={testId ?? "trend-minibars"} style={{ display: "block" }}>
      {values.map((v, i) => {
        const bh = (v / max) * (h - 2);
        return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} fill={color} rx={1} />;
      })}
    </svg>
  );
}
