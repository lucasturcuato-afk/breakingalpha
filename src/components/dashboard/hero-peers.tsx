"use client";

import { useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/ui";

/**
 * HeroPeers — the immersive lead hero's peer-performance bars.
 *
 * Resolves the lead story's associated tickers (its parsed source ticker plus
 * the company names in articles.companies, resolved via /api/company/resolve)
 * and fetches real intraday change via /api/watchlist-quotes. Renders one
 * horizontal bar per ticker, width proportional to |pct| and colored by
 * direction. Renders NOTHING when no tickers resolve or no quotes return, so
 * the hero gives that space back to the dek + "why it matters" — never a
 * fabricated chart. Count-up and width-grow are reduced-motion gated.
 */

const HERO_UP = "#5bbf8a";
const HERO_DN = "#e88083";

// Cap how many company names we resolve for one hero card. resolve fans out a
// Finnhub call + a write per name, so this bounds the cost to a single story.
const MAX_RESOLVE = 4;
const MAX_BARS = 4;

interface PeerBar {
  ticker: string;
  pct: number;
}

// A name already shaped like a ticker (all-caps, <=5 chars) needs no resolve.
function looksLikeTicker(s: string): boolean {
  return /^[A-Z]{1,5}$/.test(s.trim());
}

async function resolveTicker(name: string): Promise<string | null> {
  try {
    const res = await fetch("/api/company/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: name }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const t = data?.company?.ticker;
    return typeof t === "string" && t ? t.toUpperCase() : null;
  } catch {
    return null;
  }
}

export function HeroPeers({
  sourceTicker,
  companies,
}: {
  sourceTicker?: string | null;
  companies?: string[];
}) {
  const [bars, setBars] = useState<PeerBar[]>([]);
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tickers = new Set<string>();
      if (sourceTicker && looksLikeTicker(sourceTicker)) tickers.add(sourceTicker.toUpperCase());

      const names = (companies ?? [])
        .map((c) => (c ?? "").trim())
        .filter(Boolean)
        .slice(0, MAX_RESOLVE);

      // Names that are already ticker-shaped skip the resolve round-trip.
      const toResolve: string[] = [];
      for (const n of names) {
        if (looksLikeTicker(n)) tickers.add(n.toUpperCase());
        else toResolve.push(n);
      }
      if (toResolve.length > 0) {
        const resolved = await Promise.all(toResolve.map(resolveTicker));
        for (const t of resolved) if (t) tickers.add(t);
      }
      if (cancelled || tickers.size === 0) return;

      const symbols = [...tickers].slice(0, MAX_BARS);
      try {
        const res = await fetch(`/api/watchlist-quotes?symbols=${symbols.join(",")}`);
        if (!res.ok) return;
        const json = await res.json();
        const quotes: Record<string, { price: string; pct: number }> = json.quotes ?? {};
        const next: PeerBar[] = [];
        for (const sym of symbols) {
          const q = quotes[sym];
          if (q && typeof q.pct === "number") next.push({ ticker: sym, pct: q.pct });
        }
        if (!cancelled && next.length > 0) {
          // Widest bar first — most-moved peer leads the eye.
          next.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
          setBars(next);
        }
      } catch {
        // silent — no bars, hero falls back to dek + why-it-matters
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceTicker, companies]);

  // Grow the bar widths in one frame after they arrive. Under reduced motion
  // the .dash-hbar transition is disabled in CSS, so the width still snaps
  // straight to target with no animation.
  useEffect(() => {
    if (bars.length === 0) return;
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, [bars]);

  if (bars.length === 0) return null;

  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.pct)), 0.01);

  return (
    <div className="flex flex-col justify-end gap-2 mt-5">
      <p className="font-data text-[9px] tracking-[0.12em] text-[#e8c169] m-0 uppercase">
        Peers · session
      </p>
      {bars.map((b) => {
        const up = b.pct >= 0;
        const target = Math.max(8, Math.round((Math.abs(b.pct) / maxAbs) * 100));
        return (
          <div key={b.ticker} className="flex items-center gap-[11px]">
            <span className="font-data text-[10px] text-[#b9ad97] w-[46px] shrink-0">
              {b.ticker}
            </span>
            <div className="flex-1 h-2 rounded-full overflow-hidden bg-[rgba(212,168,75,0.09)]">
              <span
                className="dash-hbar block h-full rounded-full"
                style={{
                  width: grown ? `${target}%` : "0%",
                  background: up ? HERO_UP : HERO_DN,
                }}
              />
            </div>
            <span
              className="font-data text-[10px] tabular-nums w-[54px] text-right"
              style={{ color: up ? HERO_UP : HERO_DN }}
            >
              {up ? "+" : "−"}
              <AnimatedNumber value={Math.abs(b.pct)} format={(n) => n.toFixed(2)} duration={900} />%
            </span>
          </div>
        );
      })}
    </div>
  );
}
