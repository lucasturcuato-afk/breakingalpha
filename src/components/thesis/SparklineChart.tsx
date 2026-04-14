"use client";

import { useState, useEffect } from "react";

interface SparklineChartProps {
  ticker: string | null | undefined;
  size?: "sm" | "md";
}

interface QuoteData {
  c: number; // current price
  dp: number; // percent change
}

interface CandleData {
  c: number[]; // close prices
  s: string; // status
}

export function SparklineChart({ ticker, size = "sm" }: SparklineChartProps) {
  const [points, setPoints] = useState<number[] | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [pctChange, setPctChange] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = typeof window !== "undefined" ? process.env.NEXT_PUBLIC_FINNHUB_API_KEY : null;

  useEffect(() => {
    console.log("[SparklineChart] mount", {
      ticker,
      hasApiKey: !!key,
      envVar: "NEXT_PUBLIC_FINNHUB_API_KEY",
    });

    if (!ticker || !key) {
      setLoading(false);
      if (!key) console.warn("[SparklineChart] NEXT_PUBLIC_FINNHUB_API_KEY is not set");
      return;
    }

    let cancelled = false;
    const now = Math.floor(Date.now() / 1000);
    const from = now - 7 * 86400;

    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${key}`;
    const candleUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${from}&to=${now}&token=${key}`;

    console.log("[SparklineChart] fetching", { quoteUrl: quoteUrl.replace(key, "***"), candleUrl: candleUrl.replace(key, "***") });

    Promise.all([
      fetch(quoteUrl)
        .then((r) => {
          if (!r.ok) throw new Error(`Quote fetch failed: ${r.status}`);
          return r.json();
        })
        .catch((e) => { console.error("[SparklineChart] quote error:", e); return null; }) as Promise<QuoteData | null>,
      fetch(candleUrl)
        .then((r) => {
          if (!r.ok) throw new Error(`Candle fetch failed: ${r.status}`);
          return r.json();
        })
        .catch((e) => { console.error("[SparklineChart] candle error:", e); return null; }) as Promise<CandleData | null>,
    ]).then(([quote, candles]) => {
      if (cancelled) return;
      if (quote && typeof quote.c === "number" && quote.c > 0) {
        setPrice(quote.c);
        setPctChange(typeof quote.dp === "number" ? quote.dp : null);
      }
      if (candles && candles.s === "ok" && Array.isArray(candles.c) && candles.c.length > 1) {
        setPoints(candles.c);
      } else if (candles) {
        console.warn("[SparklineChart] candle response not ok:", candles.s);
        setError("no data");
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [ticker, key]);

  const w = size === "sm" ? 60 : 80;
  const h = 24;

  // No ticker — render nothing
  if (!ticker) return null;

  // No API key — render placeholder
  if (!key) {
    return (
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <line
            x1={0} y1={h / 2} x2={w} y2={h / 2}
            stroke="#6B7280"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </svg>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="rounded animate-pulse bg-border-base"
        style={{ width: w + 50, height: h }}
      />
    );
  }

  if (!points || points.length < 2) {
    // Data fetch failed or empty — show dashed placeholder
    return (
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <line
            x1={0} y1={h / 2} x2={w} y2={h / 2}
            stroke="#6B7280"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </svg>
      </div>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const polyPoints = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  const up = points[points.length - 1] >= points[0];
  const lineColor = up ? "#22C55E" : "#DC2626";

  const formattedPrice = price !== null ? price.toFixed(2) : null;
  const formattedPct =
    pctChange !== null
      ? `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%`
      : null;

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline
          points={polyPoints}
          fill="none"
          stroke={lineColor}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex flex-col items-start">
        {formattedPrice && (
          <span
            className="font-data text-[10px] leading-none"
            style={{ color: lineColor }}
          >
            {formattedPrice}
          </span>
        )}
        {formattedPct && (
          <span
            className="font-data text-[9px] leading-none"
            style={{ color: lineColor }}
          >
            {formattedPct}
          </span>
        )}
      </div>
    </div>
  );
}
