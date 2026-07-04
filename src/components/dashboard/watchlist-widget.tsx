"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface PinnedItem {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
}

export function WatchlistWidget() {
  const [items, setItems] = useState<PinnedItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watchlist/pinned");
        if (!res.ok) {
          if (!cancelled) setItems([]);
          return;
        }
        const json = (await res.json()) as { items?: PinnedItem[] };
        if (!cancelled) setItems(json.items ?? []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (items === null) {
    return (
      <div className="space-y-1 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-6 bg-parchment-mid/40 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        <p className="font-sans text-[11px] text-text-muted py-3 px-2 leading-snug">
          Pin up to 5 tickers from your watchlist to track them here.
        </p>
        <Link
          href="/radar/watchlist"
          className="block mt-2 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
        >
          Go to watchlist →
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const isUnavailable = item.price === 0;
          const isPositive = item.change_pct >= 0;
          return (
            <Link
              key={item.ticker}
              href={`/company/${item.ticker}`}
              prefetch={false}
              className={cn(
                "flex items-center gap-2 py-2 px-2 rounded-lg",
                "transition-colors duration-[var(--duration-fast)]",
                "hover:bg-parchment-mid",
              )}
            >
              <div className="flex-1 min-w-0">
                <span className="font-display text-[12px] font-bold text-text-primary">
                  {item.ticker}
                </span>
                {item.name !== item.ticker && (
                  <span className="font-sans text-[10px] text-text-muted ml-1.5">
                    {item.name}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "font-display text-[12px]",
                  isUnavailable ? "text-text-muted" : "text-text-primary",
                )}
              >
                {isUnavailable ? "—" : item.price.toFixed(2)}
              </span>
              <span
                className={cn(
                  "font-display text-[10px] font-semibold min-w-[48px] text-right",
                  isUnavailable
                    ? "text-text-muted"
                    : isPositive
                      ? "text-signal-up"
                      : "text-signal-dn",
                )}
              >
                {isUnavailable
                  ? "—"
                  : `${isPositive ? "+" : ""}${item.change_pct.toFixed(2)}%`}
              </span>
            </Link>
          );
        })}
      </div>

      <Link
        href="/radar/watchlist"
        className="block mt-2 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        Full watchlist →
      </Link>
    </div>
  );
}
