"use client";

/**
 * DrawSpark — the re-skin's shared draw-in sparkline. The stroke reveals left
 * to right via stroke-dash (.dash-fspark-path, reduced-motion gated in CSS)
 * and the endpoint dot fades in after. Path length is summed so the reveal is
 * exact. Colors default to the light-surface signal tokens; dark surfaces
 * (the ember hero) pass their own pair.
 */
export function DrawSpark({
  closes,
  up,
  w = 64,
  h = 26,
  upColor = "var(--signal-up)",
  dnColor = "var(--signal-dn)",
}: {
  closes: number[];
  up: boolean;
  w?: number;
  h?: number;
  upColor?: string;
  dnColor?: string;
}) {
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = Math.max(1e-6, max - min);
  const denom = Math.max(1, closes.length - 1);
  const pts = closes.map((v, i) => {
    const x = (i / denom) * (w - 4) + 2;
    const y = h - 3 - ((v - min) / span) * (h - 6);
    return [x, y] as const;
  });
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  const color = up ? upColor : dnColor;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
      <path
        className="dash-fspark-path"
        style={{ "--spark-len": Math.ceil(len + 1) } as React.CSSProperties}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="dash-fspark-dot" cx={last[0]} cy={last[1]} r={2.2} fill={color} />
    </svg>
  );
}

interface ChartResponse {
  points?: { t: number; c: number }[];
}

/**
 * 1mo close series for a ticker from /api/stock-chart. Day change should come
 * from watchlist-quotes, not this chart's meta (chartPreviousClose anchors to
 * the window start and would report a monthly return as a day move).
 */
export async function loadCloses(ticker: string): Promise<number[] | null> {
  try {
    const res = await fetch(`/api/stock-chart?ticker=${encodeURIComponent(ticker)}&range=1mo`);
    if (!res.ok) return null;
    const data: ChartResponse = await res.json();
    const closes = (data.points ?? []).map((p) => p.c).filter((c) => Number.isFinite(c));
    return closes.length >= 2 ? closes : null;
  } catch {
    return null;
  }
}
