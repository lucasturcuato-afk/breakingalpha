"use client";

import { useState, useEffect } from "react";

interface SparklineChartProps {
  ticker: string | null | undefined;
  size?: "sm" | "md";
}

export function SparklineChart({ ticker, size = "sm" }: SparklineChartProps) {
  const [price, setPrice] = useState<number | null>(null);
  const [pctChange, setPctChange] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ticker) {
      setLoaded(true);
      return;
    }

    let cancelled = false;

    // Quote is proxied server-side via /api/stock-chart so the paid market-data
    // key never ships in the client bundle. We request range=1d (smallest
    // payload) and read the current price plus prior close to derive the daily
    // percent change the same way the previous Finnhub `dp` field provided it.
    fetch(`/api/stock-chart?ticker=${encodeURIComponent(ticker)}&range=1d`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const current = data && typeof data.price === "number" ? data.price : null;
        const prev = data && typeof data.prevClose === "number" ? data.prevClose : null;
        if (current !== null && current > 0) {
          setPrice(current);
          setPctChange(
            prev !== null && prev > 0 ? ((current - prev) / prev) * 100 : null,
          );
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => { cancelled = true; };
  }, [ticker]);

  if (!ticker) return null;
  if (!loaded) {
    return (
      <div
        className="rounded animate-pulse bg-border-base"
        style={{ width: size === "sm" ? 80 : 100, height: 16 }}
      />
    );
  }
  if (price === null || price === 0) return null;

  const dp = pctChange ?? 0;
  const color = dp > 0 ? "#22C55E" : dp < 0 ? "#DC2626" : "#6B7280";
  const sign = dp >= 0 ? "+" : "";

  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0" style={{ color }}>
      <span className="font-data text-[10px] leading-none">
        ${price.toFixed(2)}
      </span>
      <span className="font-data text-[9px] leading-none">
        {sign}{dp.toFixed(1)}%
      </span>
    </span>
  );
}
