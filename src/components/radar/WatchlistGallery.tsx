"use client";

/**
 * WatchlistGallery — the Radar Watchlist sub-tab's presentation layer:
 * news-about-what-you-watch. Price is a quiet secondary detail, never
 * the hero; the hero is the entity with today's strongest story.
 *
 * Layout: hero entity (bold mono monogram on a dark panel + its top
 * story), then entity moments in an aligned 2-up grid with
 * type-distinct badges (public tickers monogram colored by move,
 * private companies serif wordmark, industries gold tag), then a
 * "No news today" collapse for quiet entities. Filters:
 * All / Public / Private / Industries.
 *
 * Purely presentational over the page's existing data (watchlist rows,
 * quotes, matched articles); management (add, pin, reorder, remove,
 * alerts, export) lives in the workspace below, unchanged.
 */

import Link from "next/link";

export interface GalleryEntry {
  id: string;
  identifier: string;
  type: string; // ticker | company | sector
  display_name?: string;
}
export interface GalleryPrice {
  price: string;
  pct: number;
}
export interface GalleryArticle {
  id: string;
  title: string;
  source?: string;
  summary?: string;
  url?: string;
  published_at?: string;
  relevance_score?: number;
}

export type GalleryFilter = "all" | "public" | "private" | "industries";

const SERIF = "var(--font-playfair-display), serif";
const DAY_MS = 86400_000;

function isRecent(a: GalleryArticle, days: number): boolean {
  if (!a.published_at) return false;
  return Date.now() - new Date(a.published_at).getTime() <= days * DAY_MS;
}

function topStory(articles: GalleryArticle[]): GalleryArticle | null {
  if (!articles.length) return null;
  return [...articles].sort(
    (a, b) =>
      (b.relevance_score ?? 0) - (a.relevance_score ?? 0) ||
      new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime(),
  )[0];
}

function monogram(identifier: string): string {
  return identifier.slice(0, 4).toUpperCase();
}

function pctColor(pct: number | undefined): string {
  if (pct == null || pct === 0) return "var(--text-muted)";
  return pct > 0 ? "var(--signal-up)" : "var(--signal-dn)";
}

/** Quiet, mono, secondary. Never the headline. */
function QuietPrice({ price }: { price?: GalleryPrice }) {
  if (!price) return null;
  return (
    <span className="font-mono text-[11px]" style={{ color: pctColor(price.pct) }}>
      {price.pct > 0 ? "+" : ""}
      {price.pct.toFixed(2)}%
    </span>
  );
}

function TypeBadge({ entry, price }: { entry: GalleryEntry; price?: GalleryPrice }) {
  if (entry.type === "ticker") {
    return (
      <span
        className="inline-flex h-9 min-w-9 items-center justify-center rounded-md px-1.5 font-mono text-[13px] font-bold text-cream"
        style={{ backgroundColor: pctColor(price?.pct) }}
        title={entry.display_name ?? entry.identifier}
      >
        {monogram(entry.identifier)}
      </span>
    );
  }
  if (entry.type === "sector") {
    return (
      <span
        className="inline-flex h-9 items-center rounded-md px-2 text-[11px] font-semibold uppercase tracking-wide text-espresso"
        style={{ backgroundColor: "var(--gold)" }}
      >
        {entry.identifier}
      </span>
    );
  }
  // Private company: serif wordmark.
  return (
    <span
      className="inline-flex h-9 items-center text-text-primary"
      style={{ fontFamily: SERIF, fontSize: "16px", fontWeight: 600 }}
    >
      {entry.display_name ?? entry.identifier}
    </span>
  );
}

