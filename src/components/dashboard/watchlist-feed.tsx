"use client";

import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
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

// How many articles the browsable "Lead" deck holds; everything after it feeds
// the revolving wire.
const DECK_N = 3;
// The Lead deck auto-revolves at the same cadence as the top-stories hero.
const DECK_ROTATE_MS = 7000;
// Refetch the feed on this interval so the newsroom updates as the pipeline
// lands newer stories, instead of sitting static all session.
const REFRESH_MS = 5 * 60 * 1000;

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
 * Recency-plus-variety ordering for the wire: group by identifier (each group
 * newest-first), order groups by their freshest story, then round-robin across
 * groups. Freshest story per name leads and no single ticker can monopolize
 * the reel, matching the mockup's varied-name column. Pure re-ordering of the
 * real feed; nothing is filtered out.
 */
function interleaveByIdentifier(items: WatchlistArticle[]): WatchlistArticle[] {
  const ts = (a: WatchlistArticle) =>
    a.published_at ? new Date(a.published_at).getTime() : 0;
  const groups = new Map<string, WatchlistArticle[]>();
  for (const a of items) {
    const g = groups.get(a.identifier) ?? [];
    g.push(a);
    groups.set(a.identifier, g);
  }
  const ordered = [...groups.values()]
    .map((g) => [...g].sort((x, y) => ts(y) - ts(x)))
    .sort((ga, gb) => ts(gb[0]) - ts(ga[0]));
  const out: WatchlistArticle[] = [];
  for (let round = 0; out.length < items.length; round += 1) {
    for (const g of ordered) {
      if (round < g.length) out.push(g[round]);
    }
  }
  return out;
}

/**
 * WatchDeck — the featured "Lead" as a browsable stack of newsroom sheets
 * (the mockup's paper-turn). It AUTO-REVOLVES like the top-stories hero:
 * advances on an interval with the sheet transition, pauses on hover/focus,
 * resumes on leave. Tap the front card or a dot to browse manually. Reduced
 * motion: no auto-rotate and no transition — manual browse only, instant swap.
 * Every card links to its real article.
 */
function WatchDeck({
  deck,
  quotes,
}: {
  deck: WatchlistArticle[];
  quotes: Record<string, Quote>;
}) {
  const [top, setTop] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  const k = deck.length;
  const advance = () => setTop((t) => (t + 1) % k);

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    if (reduce || k <= 1) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setTop((t) => (t + 1) % k);
    }, DECK_ROTATE_MS);
    return () => clearInterval(id);
  }, [reduce, k]);

  // Keep top in range if a refetch shrinks the deck.
  const topIdx = k > 0 ? top % k : 0;

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="relative h-[172px] pr-7">
        {deck.map((a, i) => {
          const pos = (i - topIdx + k) % k;
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
              aria-current={i === topIdx}
              className={cn(
                "h-[3px] rounded-[2px] cursor-pointer transition-all duration-300",
                i === topIdx ? "w-[30px] bg-gold" : "w-[22px] bg-border-hover",
              )}
            />
          ))}
          <span className="font-data text-[9.5px] text-text-faint ml-1.5">
            {reduce ? "tap to browse" : paused ? "held" : "auto · tap to browse"}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * WireReel — "The wire" as a revolving window (like the hero). Auto-cycles a
 * fixed window through the full set of watch items on an interval, each advance
 * a gentle cross-fade; hover or focus pauses. Reduced motion: no auto-cycle,
 * the first window renders statically.
 */
function WireReel({
  items,
  quotes,
}: {
  items: WatchlistArticle[];
  quotes: Record<string, Quote>;
}) {
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  const WINDOW = 3;
  const cyclable = items.length > WINDOW;

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    if (reduce || !cyclable) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setOffset((o) => (o + 1) % items.length);
    }, 3500);
    return () => clearInterval(id);
  }, [reduce, cyclable, items.length]);

  const size = Math.min(WINDOW, items.length);
  const view = Array.from({ length: size }, (_, k) => items[(offset + k) % items.length]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div key={offset} className={cn("space-y-0", !reduce && "dash-wire-in")}>
        {view.map((a) => (
          <a
            key={a.article_id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block py-2.5 border-b border-border-subtle last:border-0"
          >
            <TickerPct ticker={a.identifier} quote={quotes[a.identifier]} />
            <p className="font-display text-[14px] font-medium text-espresso leading-[1.3] mt-1 group-hover:text-gold-dark transition-colors line-clamp-2">
              {a.title}
              <ExternalLink size={9} className="inline ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
            </p>
            <span className="font-data text-[9.5px] text-text-faint tabular-nums">
              {a.source} · {timeAgo(a.published_at)}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * WatchlistFeed — "The Watch" newsroom block, one integrated tile per the
 * mockup: the auto-revolving Lead deck beside the compact revolving wire
 * column, with the Fresh-on-your-radar cards (passed in via `fresh`) along the
 * bottom. Feed refetches every REFRESH_MS so newer stories rotate in.
 */
export function WatchlistFeed({
  riseDelay = 0,
  fresh,
}: { riseDelay?: number; fresh?: ReactNode } = {}) {
  const [articles, setArticles] = useState<WatchlistArticle[]>([]);
  const [identifiers, setIdentifiers] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/watchlist-feed");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const arts: WatchlistArticle[] = json.articles ?? [];
        setArticles(arts);
        setIdentifiers(json.identifiers ?? []);

        // One batched quote call for the tickers we actually render, so the
        // wire and the lead can show real day change. Ticker-shaped
        // identifiers only (the quote API takes equity symbols).
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
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Deck: the top relevance stories (the story moving your names). Wire: the
  // whole remainder of the feed, recency-first and identifier-interleaved so
  // varied names surface instead of one ticker repeated.
  const deck = articles.slice(0, DECK_N);
  const wireItems = useMemo(
    () => interleaveByIdentifier(articles.slice(DECK_N)),
    [articles],
  );

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
          {/* Newsroom row: Lead deck | wire column. */}
          <div className={cn("grid grid-cols-1 gap-x-7 gap-y-5", wireItems.length > 0 && "md:grid-cols-[1.45fr_1fr]")}>
            {deck.length > 0 && (
              <div className="min-w-0">
                <div className="flex items-baseline gap-2.5 mb-2.5">
                  <span className="font-data text-[10px] tracking-[0.12em] text-gold-dark uppercase">
                    Lead
                  </span>
                  <span className="flex-1 h-px bg-border-subtle" />
                  <span className="font-display italic text-[11px] text-text-muted">
                    the story moving your names
                  </span>
                </div>
                <WatchDeck deck={deck} quotes={quotes} />
              </div>
            )}

            {wireItems.length > 0 && (
              <div className="min-w-0">
                <div className="flex items-baseline gap-2.5 mb-2.5">
                  <span className="font-data text-[10px] tracking-[0.12em] text-gold-dark uppercase">
                    The wire
                  </span>
                  <span className="flex-1 h-px bg-border-subtle" />
                  <span className="font-display italic text-[11px] text-text-muted">
                    more from your watch
                  </span>
                </div>
                <WireReel items={wireItems} quotes={quotes} />
              </div>
            )}
          </div>

          {/* Fresh on your radar — passed in so the newsroom stays one block. */}
          {fresh}
        </>
      )}
    </div>
  );
}
