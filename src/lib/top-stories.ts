import type { SupabaseClient } from "@supabase/supabase-js";

// Single source of truth for the dashboard and preview "Top Stories" modules.
// relevance_score is computed once at ingest and never decayed, so ordering by
// it alone surfaces stale high-score rows. We order relevance inside a recency
// window. The cadence numbers behind these constants are measured in
// docs/recon/top-stories-reconcile.md.

// CONTENT AGE CEILING: the oldest a story will ever be shown, enforced on
// published_at in every tier. This is the single user-facing recency bound, so
// the query can never return a row older than this and there is no separate
// render cap to disagree with it. It also kills the RSS-republish path: an item
// republished today but originally published 100+ days ago has a published_at
// past this ceiling and is excluded.
export const TOP_STORIES_MAX_AGE_DAYS = 7;

// SURFACING WINDOW: how recently an item must have been ingested to qualify for
// the primary tier. Sized above the measured p95 (56.6h) and max (68.4h)
// inter-batch ingest gap so the primary path engages on a normal day and across
// a weekend instead of always deferring to the fallback.
export const TOP_STORIES_PRIMARY_WINDOW_HOURS = 72;

// When the primary tier returns fewer than this, widen only the ingested_at
// floor to the ceiling (published_at stays pinned to the ceiling).
export const TOP_STORIES_MIN_RESULTS = 3;

export const TOP_STORIES_LIMIT = 4;

export const TOP_STORIES_COLUMNS =
  "id, title, source, summary, content, sector, industry_verticals, activity_types, sentiment, published_at, ingested_at, url, companies, relevance_score";

export interface TopStoryRow {
  id: string;
  title: string | null;
  source: string | null;
  summary: string | null;
  content: string | null;
  sector: string | null;
  industry_verticals: string[] | null;
  activity_types: string[] | null;
  sentiment: string | null;
  published_at: string | null;
  ingested_at: string; // NOT NULL in the articles schema (DEFAULT now())
  url: string | null;
  companies: unknown;
  relevance_score: number | null;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

/**
 * Fetch the Top Stories list: highest relevance_score within a recency window.
 *
 * Tier 1 (primary) prefers freshly surfaced items (ingested within
 * TOP_STORIES_PRIMARY_WINDOW_HOURS). Tier 2 (fallback) runs only when the
 * primary is thin and widens the ingested_at floor to the ceiling. The
 * published_at ceiling (TOP_STORIES_MAX_AGE_DAYS) is identical in both tiers, so
 * the oldest story ever returned is bounded by that one value no matter which
 * tier serves. Both tiers order relevance_score desc with ingested_at desc as
 * the tiebreaker so fresher items win at equal score.
 *
 * Never throws: on a query error it logs and returns whatever it has (possibly
 * an empty array), so callers degrade to their EmptyState rather than crashing.
 */
export async function fetchTopStories(supabase: SupabaseClient): Promise<TopStoryRow[]> {
  const publishedCeiling = hoursAgo(TOP_STORIES_MAX_AGE_DAYS * 24);

  const primary = await supabase
    .from("articles")
    .select(TOP_STORIES_COLUMNS)
    .gte("ingested_at", hoursAgo(TOP_STORIES_PRIMARY_WINDOW_HOURS))
    .gte("published_at", publishedCeiling)
    .order("relevance_score", { ascending: false })
    .order("ingested_at", { ascending: false })
    .limit(TOP_STORIES_LIMIT);

  if (primary.error) {
    console.error("Top Stories primary query error:", primary.error.message);
    return [];
  }

  const primaryRows = (primary.data ?? []) as TopStoryRow[];
  if (primaryRows.length >= TOP_STORIES_MIN_RESULTS) return primaryRows;

  // Thin primary window (ingest drought longer than the surfacing window):
  // widen the ingested_at floor to the ceiling. published_at stays pinned to the
  // same ceiling, so nothing older than TOP_STORIES_MAX_AGE_DAYS can enter.
  const fallback = await supabase
    .from("articles")
    .select(TOP_STORIES_COLUMNS)
    .gte("ingested_at", publishedCeiling)
    .gte("published_at", publishedCeiling)
    .order("relevance_score", { ascending: false })
    .order("ingested_at", { ascending: false })
    .limit(TOP_STORIES_LIMIT);

  if (fallback.error) {
    console.error("Top Stories fallback query error:", fallback.error.message);
    return primaryRows;
  }

  const fallbackRows = (fallback.data ?? []) as TopStoryRow[];
  // The fallback window is a superset of the primary, so it returns at least as
  // many rows; prefer it when it does.
  return fallbackRows.length >= primaryRows.length ? fallbackRows : primaryRows;
}
