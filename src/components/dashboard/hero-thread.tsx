"use client";

import { useEffect, useState } from "react";
import { stripHtml } from "@/lib/strip-html";

/**
 * HeroThread — the hero's "In this thread" row: the lead story's nearest
 * neighbors by stored-embedding cosine similarity (/api/related-articles →
 * related_articles RPC). Each entry is a real related article: ticker + real
 * day change when the ticker resolves, headline link, dek snippet. The row
 * hides entirely when nothing comes back (RPC absent, no neighbors, unauth).
 *
 * Results are memoized per article id for the session so the hero rotation
 * does not refetch on every revolution.
 */

const HERO_UP = "#5bbf8a";
const HERO_DN = "#e88083";

interface RelatedItem {
  id: string;
  title: string;
  url: string | null;
  source: string | null;
  summary: string | null;
  ticker: string | null;
}

type Quote = { price: string; pct: number };

const threadCache = new Map<string, RelatedItem[]>();
const quoteCache = new Map<string, Quote>();

export function HeroThread({ storyId }: { storyId: string }) {
  const [items, setItems] = useState<RelatedItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let related = threadCache.get(storyId);
      if (!related) {
        try {
          const res = await fetch(`/api/related-articles?id=${encodeURIComponent(storyId)}`);
          if (!res.ok) return;
          const json = await res.json();
          related = (json.related ?? []) as RelatedItem[];
          threadCache.set(storyId, related);
        } catch {
          return;
        }
      }
      if (cancelled || !related || related.length === 0) {
        if (!cancelled) setItems([]);
        return;
      }
      setItems(related);

      const symbols = [...new Set(related.map((r) => r.ticker).filter(Boolean))] as string[];
      const missing = symbols.filter((s) => !quoteCache.has(s));
      if (missing.length > 0) {
        try {
          const qr = await fetch(`/api/watchlist-quotes?symbols=${missing.join(",")}`);
          if (qr.ok) {
            const qj = await qr.json();
            for (const [sym, q] of Object.entries((qj.quotes ?? {}) as Record<string, Quote>)) {
              quoteCache.set(sym, q);
            }
          }
        } catch {
          // quotes optional
        }
      }
      if (cancelled) return;
      const next: Record<string, Quote> = {};
      for (const s of symbols) {
        const q = quoteCache.get(s);
        if (q) next[s] = q;
      }
      setQuotes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [storyId]);

  if (items.length === 0) return null;

  return (
    <div className="mt-5 pt-4 border-t border-[rgba(212,168,75,0.14)]">
      <p className="font-data text-[10.5px] tracking-[0.02em] text-[#e8c169] m-0 mb-3.5">
        In this thread
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-7 gap-y-4">
        {items.map((r) => {
          const q = r.ticker ? quotes[r.ticker] : undefined;
          const up = q ? q.pct >= 0 : true;
          return (
            <div key={r.id} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-data text-[10.5px] text-[#b9ad97]">
                  {r.ticker ?? r.source ?? ""}
                </span>
                {q && (
                  <span
                    className="font-data text-[10.5px] tabular-nums"
                    style={{ color: up ? HERO_UP : HERO_DN }}
                  >
                    {up ? "+" : ""}
                    {q.pct.toFixed(2)}%
                  </span>
                )}
              </div>
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="block font-display text-[14px] font-medium text-[#f2e8d6] leading-[1.3] mt-1.5 hover:text-[#e8c169] transition-colors line-clamp-2"
                >
                  {r.title}
                </a>
              ) : (
                <p className="font-display text-[14px] font-medium text-[#f2e8d6] leading-[1.3] mt-1.5 m-0 line-clamp-2">
                  {r.title}
                </p>
              )}
              {r.summary && (
                <p className="font-display italic text-[12px] leading-[1.4] text-[#9c9077] mt-1 m-0 line-clamp-2">
                  {stripHtml(r.summary)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
