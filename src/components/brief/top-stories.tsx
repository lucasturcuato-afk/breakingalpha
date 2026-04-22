"use client";

import { cn } from "@/lib/utils";
import { getSectorStyle } from "@/lib/sector-colors";
import type { StoryData } from "@/components/dashboard";

interface TopStoriesProps {
  stories: StoryData[];
  label?: string;
  /** Maximum stories visible; anything above is gated behind sign-in. */
  gateLimit?: number;
  onSignInPrompt?: () => void;
  watchlistTickers?: string[];
}

function sentimentDotClass(sentiment: string): string {
  const s = sentiment?.toLowerCase?.() ?? "";
  if (s === "bullish" || s === "positive") return "bg-signal-up";
  if (s === "bearish" || s === "negative" || s === "risk-off") return "bg-signal-dn";
  return "bg-text-muted";
}

function storyMatchesWatchlist(story: StoryData, tickers: string[]): boolean {
  if (!tickers || tickers.length === 0) return false;
  const upper = new Set(tickers.map((t) => t.toUpperCase()));
  return (story.tags ?? []).some((t) => upper.has(t.toUpperCase()));
}

/**
 * Top Stories — editorial numbered list treatment.
 *
 * Per row:
 * - Gold serif numeral (left column).
 * - Headline (serif bold).
 * - Meta row: sentiment dot + single sector pill + source · time (all
 *   muted 10-11px sans).
 * - Right column: "Watching" pill if story tickers intersect user's
 *   watchlist.
 *
 * Signal score + source win rate intentionally dropped from the row to
 * reduce badge soup — users can find signal score in the full article
 * detail.
 *
 * The gate behavior (showing a blurred peek + sign-in CTA for signed-out
 * users) is handled in-component via `gateLimit` + `onSignInPrompt`.
 */
export function TopStories({
  stories,
  label = "Top Stories",
  gateLimit,
  onSignInPrompt,
  watchlistTickers = [],
}: TopStoriesProps) {
  if (!stories || stories.length === 0) return null;

  const limit = gateLimit ?? stories.length;
  const visible = stories.slice(0, limit);
  const hasMore = stories.length > limit;
  const peek = hasMore ? stories[limit] : null;

  return (
    <section>
      <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted mb-3">
        {label}
      </h2>

      <ol className="rounded-xl border border-border-base bg-white dark:bg-elevated overflow-hidden">
        {visible.map((story, i) => {
          const numeral = i + 1;
          const watching = storyMatchesWatchlist(story, watchlistTickers);
          const sectorLabel = story.sector ?? null;
          const isLast = i === visible.length - 1;

          const RowInner = (
            <div
              className={cn(
                "grid grid-cols-[32px_1fr_auto] items-start gap-3 py-3.5 px-3.5",
                !isLast && "border-b border-border-subtle",
                "transition-colors duration-150 hover:bg-parchment-mid/40 dark:hover:bg-overlay",
              )}
            >
              {/* Numeral */}
              <span
                className="font-display text-[20px] font-bold leading-none pt-0.5 select-none"
                style={{ color: "var(--gold)" }}
                aria-hidden
              >
                {numeral}
              </span>

              {/* Main column */}
              <div className="min-w-0">
                <h3 className="font-display text-[15px] md:text-[16px] font-bold text-espresso dark:text-cream leading-snug">
                  {story.title}
                </h3>

                {/* Meta row: dot + sector pill + source · time */}
                <div className="flex items-center flex-wrap gap-2 mt-2">
                  <span
                    className={cn(
                      "inline-block w-[6px] h-[6px] rounded-full flex-shrink-0",
                      sentimentDotClass(story.sentiment),
                    )}
                    aria-hidden
                  />
                  {sectorLabel && (
                    <span
                      style={{ ...getSectorStyle(sectorLabel), borderRadius: "3px" }}
                      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium"
                    >
                      {sectorLabel}
                    </span>
                  )}
                  <span className="font-sans text-[11px] text-text-muted">
                    {story.source} · {story.timestamp}
                  </span>
                </div>
              </div>

              {/* Watching pill */}
              <div className="flex-shrink-0 pt-1">
                {watching && (
                  <span className="inline-flex items-center gap-1 font-sans text-[10px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5">
                    Watching
                  </span>
                )}
              </div>
            </div>
          );

          return (
            <li key={story.id}>
              {story.url ? (
                <a
                  href={story.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block no-underline text-inherit"
                >
                  {RowInner}
                </a>
              ) : (
                RowInner
              )}
            </li>
          );
        })}
      </ol>

      {/* Gate peek + CTA */}
      {hasMore && (
        <>
          {peek && (
            <div className="relative mt-2">
              <div
                style={{
                  maxHeight: "48px",
                  overflow: "hidden",
                  pointerEvents: "none",
                  userSelect: "none",
                  opacity: 0.7,
                }}
              >
                <div className="bg-white dark:bg-elevated border border-border-base rounded-xl p-3">
                  <p className="font-data text-[9px] text-text-muted">{peek.source}</p>
                  <p className="font-display text-[13px] font-bold text-espresso dark:text-cream leading-snug mt-1 line-clamp-1">
                    {peek.title}
                  </p>
                </div>
              </div>
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: "40px",
                  background: "linear-gradient(to bottom, transparent, var(--cream))",
                }}
              />
            </div>
          )}
          <div
            className="flex items-center justify-between px-3 py-2.5 mt-1 rounded-xl border"
            style={{
              background: "rgba(245, 166, 35, 0.08)",
              borderColor: "var(--gold-border)",
            }}
          >
            <span className="font-sans text-[12px]" style={{ color: "var(--gold)" }}>
              Sign in to see all {stories.length} stories
            </span>
            <button
              type="button"
              onClick={onSignInPrompt}
              className="font-sans text-[11px] font-semibold cursor-pointer ml-3 flex-shrink-0"
              style={{
                color: "var(--gold)",
                background: "none",
                border: "none",
                padding: 0,
              }}
            >
              Sign in &rarr;
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default TopStories;
