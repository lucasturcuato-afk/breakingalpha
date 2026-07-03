"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Stock chart for the company detail page. Talks to /api/stock-chart, which
// proxies Yahoo Finance v8 chart (the same data source already used by
// /api/market-indices and /api/watchlist-quotes). No new env vars.
//
// Pure-SVG line + area fill. Recharts is intentionally not pulled in; the
// brand-aligned visual is small enough that adding a chart library would be
// dead weight. The component is keyboard-friendly (range buttons are real
// buttons) and degrades gracefully when Yahoo blanks the ticker (private
// companies, recent IPOs, foreign exchanges with rare suffixes).

type RangeKey = "1d" | "5d" | "1mo" | "3mo" | "1y" | "5y";

interface RangeDef {
  key: RangeKey;
  label: string;
}

const RANGES: RangeDef[] = [
  { key: "1d", label: "1D" },
  { key: "5d", label: "5D" },
  { key: "1mo", label: "1M" },
  { key: "3mo", label: "3M" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
];

// Default range on first paint. Also the only range we auto-retry away from
// when it comes back empty (see the fetch handler): a stock listed hours ago
// has no daily history, so 3mo/1y/5y are blank but 1d (5-minute candles) has
// data. Auto-falling-back to 1d keeps a brand-new listing from rendering a
// dead "unavailable" panel on load.
const DEFAULT_RANGE: RangeKey = "3mo";

interface ChartPoint {
  t: number;
  c: number;
}

interface ChartResponse {
  ticker: string;
  range: string;
  interval: string;
  points: ChartPoint[];
  price: number | null;
  prevClose: number | null;
  currency: string | null;
}

interface CompanyStockChartProps {
  ticker: string;
  companyName: string;
}

interface HoverState {
  index: number;
  x: number;
  y: number;
}

type FetchState =
  | { status: "loading" }
  | { status: "ready"; data: ChartResponse }
  // <2 plottable points. hasQuote distinguishes a newly-listed company (Yahoo
  // returned a live regularMarketPrice but no usable series yet) from a true
  // failure (bad ticker, upstream error), so the UI can say "newly listed,
  // limited history" instead of the generic "unavailable" string.
  | { status: "empty"; hasQuote: boolean };

// Chart geometry. Width is responsive via SVG viewBox; height stays fixed so
// the surface lands at a predictable spot above the article list.
const VIEW_W = 720;
const VIEW_H = 200;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 16;
const PAD_B = 24;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;

function formatPrice(v: number | null, currency: string | null): string {
  if (v == null || !Number.isFinite(v)) return "--";
  const symbol = currency === "USD" || currency == null ? "$" : "";
  if (v >= 1000) {
    return `${symbol}${v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (v >= 1) return `${symbol}${v.toFixed(2)}`;
  return `${symbol}${v.toFixed(4)}`;
}

function formatPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function formatDate(unixSec: number, range: RangeKey): string {
  const d = new Date(unixSec * 1000);
  const opts: Intl.DateTimeFormatOptions =
    range === "1d"
      ? { hour: "numeric", minute: "2-digit", hour12: true }
      : range === "5d"
        ? { month: "short", day: "numeric", hour: "numeric", hour12: true }
        : range === "5y"
          ? { month: "short", year: "numeric" }
          : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat("en-US", opts).format(d);
}

export function CompanyStockChart({ ticker, companyName }: CompanyStockChartProps) {
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });
  const [hover, setHover] = useState<HoverState | null>(null);
  // Ranges this ticker has returned <2 points for, so their toggles can be
  // greyed/disabled rather than flashing the error panel when clicked.
  const [emptyRanges, setEmptyRanges] = useState<RangeKey[]>([]);
  // One-shot guard so the default-range auto-fallback to 1d fires at most once
  // per ticker (no fallback ping-pong if 1d is also empty).
  const [autoRetried, setAutoRetried] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Reset ticker-scoped state when the company changes (component is reused
  // across tickers). React 19 permits this derived-from-props setState during
  // render; it self-heals on the immediate re-render.
  const [activeTicker, setActiveTicker] = useState(ticker);
  if (activeTicker !== ticker) {
    setActiveTicker(ticker);
    setEmptyRanges([]);
    setAutoRetried(false);
  }

  // Track the request key directly in state. When ticker or range changes
  // the component sets state during render (allowed by React 19) so the
  // chart immediately drops back to the loading skeleton without waiting a
  // commit, and so the lint rules against effect-driven setState and
  // mutating refs in render both pass.
  const requestKey = `${ticker}::${range}`;
  const [activeKey, setActiveKey] = useState(requestKey);
  if (activeKey !== requestKey) {
    setActiveKey(requestKey);
    if (hover !== null) setHover(null);
    if (fetchState.status !== "loading") setFetchState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/stock-chart?ticker=${encodeURIComponent(ticker)}&range=${range}`, {
      signal: AbortSignal.timeout(8000),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return (await r.json()) as ChartResponse;
      })
      .then((body) => {
        if (cancelled) return;
        if (!body.points || body.points.length < 2) {
          // hasQuote: Yahoo gave us a live price but no plottable series. That
          // is the signature of a brand-new listing, not a broken ticker.
          const hasQuote = typeof body.price === "number" && Number.isFinite(body.price);
          setEmptyRanges((prev) => (prev.includes(range) ? prev : [...prev, range]));
          // Auto-fallback: a hours-old listing has no daily history, so the
          // default 3mo is empty while 1d (intraday) has data. Switch once.
          if (range === DEFAULT_RANGE && !autoRetried) {
            setAutoRetried(true);
            setRange("1d");
            return;
          }
          setFetchState({ status: "empty", hasQuote });
        } else {
          setFetchState({ status: "ready", data: body });
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Network/timeout/upstream failure: no quote to show, generic message.
        setFetchState({ status: "empty", hasQuote: false });
      });

    return () => {
      cancelled = true;
    };
  }, [ticker, range, autoRetried]);

  const loading = fetchState.status === "loading";
  const empty = fetchState.status === "empty";
  const newlyListed = fetchState.status === "empty" && fetchState.hasQuote;
  const unavailableMsg = newlyListed
    ? "Newly listed, limited history"
    : `Stock data unavailable for ${companyName}`;
  const data = fetchState.status === "ready" ? fetchState.data : null;

  // Geometry derived once per data change. Memo prevents expensive recompute
  // on every hover frame.
  const geometry = useMemo(() => {
    if (!data || data.points.length < 2) return null;
    const points = data.points;
    const closes = points.map((p) => p.c);
    const minC = Math.min(...closes);
    const maxC = Math.max(...closes);
    const span = maxC - minC || 1;
    const tFirst = points[0].t;
    const tLast = points[points.length - 1].t;
    const tSpan = tLast - tFirst || 1;

    const xy = points.map((p) => {
      const x = PAD_L + ((p.t - tFirst) / tSpan) * PLOT_W;
      const y = PAD_T + (1 - (p.c - minC) / span) * PLOT_H;
      return { x, y };
    });

    const linePath = xy
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
      .join(" ");

    const lastX = xy[xy.length - 1].x;
    const firstX = xy[0].x;
    const baselineY = PAD_T + PLOT_H;
    const areaPath =
      `${linePath} L${lastX.toFixed(2)},${baselineY.toFixed(2)} ` +
      `L${firstX.toFixed(2)},${baselineY.toFixed(2)} Z`;

    const startClose = points[0].c;
    const endClose = points[points.length - 1].c;

    // Range-aware percent anchor. The 1D convention used by Google,
    // Yahoo, and every broker is "change since previous close" (i.e.
    // yesterday's close, exposed by Yahoo as chartPreviousClose and
    // surfaced by /api/stock-chart as data.prevClose). Anchoring to
    // points[0] for 1D would compare against the first 5-minute candle
    // of today's session, which is usually the highest-volatility
    // moment of the day and produces a number that looks wildly off
    // vs every other source.
    //
    // For 5D / 1M / 3M / 1Y / 5Y the conventional return IS the
    // window-anchored "change since first point in range," so
    // startClose is correct.
    const anchor =
      range === "1d" && typeof data.prevClose === "number" && data.prevClose > 0
        ? data.prevClose
        : startClose;
    const pct = anchor > 0 ? ((endClose - anchor) / anchor) * 100 : 0;

    return { xy, linePath, areaPath, startClose, endClose, anchor, pct, minC, maxC };
  }, [data, range]);

  const isUp = (geometry?.pct ?? 0) >= 0;
  const stroke = isUp ? "var(--signal-up)" : "var(--signal-dn)";

  // Map cursor x to nearest data index. Hover is throttled implicitly by
  // React batching; for smoother UX on large 5y series this is good enough.
  const handleMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!geometry || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const xInView = ratio * VIEW_W;
      // Binary search for nearest x.
      let lo = 0;
      let hi = geometry.xy.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (geometry.xy[mid].x < xInView) lo = mid + 1;
        else hi = mid;
      }
      // Compare lo with lo-1 to pick the closer one.
      let idx = lo;
      if (lo > 0) {
        const prev = geometry.xy[lo - 1];
        const cur = geometry.xy[lo];
        if (Math.abs(prev.x - xInView) < Math.abs(cur.x - xInView)) idx = lo - 1;
      }
      const pt = geometry.xy[idx];
      setHover({ index: idx, x: pt.x, y: pt.y });
    },
    [geometry],
  );

  const handleLeave = useCallback(() => setHover(null), []);

  // Header price/pct: prefer hovered point when available, otherwise prefer
  // Yahoo's regularMarketPrice (data.price) which is typically slightly
  // fresher than the last 5-minute bucket in the chart series. Falls
  // back to the last series point if Yahoo didn't return a meta price.
  const hoveredPoint = hover && data ? data.points[hover.index] : null;
  const headerPrice = hoveredPoint
    ? hoveredPoint.c
    : (data?.price ?? geometry?.endClose ?? null);
  // Range-aware hover percent: same anchor as the headline so hovering
  // does not silently switch to a different convention. For 1D this
  // means the hover percent is "vs prevClose"; for other ranges it is
  // "vs first point in range."
  const headerPct =
    hoveredPoint && geometry && geometry.anchor > 0
      ? ((hoveredPoint.c - geometry.anchor) / geometry.anchor) * 100
      : geometry?.pct ?? 0;
  const headerDate = hoveredPoint ? formatDate(hoveredPoint.t, range) : null;

  return (
    <section className="bg-white border border-border-base rounded-xl p-4">
      {/* Header band: ticker + price + pct */}
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-sans text-[10px] text-text-muted font-semibold">
            {ticker}
          </span>
          {loading ? (
            <span className="font-display text-[18px] font-bold text-text-muted">
              Loading...
            </span>
          ) : empty || !geometry || headerPrice == null ? (
            <span className="font-sans text-[12px] text-text-muted">
              {unavailableMsg}
            </span>
          ) : (
            <>
              <span className="font-display text-[20px] font-bold text-espresso leading-none">
                {formatPrice(headerPrice, data?.currency ?? null)}
              </span>
              <span
                className="font-display text-[12px] font-semibold leading-none"
                style={{ color: headerPct >= 0 ? "var(--signal-up)" : "var(--signal-dn)" }}
              >
                {formatPct(headerPct)}
              </span>
              {headerDate && (
                <span className="font-data text-[10px] text-text-muted ml-1">
                  {headerDate}
                </span>
              )}
            </>
          )}
        </div>

        {/* Range selector */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {RANGES.map((r) => {
            const active = r.key === range;
            // Grey/disable ranges known to have no data for this ticker (a
            // newly-listed stock has empty 1y/5y). The active range stays
            // enabled so the user can always re-select where they are.
            const disabledRange = emptyRanges.includes(r.key) && !active;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                disabled={disabledRange}
                className={
                  "font-sans text-[10px] font-semibold px-2 py-1 rounded transition-colors " +
                  (disabledRange
                    ? "text-text-faint border border-transparent opacity-40 cursor-not-allowed "
                    : "cursor-pointer ") +
                  (active
                    ? "bg-gold-muted text-gold border border-gold-border"
                    : disabledRange
                      ? ""
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

      {/* Chart body */}
      <div className="relative">
        {loading ? (
          <div
            className="rounded-md animate-pulse bg-parchment-mid"
            style={{ width: "100%", height: VIEW_H }}
            aria-label="Loading chart"
          />
        ) : empty || !geometry ? (
          <div
            className="rounded-md border border-dashed border-border-base flex items-center justify-center"
            style={{ width: "100%", height: VIEW_H }}
          >
            <p className="font-sans text-[11px] text-text-muted">
              {unavailableMsg}
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            width="100%"
            height={VIEW_H}
            role="img"
            aria-label={`${ticker} ${range} price chart`}
            onPointerMove={handleMove}
            onPointerLeave={handleLeave}
            style={{ display: "block", touchAction: "none" }}
          >
            <defs>
              <linearGradient id={`grad-${ticker}-${range}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Area fill below the line */}
            <path
              d={geometry.areaPath}
              fill={`url(#grad-${ticker}-${range})`}
              stroke="none"
            />

            {/* Baseline at start price */}
            {(() => {
              const startY =
                PAD_T +
                (1 - (geometry.startClose - geometry.minC) / (geometry.maxC - geometry.minC || 1)) *
                  PLOT_H;
              return (
                <line
                  x1={PAD_L}
                  x2={VIEW_W - PAD_R}
                  y1={startY}
                  y2={startY}
                  stroke="var(--border-base)"
                  strokeWidth="1"
                  strokeDasharray="2,3"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })()}

            {/* Line */}
            <path
              d={geometry.linePath}
              fill="none"
              stroke={stroke}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* Hover crosshair + dot */}
            {hover && (
              <>
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={PAD_T}
                  y2={PAD_T + PLOT_H}
                  stroke="var(--text-muted)"
                  strokeWidth="1"
                  strokeDasharray="2,2"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={hover.x}
                  cy={hover.y}
                  r="3.5"
                  fill="var(--cream)"
                  stroke={stroke}
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
          </svg>
        )}
      </div>
    </section>
  );
}
