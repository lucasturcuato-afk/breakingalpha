"use client";

import { useEffect, useState } from "react";
import { useDashboardSource } from "@/components/dashboard/dashboard-ready";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface PinnedItem {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
}

interface WatchlistEntry {
  identifier: string;
  type: string;
  display_name: string | null;
}

type Quote = { price: string; pct: number };

/**
 * Watchlist tile. Pinned tickers when the user has pinned any; otherwise it
 * falls back to the user's actual watchlist entries (latest first) with real
 * quotes for the ticker-shaped ones, instead of an empty pitch. Company-type
 * entries render without a price (no fabricated quote). A hint keeps the pin
 * affordance discoverable.
 */
export function WatchlistWidget() {
  const [items, setItems] = useState<PinnedItem[] | null>(null);
  // Dashboard reveal gate. Settles on the FIRST completed load, resolved or
  // failed: the error path above sets this same state, so a dead endpoint
  // releases the gate instead of holding the page. Idempotent in the provider,
  // so later refetches cannot re-trigger loading.
  const settleDashboard = useDashboardSource("watchlist");
  useEffect(() => {
    if (items !== null) settleDashboard();
  }, [items, settleDashboard]);

  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watchlist/pinned");
        const json = res.ok ? ((await res.json()) as { items?: PinnedItem[] }) : {};
        const pinned = json.items ?? [];
        if (pinned.length > 0) {
          if (!cancelled) setItems(pinned);
          return;
        }

        // No pins: show the real watchlist entries instead (up to 5, latest
        // first, matching GET /api/watchlist ordering), quoting the tickers.
        const wlRes = await fetch("/api/watchlist");
        if (!wlRes.ok) {
          if (!cancelled) setItems([]);
          return;
        }
        const wl = (await wlRes.json()) as { entries?: WatchlistEntry[] };
        const entries = (wl.entries ?? []).slice(0, 5);
        if (entries.length === 0) {
          if (!cancelled) setItems([]);
          return;
        }

        const symbols = entries
          .filter((e) => e.type === "ticker" && /^[A-Z.\-]{1,10}$/.test(e.identifier))
          .map((e) => e.identifier);
        let quotes: Record<string, Quote> = {};
        if (symbols.length > 0) {
          try {
            const qr = await fetch(`/api/watchlist-quotes?symbols=${symbols.join(",")}`);
            if (qr.ok) quotes = ((await qr.json()).quotes ?? {}) as Record<string, Quote>;
          } catch {
            // quotes optional; rows render with a dash
          }
        }
        if (cancelled) return;
        setFallback(true);
        setItems(
          entries.map((e) => {
            const q = quotes[e.identifier];
            return {
              ticker: e.identifier,
              name: e.display_name ?? e.identifier,
              price: q ? parseFloat(q.price.replace(/,/g, "")) || 0 : 0,
              change_pct: q ? q.pct : 0,
            };
          }),
        );
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (items === null) {
    // Five rows — the widget's real filled height — so resolve causes no shift.
    return (
      <div className="space-y-1 py-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 bg-parchment-mid/40 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        <p className="font-sans text-[11px] text-text-muted py-3 px-2 leading-snug">
          Add companies to your watchlist to track them here.
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
    <div className="dash-fill-in">
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
                <span className="font-data text-[12px] font-bold text-text-primary">
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
                  "font-data text-[12px]",
                  isUnavailable ? "text-text-muted" : "text-text-primary",
                )}
              >
                {isUnavailable ? "—" : item.price.toFixed(2)}
              </span>
              <span
                className={cn(
                  "font-data text-[10px] font-semibold min-w-[48px] text-right",
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

      {fallback && (
        <p className="font-sans text-[9.5px] text-text-faint mt-2 px-2">
          Showing your latest — pin favorites on the watchlist page.
        </p>
      )}
      <Link
        href="/radar/watchlist"
        className="block mt-2 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        Full watchlist →
      </Link>
    </div>
  );
}
