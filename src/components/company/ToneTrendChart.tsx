"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ToneTrendPoint, ToneTrendResponse } from "@/app/api/company-trend/route";

// Tone-over-time chart for the company detail page. Talks to /api/company-trend,
// which aggregates daily tone from company_mentions using the SAME per-mention
// scoring as the headline tone level (src/lib/tone.ts), so the chart and the level
// agree by construction.
//
// Pure-SVG line over a fixed -1..+1 tone axis with an explicit, labeled NEUTRAL
// baseline drawn at 0, so "improving/deteriorating" reads as the line's slope away
// from neutral. Markers sit on every data point so a sparse 2-point series is not
// mistaken for rich history (most companies are sparse: median 1 day in 30).
// Conventions (pure SVG, gold-muted range strip, render-phase request key) mirror
// CompanyStockChart so Price and Tone feel like peers; they remain stacked.

type RangeKey = "7d" | "30d" | "90d";

interface RangeDef {
  key: RangeKey;
  label: string;
}

const RANGES: RangeDef[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
];

interface ToneTrendChartProps {
  company: string;
  compact?: boolean;
  defaultRange?: RangeKey;
}

type FetchState =
  | { status: "loading" }
  | { status: "ready"; data: ToneTrendResponse }
  | { status: "error" };

interface Geom {
  view: { w: number; h: number };
  padL: number;
  plotW: number;
  plotH: number;
  padT: number;
  yFor: (score: number) => number;
  xFor: (dateMs: number) => number;
  neutralY: number;
  linePath: string | null;
  pts: Array<{ x: number; y: number; p: ToneTrendPoint }>;
}

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function formatDay(date: string): string {
  // date is "YYYY-MM-DD" (UTC); render as "May 28" without TZ drift.
  const d = new Date(date + "T12:00:00Z");
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

function formatSignedScore(v: number): string {
  return (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(2);
}

export function ToneTrendChart({ company, compact = false, defaultRange = "30d" }: ToneTrendChartProps) {
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Render-phase request key (same pattern as CompanyStockChart): drop to the
  // skeleton immediately on company/range change without an effect-driven setState.
  const requestKey = `${company}::${range}`;
  const [activeKey, setActiveKey] = useState(requestKey);
  if (activeKey !== requestKey) {
    setActiveKey(requestKey);
    if (hover !== null) setHover(null);
    if (fetchState.status !== "loading") setFetchState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;
    const url = `/api/company-trend?company=${encodeURIComponent(company)}&range=${range}`;
    const attempt = () =>
      fetch(url, { signal: AbortSignal.timeout(15000) }).then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return (await r.json()) as ToneTrendResponse;
      });

    // One retry with a small backoff covers a slow first response (a cold start,
    // the dev first-compile, or a slow query under load) instead of flashing
    // "unavailable". If it still fails after the retry, the error state is the
    // final fallback and the server-rendered headline tone level is unaffected.
    (async () => {
      try {
        const body = await attempt();
        if (!cancelled) setFetchState({ status: "ready", data: body });
      } catch {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 600));
        if (cancelled) return;
        try {
          const body = await attempt();
          if (!cancelled) setFetchState({ status: "ready", data: body });
        } catch {
          if (!cancelled) setFetchState({ status: "error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [company, range]);

  const data = fetchState.status === "ready" ? fetchState.data : null;

  const geom: Geom = useMemo(() => {
    const w = compact ? 300 : 720;
    const h = compact ? 96 : 184;
    const padL = compact ? 10 : 30;
    const padR = compact ? 10 : 12;
    const padT = compact ? 10 : 14;
    const padB = compact ? 12 : 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    // Fixed tone axis: +1 (bullish) at top, 0 (neutral) centered, -1 (bearish) at bottom.
    const yFor = (score: number) => padT + (1 - (clamp(score, -1, 1) + 1) / 2) * plotH;
    const neutralY = yFor(0);

    // Right edge is rangeStart + range days (deterministic, no Date.now in
    // render): since rangeStart = now - range days, this is "now" by construction.
    const startMs = data ? Date.parse(data.rangeStart) : 0;
    const windowDays = data ? RANGE_DAYS[data.range] ?? 30 : 30;
    const span = windowDays * DAY_MS;
    const xFor = (dateMs: number) => padL + (clamp(dateMs - startMs, 0, span) / span) * plotW;

    const pts = (data?.points ?? []).map((p) => {
      const dateMs = Date.parse(p.date + "T12:00:00Z");
      return { x: xFor(dateMs), y: yFor(p.score), p };
    });
    const linePath =
      pts.length >= 2
        ? pts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ")
        : null;

    return { view: { w, h }, padL, plotW, plotH, padT, yFor, xFor, neutralY, linePath, pts };
  }, [data, compact]);

  const loading = fetchState.status === "loading";
  const error = fetchState.status === "error";
  const points = data?.points ?? [];
  const latest = points.length > 0 ? points[points.length - 1].score : 0;
  const lineColor = latest >= 0 ? "var(--signal-up)" : "var(--signal-dn)";
  const hovered = hover !== null ? geom.pts[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (geom.pts.length === 0 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xInView = ((e.clientX - rect.left) / rect.width) * geom.view.w;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < geom.pts.length; i++) {
      const d = Math.abs(geom.pts[i].x - xInView);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best);
  };

  return (
    <div data-testid="tone-trend-chart" className="w-full">
      {/* Header: hovered readout (left) + range strip (right). Compact hides both. */}
      {!compact && (
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <div className="min-w-0">
            {hovered ? (
              <span className="font-data text-[11px] text-text-secondary">
                {formatDay(hovered.p.date)} ·{" "}
                <span style={{ color: hovered.p.score >= 0 ? "var(--signal-up)" : "var(--signal-dn)" }}>
                  {formatSignedScore(hovered.p.score)}
                </span>{" "}
                · {hovered.p.n} {hovered.p.n === 1 ? "article" : "articles"}
              </span>
            ) : (
              <span className="font-sans text-[10px] text-text-muted">
                Tone over time
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {RANGES.map((r) => {
              const active = r.key === range;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRange(r.key)}
                  className={
                    "font-sans text-[10px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer " +
                    (active
                      ? "bg-gold-muted text-gold border border-gold-border"
                      : "text-text-secondary hover:bg-parchment-mid border border-transparent")
                  }
                  aria-pressed={active}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div
          className="rounded-md animate-pulse bg-parchment-mid"
          style={{ width: "100%", height: geom.view.h }}
          aria-label="Loading tone chart"
        />
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${geom.view.w} ${geom.view.h}`}
          preserveAspectRatio="none"
          width="100%"
          height={geom.view.h}
          role="img"
          aria-label={`Tone over time for ${company}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          style={{ display: "block", touchAction: "none" }}
        >
          {/* Bullish / Bearish edge labels (full chart only) */}
          {!compact && (
            <>
              <text x={2} y={geom.yFor(1) + 3} style={{ fontSize: 8, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}>
                +1
              </text>
              <text x={2} y={geom.yFor(-1) + 1} style={{ fontSize: 8, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}>
                -1
              </text>
            </>
          )}

          {/* Neutral baseline at 0, drawn and labeled */}
          <line
            x1={geom.padL}
            x2={geom.view.w - (compact ? 10 : 12)}
            y1={geom.neutralY}
            y2={geom.neutralY}
            stroke="var(--border-base)"
            strokeWidth="1"
            strokeDasharray="3,3"
            vectorEffect="non-scaling-stroke"
          />
          {!compact && (
            <text
              x={geom.padL + 2}
              y={geom.neutralY - 3}
              style={{ fontSize: 8.5, fontFamily: "var(--font-mono)", letterSpacing: "0.05em", fill: "var(--text-muted)" }}
            >
              NEUTRAL
            </text>
          )}

          {/* Line (only when 2+ points) */}
          {geom.linePath && (
            <path
              d={geom.linePath}
              fill="none"
              stroke={lineColor}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Markers on every data point */}
          {geom.pts.map((pt, i) => (
            <circle
              key={i}
              cx={pt.x}
              cy={pt.y}
              r={compact ? 1.8 : 2.5}
              fill={pt.p.score >= 0 ? "var(--signal-up)" : "var(--signal-dn)"}
              stroke="var(--cream)"
              strokeWidth={compact ? 0.5 : 1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Hover crosshair */}
          {hovered && (
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={geom.padT}
              y2={geom.padT + geom.plotH}
              stroke="var(--text-muted)"
              strokeWidth="1"
              strokeDasharray="2,2"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Empty / error message inside the plot */}
          {(error || points.length === 0) && (
            <text
              x={geom.view.w / 2}
              y={geom.neutralY - 6}
              textAnchor="middle"
              style={{ fontSize: compact ? 9 : 11, fontFamily: "var(--font-sans)", fill: "var(--text-muted)" }}
            >
              {error ? "Tone chart unavailable" : "No tone history in this range"}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}
