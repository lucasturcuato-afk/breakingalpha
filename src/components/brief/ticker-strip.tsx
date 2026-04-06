"use client";

import { cn } from "@/lib/utils";

export interface TickerQuote {
  symbol: string;
  price: string;
  pct: number;
}

interface TickerStripProps {
  quotes?: TickerQuote[];
}

const defaultQuotes: TickerQuote[] = [
  { symbol: "SPY", price: "448.02", pct: 0.38 },
  { symbol: "QQQ", price: "378.15", pct: 0.52 },
  { symbol: "AAPL", price: "189.84", pct: 1.23 },
  { symbol: "NVDA", price: "875.28", pct: -2.41 },
  { symbol: "MSFT", price: "378.91", pct: 0.65 },
  { symbol: "META", price: "485.20", pct: 0.92 },
  { symbol: "GOOGL", price: "141.80", pct: -0.18 },
  { symbol: "AMZN", price: "178.25", pct: 1.05 },
  { symbol: "TSLA", price: "248.42", pct: -1.87 },
  { symbol: "GLD", price: "192.30", pct: 0.42 },
  { symbol: "TLT", price: "96.48", pct: 0.28 },
  { symbol: "BTC", price: "62,480", pct: 2.15 },
];

export function TickerStrip({ quotes = defaultQuotes }: TickerStripProps) {
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