export function WatchlistGallery({
  entries,
  prices,
  articlesByIdentifier,
  filter,
  onFilterChange,
  onFocus,
}: {
  entries: GalleryEntry[];
  prices: Record<string, GalleryPrice>;
  articlesByIdentifier: Record<string, GalleryArticle[]>;
  filter: GalleryFilter;
  onFilterChange: (f: GalleryFilter) => void;
  onFocus: (identifier: string) => void;
}) {
  const filtered = entries.filter((e) =>
    filter === "all"
      ? true
      : filter === "public"
        ? e.type === "ticker"
        : filter === "private"
          ? e.type === "company"
          : e.type === "sector",
  );

  const withNews = filtered
    .map((e) => ({
      entry: e,
      articles: (articlesByIdentifier[e.identifier] ?? []).filter((a) => isRecent(a, 2)),
    }))
    .filter((x) => x.articles.length > 0)
    .sort((a, b) => b.articles.length - a.articles.length);

  const quiet = filtered.filter(
    (e) => !withNews.some((x) => x.entry.identifier === e.identifier),
  );

  const hero = withNews[0] ?? null;
  const moments = withNews.slice(1, 9);

  return (
    <section className="mb-6">
      {/* Filters */}
      <div className="mb-4 flex items-center gap-1 font-sans text-[12px]">
        {(
          [
            ["all", "All"],
            ["public", "Public"],
            ["private", "Private"],
            ["industries", "Industries"],
          ] as [GalleryFilter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => onFilterChange(key)}
            className={
              "rounded-md px-2.5 py-1 transition-colors " +
              (filter === key
                ? "bg-espresso font-semibold text-cream dark:bg-overlay dark:text-foreground"
                : "text-text-muted hover:text-text-primary")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {hero ? (
        <>
          {/* Hero entity: dark panel, monogram + top story development. */}
          <button
            onClick={() => onFocus(hero.entry.identifier)}
            className="motion-rise-in card-hover-lift block w-full rounded-xl bg-espresso px-5 py-5 text-left text-cream dark:border dark:border-border-default dark:bg-elevated"
          >
            <div className="flex items-start gap-4">
              <TypeBadge entry={hero.entry} price={prices[hero.entry.identifier]} />
              <div className="min-w-0 flex-1">
                <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-cream/60 dark:text-text-faint">
                  {hero.entry.display_name ?? hero.entry.identifier}
                  <span className="ml-2 normal-case tracking-normal">
                    <QuietPrice price={prices[hero.entry.identifier]} />
                  </span>
                </p>
                <p
                  className="mt-1.5"
                  style={{ fontFamily: SERIF, fontSize: "20px", lineHeight: 1.3, fontWeight: 600 }}
                >
                  {topStory(hero.articles)?.title}
                </p>
                <p className="mt-1.5 font-sans text-[12px] text-cream/60 dark:text-text-faint">
                  {topStory(hero.articles)?.source}
                  {hero.articles.length > 1 && ` · ${hero.articles.length - 1} more today`}
                </p>
              </div>
            </div>
          </button>

          {/* Entity moments: aligned 2-up grid. */}
          {moments.length > 0 && (
            <div className="motion-stagger mt-4 grid gap-3 md:grid-cols-2">
              {moments.map(({ entry, articles }) => {
                const story = topStory(articles);
                return (
                  <button
                    key={entry.id}
                    onClick={() => onFocus(entry.identifier)}
                    className="card-hover-lift flex items-start gap-3 rounded-lg border border-border-subtle bg-elevated px-4 py-3.5 text-left hover:border-gold"
                  >
                    <TypeBadge entry={entry} price={prices[entry.identifier]} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-2 font-sans text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        <span className="truncate">
                          {entry.display_name ?? entry.identifier}
                        </span>
                        <QuietPrice price={prices[entry.identifier]} />
                      </p>
                      <p
                        className="mt-1 text-text-primary"
                        style={{ fontFamily: SERIF, fontSize: "14px", lineHeight: 1.35, fontWeight: 600 }}
                      >
                        {story?.title}
                      </p>
                      <p className="mt-1 font-sans text-[11px] text-text-faint">
                        {story?.source}
                        {articles.length > 1 && ` · ${articles.length - 1} more`}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-border-subtle bg-elevated px-5 py-5">
          <p className="font-sans text-[13px] text-text-muted">
            {filtered.length === 0
              ? "Nothing tracked under this filter yet."
              : "No news in the last two days for anything you watch. Quiet is a real answer; the feed below holds the longer window."}
          </p>
        </div>
      )}

      {/* No-news-today collapse: names only, honest and quiet. */}
      {hero && quiet.length > 0 && (
        <p className="mt-3 font-sans text-[12px] text-text-faint">
          No news today:{" "}
          {quiet.slice(0, 12).map((e, i) => (
            <span key={e.id}>
              {i > 0 && " · "}
              <Link
                href={`/watchlist/${encodeURIComponent(e.identifier)}`}
                className="hover:text-text-primary hover:underline"
              >
                {e.display_name ?? e.identifier}
              </Link>
            </span>
          ))}
          {quiet.length > 12 && ` · +${quiet.length - 12} more`}
        </p>
      )}
    </section>
  );
}

export default WatchlistGallery;
