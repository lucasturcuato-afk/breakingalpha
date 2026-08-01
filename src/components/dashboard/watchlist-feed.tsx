"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ExternalLink, Eye } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";

interface WatchlistArticle {
  article_id: string;
  identifier: string;
  title: string;
  url: string;
  source: string;
  source_type: string;
  summary: string | null;
  published_at: string | null;
  relevance_score: number | null;
}

type Quote = { price: string; pct: number };

// How many articles the browsable "Lead" deck holds, and how many land in
// "The wire" after it.
const DECK_N = 3;
const WIRE_N = 6;

// Fanned-sheet transform per stack position. Only 0/1/2 are visible; deeper
// cards hide behind the stack. The front card (0) is the interactive Lead.
function sheetStyle(pos: number): React.CSSProperties {
  switch (pos) {
    case 0:
      return { transform: "translate(0px,0px) rotate(0deg)", opacity: 1, zIndex: 30 };
    case 1:
      return { transform: "translate(14px,12px) rotate(-2.4deg)", opacity: 0.55, zIndex: 20 };
    case 2:
      return { transform: "translate(26px,22px) rotate(-4.6deg)", opacity: 0.32, zIndex: 10 };
    default:
      return { transform: "translate(26px,22px) rotate(-4.6deg)", opacity: 0, zIndex: 0 };
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Small mono ticker + real day pct (omitted when no quote is available — never
// a fabricated number).
function TickerPct({ ticker, quote }: { ticker: string; quote?: Quote }) {
  return (
    <span className="font-data text-[10.5px] text-text-muted tabular-nums">
      {ticker}
      {quote && (
        <span className={cn("ml-1", quote.pct >= 0 ? "text-signal-up" : "text-signal-dn")}>
          {quote.pct >= 0 ? "+" : ""}
          {quote.pct.toFixed(2)}%
        </span>
      )}
    </span>
  );
}

/**
 * WatchDeck — the featured "Lead" as a browsable stack of newsroom sheets
 * (the mockup's "tap to browse" paper-turn). Clicking the front card (or a
 * dot) advances the stack; the front card eases forward while the others fan
 * behind it. Reduced motion disables the transition, so browsing becomes an
 * instant swap. Every card links to its real article.
 */
function WatchDeck({
  deck,
  quotes,
}: {
  deck: WatchlistArticle[];
  quotes: Record<string, Quote>;
}) {
  const [top, setTop] = useState(0);
  const k = deck.length;
  const advance = () => setTop((t) => (t + 1) % k);

  return (
    <div className="pb-3.5 mb-3 border-b border-border-subtle">
      <div className="relative h-[168px] pr-7">
        {deck.map((a, i) => {
          const pos = (i - top + k) % k;
          const front = pos === 0;
          return (
            <div
              key={a.article_id}
              className={cn(
                "dash-sheet absolute inset-0 rounded-2xl border border-border-base bg-white p-4 shadow-[0_16px_40px_-22px_rgba(20,14,4,0.34)]",
                front && k > 1 && "cursor-pointer",
              )}
              style={{ ...sheetStyle(pos), pointerEvents: front ? "auto" : "none" }}
              onClick={front && k > 1 ? advance : undefined}
              role={front && k > 1 ? "button" : undefined}
              aria-label={front && k > 1 ? "Next watch story" : undefined}
              aria-hidden={!front}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-1.5 py-0.5 rounded font-data text-[8px] font-bold uppercase bg-gold-muted text-gold border border-gold/20">
                  {a.identifier}
                </span>
                <TickerPct ticker="" quote={quotes[a.identifier]} />
                <span className="font-data text-[9.5px] text-text-faint ml-auto tabular-nums">
                  {a.source} · {timeAgo(a.published_at)}
                </span>
              </div>
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="group font-display text-[16px] font-medium text-espresso leading-[1.22] hover:text-gold-dark transition-colors line-clamp-2 inline-block"
              >
                {a.title}
                <ExternalLink size={11} className="inline ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
              </a>
              {a.summary && (
                <p className="font-sans text-[11.5px] text-text-secondary leading-[1.5] mt-1 line-clamp-2">
                  {a.summary}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {k > 1 && (
        <div className="flex items-center gap-2 mt-3.5">
          {deck.map((a, i) => (
            <button
              key={a.article_id}
              type="button"
              onClick={() => setTop(i)}
              aria-label={`Show watch story ${i + 1}`}
              aria-current={i === top}
              className={cn(
                "h-[3px] rounded-[2px] cursor-pointer transition-all duration-300",
                i === top ? "w-[30px] bg-gold" : "w-[22px] bg-border-hover",
              )}
            />
          ))}
          <span className="font-data text-[9.5px] text-text-faint ml-1.5">
            tap to browse
          </span>
        </div>
      )}
    </div>
  );
}

export function WatchlistFeed({ riseDelay = 0 }: { riseDelay?: number } = {}) {
  const [articles, setArticles] = useState<WatchlistArticle[]>([]);
  const [identifiers, setIdentifiers] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watchlist-feed");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const arts: WatchlistArticle[] = json.articles ?? [];
        setArticles(arts);
        setIdentifiers(json.identifiers ?? []);

        // One batched quote call for the tickers we actually render, so The
        // wire and the lead can show real day change. Ticker-shaped identifiers
        // only (the quote API takes equity symbols).
        const symbols = [...new Set(arts.map((a) => a.identifier))]
          .filter((s) => /^[A-Z.\-]{1,10}$/.test(s))
          .slice(0, 20);
        if (symbols.length > 0) {
          try {
            const qr = await fetch(`/api/watchlist-quotes?symbols=${symbols.join(",")}`);
            if (qr.ok && !cancelled) {
              const qj = await qr.json();
              setQuotes(qj.quotes ?? {});
            }
          } catch {
            // quotes are optional — pct just won't render
          }
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div
        className="dash-tile dash-rise bg-white border border-border-base rounded-[28px_28px_28px_10px] p-5 md:p-6"
        style={{ animationDelay: `${riseDelay}ms` }}
      >
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-parchment-mid rounded w-1/3" />
          <div className="h-3 bg-parchment-mid rounded w-full" />
          <div className="h-3 bg-parchment-mid rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (identifiers.length === 0) return null;

  const deck = articles.slice(0, DECK_N);
  const wire = articles.slice(DECK_N, DECK_N + WIRE_N);

  return (
    <div
      className="dash-tile dash-rise bg-white border border-border-base rounded-[28px_28px_28px_10px] p-5 md:p-6"
      style={{ animationDelay: `${riseDelay}ms` }}
    >
      <div className="flex items-baseline justify-between gap-3 border-b-[1.5px] border-[color:var(--espresso)] pb-2.5 mb-3.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <Eye size={14} className="text-gold self-center" />
          <h3 className="font-display text-[18px] font-medium text-espresso m-0 inline-flex items-center gap-1.5">
            The Watch
            <InfoTooltip content="Real-time articles mentioning companies on your watchlist." side="right" iconSize={12} />
          </h3>
          <span className="font-display italic text-[12px] text-text-muted whitespace-nowrap">
            your newsroom
          </span>
        </div>
        <span className="font-data text-[10px] text-text-muted whitespace-nowrap tabular-nums">
          {identifiers.length} tracked
        </span>
      </div>

      {articles.length === 0 ? (
        <p className="font-sans text-[12px] text-text-muted italic">
          No recent articles for your watchlist. Check back later.
        </p>
      ) : (
        <>
          {/* Lead — browsable newsroom sheet deck (paper-turn). */}
          {deck.length > 0 && <WatchDeck deck={deck} quotes={quotes} />}

          {/* The wire — the rest of your watch, most-relevant first. */}
          {wire.length > 0 && (
            <>
              <div className="flex items-baseline gap-2.5 mb-2.5">
                <span className="font-data text-[10px] tracking-[0.12em] text-gold-dark uppercase">
                  The wire
                </span>
                <span className="flex-1 h-px bg-border-subtle" />
                <span className="font-display italic text-[11px] text-text-muted">
                  more from your watch
                </span>
              </div>
              <div className="space-y-0">
                {wire.map((a) => (
                  <a
                    key={a.article_id}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block py-2 border-b border-border-subtle last:border-0"
                  >
                    <TickerPct ticker={a.identifier} quote={quotes[a.identifier]} />
                    <p className="font-display text-[14px] font-medium text-espresso leading-[1.3] mt-1 group-hover:text-gold-dark transition-colors line-clamp-1">
                      {a.title}
                      <ExternalLink size={9} className="inline ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </p>
                    <span className="font-data text-[9.5px] text-text-faint tabular-nums">
                      {a.source} · {timeAgo(a.published_at)}
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
