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

  const key = typeof window !== "undefined" ? process.env.NEXT_PUBLIC_FINNHUB_API_KEY : null;

  useEffect(() => {
    if (!ticker || !key) {
      setLoaded(true);
      return;
    }

    let cancelled = false;

    fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${key}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data.c === "number" && data.c > 0) {
          setPrice(data.c);
          setPctChange(typeof data.dp === "number" ? data.dp : null);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => { cancelled = true; };
  }, [ticker, key]);

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
