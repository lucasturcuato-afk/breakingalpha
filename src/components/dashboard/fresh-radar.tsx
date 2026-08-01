"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Check } from "lucide-react";
import type { StoryData } from "@/components/dashboard/story-card";

/**
 * FreshRadar — "Fresh on your radar": companies surfaced in today's Top Stories
 * that are NOT already on the user's watchlist. Each card draws a real
 * sparkline (from /api/stock-chart) with the day's change, and "+ Track" adds
 * the ticker to the watchlist via POST /api/watchlist.
 *
 * Data note: tickers come from the parsed Google-News source label on each
 * story (story.sourceTicker), which is a ready equity symbol needing no
 * resolution. Stories without a parseable ticker contribute nothing, and if no
 * not-tracked ticker surfaces the whole section renders null (no placeholder).
 */

const MAX_CARDS = 5;

interface RadarCard {
  ticker: string;
  company: string;
  headline: string;
  url?: string;
  closes: number[];
  pct: number | null;
}

interface ChartResponse {
  points?: { t: number; c: number }[];
}

// The sparkline series (1mo trend). The day change comes from watchlist-quotes
// instead — chart-meta's chartPreviousClose anchors to the window start, so
// deriving pct from a 1mo chart would report a monthly return, not the day's.
async function loadCloses(ticker: string): Promise<number[] | null> {
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

// Draw-in sparkline. Path length is summed so the stroke-dash reveal is exact.
function Spark({ closes, up }: { closes: number[]; up: boolean }) {
  const w = 64;
  const h = 26;
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
  const color = up ? "var(--signal-up)" : "var(--signal-dn)";
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

function TrackButton({ ticker, company }: { ticker: string; company: string }) {
  const [state, setState] = useState<"idle" | "saving" | "tracked" | "error">("idle");

  const track = async () => {
    if (state === "saving" || state === "tracked") return;
    setState("saving");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: ticker, type: "ticker", display_name: company }),
      });
      // A 400 "already in your watchlist" is still a tracked outcome.
      if (res.ok || res.status === 400) setState("tracked");
      else setState("error");
    } catch {
      setState("error");
    }
  };

  if (state === "tracked") {
    return (
      <span className="mt-auto inline-flex items-center gap-1 font-data text-[11px] font-medium text-signal-up">
        <Check size={11} /> Tracking
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={track}
      disabled={state === "saving"}
      className="mt-auto inline-flex items-center gap-1 font-data text-[11px] font-medium text-gold-dark hover:text-gold transition-colors cursor-pointer disabled:opacity-60 self-start"
    >
      {state === "saving" && <Loader2 size={10} className="animate-spin" />}
      {state === "error" ? "Retry" : "+ Track"}
    </button>
  );
}

export function FreshRadar({
  stories,
  watchlistTickers,
  riseDelay = 0,
}: {
  stories: StoryData[];
  watchlistTickers: string[];
  riseDelay?: number;
}) {
  const [cards, setCards] = useState<RadarCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tracked = new Set(watchlistTickers.map((t) => t.toUpperCase()));
      const seen = new Set<string>();
      const candidates: { ticker: string; story: StoryData }[] = [];
      for (const s of stories) {
        const t = s.sourceTicker?.toUpperCase();
        if (!t || tracked.has(t) || seen.has(t)) continue;
        seen.add(t);
        candidates.push({ ticker: t, story: s });
        if (candidates.length >= MAX_CARDS) break;
      }
      if (candidates.length === 0) {
        if (!cancelled) setCards([]);
        return;
      }

      // Sparkline series per ticker + one batched day-change quote call.
      const symbols = candidates.map((c) => c.ticker);
      const [closesList, quotes] = await Promise.all([
        Promise.all(candidates.map((c) => loadCloses(c.ticker))),
        fetch(`/api/watchlist-quotes?symbols=${symbols.join(",")}`)
          .then((r) => (r.ok ? r.json() : { quotes: {} }))
          .then((j) => (j.quotes ?? {}) as Record<string, { price: string; pct: number }>)
          .catch(() => ({} as Record<string, { price: string; pct: number }>)),
      ]);
      if (cancelled) return;
      const next: RadarCard[] = [];
      candidates.forEach((c, i) => {
        const closes = closesList[i];
        if (!closes) return;
        const q = quotes[c.ticker];
        next.push({
          ticker: c.ticker,
          company: c.story.companies?.[0] ?? c.ticker,
          headline: c.story.title,
          url: c.story.url,
          closes,
          pct: q && typeof q.pct === "number" ? q.pct : null,
        });
      });
      if (!cancelled) setCards(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [stories, watchlistTickers]);

  // Nothing surfaced (or still resolving with no result) — render no section.
  if (!cards || cards.length === 0) return null;

  return (
    <div className="dash-rise mt-[18px]" style={{ animationDelay: `${riseDelay}ms` }}>
      <div className="flex items-baseline gap-2.5 mb-3.5 border-b border-border-subtle pb-2">
        <span className="font-data text-[10px] tracking-[0.12em] text-gold-dark uppercase">
          Fresh on your radar
        </span>
        <span className="flex-1" />
        <span className="font-display italic text-[12px] text-text-muted">
          surfaced today, not yet tracked
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((c) => {
          // Spark colored by its own trend; the pct chip by the day change.
          const sparkUp = c.closes[c.closes.length - 1] >= c.closes[0];
          const up = c.pct != null ? c.pct >= 0 : sparkUp;
          return (
            <div
              key={c.ticker}
              className="dash-tile flex flex-col min-w-0 bg-white border border-border-base rounded-xl p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-data text-[11px] text-espresso">{c.ticker}</span>
                {c.pct != null && (
                  <span
                    className={cn(
                      "font-data text-[10px] tabular-nums",
                      up ? "text-signal-up" : "text-signal-dn",
                    )}
                  >
                    {up ? "+" : ""}
                    {c.pct.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="my-2">
                <Spark closes={c.closes} up={sparkUp} />
              </div>
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-display text-[13.5px] font-medium text-espresso leading-[1.25] hover:text-gold-dark transition-colors line-clamp-2"
                >
                  {c.headline}
                </a>
              ) : (
                <p className="font-display text-[13.5px] font-medium text-espresso leading-[1.25] line-clamp-2 m-0">
                  {c.headline}
                </p>
              )}
              <span className="font-display italic text-[11px] text-text-muted mt-1 mb-2.5 line-clamp-1">
                {c.company}
              </span>
              <TrackButton ticker={c.ticker} company={c.company} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
