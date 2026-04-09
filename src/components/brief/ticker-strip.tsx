"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface TickerQuote {
  symbol: string;
  price: string;
  pct: number;
}

interface TickerStripProps {
  quotes?: TickerQuote[];
}

const DEFAULT_SYMBOLS = ["SPY", "QQQ", "AAPL", "NVDA", "MSFT", "META", "GOOGL", "AMZN", "TSLA", "GLD", "TLT", "BTC"];

const fallbackQuotes: TickerQuote[] = DEFAULT_SYMBOLS.map((s) => ({
  symbol: s,
  price: "—",
  pct: 0,
}));

export function TickerStrip({ quotes: externalQuotes }: TickerStripProps) {
  const [liveQuotes, setLiveQuotes] = useState<TickerQuote[]>(fallbackQuotes);

  useEffect(() => {
    if (externalQuotes) return; // Skip fetch if quotes provided externally

    async function fetchQuotes() {
      try {
        const res = await fetch(`/api/watchlist-quotes?symbols=${DEFAULT_SYMBOLS.join(",")}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.quotes) return;

        setLiveQuotes(
          DEFAULT_SYMBOLS.map((symbol) => {
            const q = data.quotes[symbol];
            if (!q) return { symbol, price: "—", pct: 0 };
            return {
              symbol,
              price: typeof q.price === "number" ? q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(q.price),
              pct: q.pct ?? 0,
            };
          }),
        );
      } catch {
        // Keep fallback quotes on error
      }
    }

    fetchQuotes();
    const interval = setInterval(fetchQuotes, 60_000);
    return () => clearInterval(interval);
  }, [externalQuotes]);

  const quotes = externalQuotes || liveQuotes;
  // Triple the items for seamless loop
  const items = [...quotes, ...quotes, ...quotes];

  return (
    <div className="relative h-8 bg-espresso overflow-hidden border-b border-espresso-light/30">
      {/* Fade edges */}
      <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-espresso to-transparent z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-espresso to-transparent z-10" />

      {/* Scrolling track */}
      <div className="flex items-center h-full animate-[ticker-scroll_60s_linear_infinite]">
        {items.map((q, i) => (
          <div key={`${q.symbol}-${i}`} className="flex items-center gap-1.5 px-4 flex-shrink-0">
            <span className="font-data text-[10px] text-text-muted">{q.symbol}</span>
            <span className="font-data text-[11px] font-bold text-cream">{q.price}</span>
            <span
              className={cn(
                "font-data text-[10px] font-semibold",
                q.pct >= 0 ? "text-signal-up" : "text-signal-dn",
              )}
            >
              {q.pct >= 0 ? "▲" : "▼"} {Math.abs(q.pct).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
