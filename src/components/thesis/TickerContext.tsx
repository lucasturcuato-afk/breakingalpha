"use client";

import { useState, useEffect } from "react";

interface TickerContextData {
  current_price: number | null;
  price_change_pct: number | null;
  price_change_pct_5d: number | null;
  price_change_pct_1mo: number | null;
  week52_high: number | null;
  week52_low: number | null;
  momentum_vs_thesis: number | null;
  options_implied_move: number | null;
  data_source: "Finnhub";
}

interface TickerContextProps {
  ticker: string;
  thesisCreatedAt?: string | null;
  variant?: "compact" | "expanded";
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(2);
}

function fmtPct(n: number): string {
  return Math.abs(n).toFixed(1) + "%";
}

function pctColor(n: number): string {
  if (n < -0.5) return "text-signal-dn";
  if (n > 0.5) return "text-signal-up";
  return "text-text-muted";
}

function arrow(n: number): string {
  return n >= 0 ? "\u25B2" : "\u25BC";
}

export function TickerContext({ ticker, thesisCreatedAt, variant = "compact" }: TickerContextProps) {
  const [data, setData] = useState<TickerContextData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const params = new URLSearchParams({ ticker });
        if (thesisCreatedAt) params.set("thesis_created_at", thesisCreatedAt);
        const res = await fetch(`/api/ticker-context?${params.toString()}`);
        if (!res.ok) { setError(true); return; }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [ticker, thesisCreatedAt]);

  // Loading or error: render nothing
  if (!data || error) return null;

  // Build segments
  const segments: React.ReactNode[] = [];

  if (data.current_price != null) {
    segments.push(
      <span key="price" className="font-data text-[11px] text-espresso font-semibold">
        ${fmtPrice(data.current_price)}
      </span>
    );
  }

  if (data.price_change_pct != null) {
    const c = pctColor(data.price_change_pct);
    segments.push(
      <span key="today" className={`font-data text-[11px] ${c}`}>
        {arrow(data.price_change_pct)}{fmtPct(data.price_change_pct)} today
      </span>
    );
  }

  if (data.week52_high != null && data.week52_low != null) {
    segments.push(
      <span key="52w" className="font-data text-[11px] text-text-secondary">
        52w: ${fmtPrice(data.week52_low)} &mdash; ${fmtPrice(data.week52_high)}
      </span>
    );
  }

  if (data.momentum_vs_thesis != null) {
    const c = pctColor(data.momentum_vs_thesis);
    segments.push(
      <span key="thesis" className={`font-data text-[11px] ${c}`}>
        Since thesis: {arrow(data.momentum_vs_thesis)}{fmtPct(data.momentum_vs_thesis)}
      </span>
    );
  }

  // Source pill always last on compact row
  const sourcePill = (
    <span key="src" className="text-[8px] border border-border-base text-gold-dark rounded px-1 font-sans">
      Finnhub
    </span>
  );

  if (segments.length === 0) return null;

  const pipe = <span className="text-text-faint mx-1">|</span>;

  const compactRow = (
    <div className="flex items-center flex-wrap gap-x-0">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && pipe}
          {seg}
        </span>
      ))}
      <span className="flex items-center">{pipe}{sourcePill}</span>
    </div>
  );

  if (variant === "compact") {
    return compactRow;
  }

  // Expanded: compact row + second row with 5d, 1mo, implied move
  const expandedSegments: React.ReactNode[] = [];

  if (data.price_change_pct_5d != null) {
    const c = pctColor(data.price_change_pct_5d);
    expandedSegments.push(
      <span key="5d" className={`font-data text-[11px] ${c}`}>
        5d: {arrow(data.price_change_pct_5d)}{fmtPct(data.price_change_pct_5d)}
      </span>
    );
  }

  if (data.price_change_pct_1mo != null) {
    const c = pctColor(data.price_change_pct_1mo);
    expandedSegments.push(
      <span key="1mo" className={`font-data text-[11px] ${c}`}>
        1mo: {arrow(data.price_change_pct_1mo)}{fmtPct(data.price_change_pct_1mo)}
      </span>
    );
  }

  if (data.options_implied_move != null) {
    expandedSegments.push(
      <span key="iv" className="font-data text-[11px] text-text-secondary">
        Implied move: &plusmn;{fmtPct(data.options_implied_move)}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {compactRow}
      {expandedSegments.length > 0 && (
        <div className="flex items-center flex-wrap gap-x-0">
          {expandedSegments.map((seg, i) => (
            <span key={i} className="flex items-center">
              {i > 0 && pipe}
              {seg}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
