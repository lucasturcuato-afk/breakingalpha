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

// Over-fetch this many candidates before same-event collapse so that removing a
// duplicate can pull the next distinct story up and the rendered list still
// fills to TOP_STORIES_LIMIT. With no duplicates present, the first
// TOP_STORIES_LIMIT survivors equal the previous top rows, so the common path is
// unchanged. Sized well above LIMIT because the top relevance band is saturated
// (a large block ties at the max score) and same-event syndications cluster
// inside it. See docs/recon/top-stories-dedup.md.
export const TOP_STORIES_CANDIDATE_LIMIT = 24;

// Same-event near-duplicate collapse (render-time). Two candidates are the same
// event when they share a parsed source-ticker, were published within
// SAME_EVENT_WINDOW_HOURS of each other, and their titles have a token Jaccard
// >= SAME_EVENT_TITLE_SIMILARITY. The 0.50 threshold is measured: 93.6% of
// same-ticker pairs score < 0.3 (distinct stories sharing only the company
// name), while genuine syndications of one event begin around 0.5 (the
// canonical VCTR AUM pair computes to exactly 0.50). See
// docs/recon/top-stories-dedup.md for the distribution and false-collapse
// analysis. The tokeniser mirrors src/lib/clustering-utils.ts.
export const SAME_EVENT_TITLE_SIMILARITY = 0.5;
// A1 republish fix: widened from 48h to the content-age ceiling. The 0.5 Jaccard
// gate is the real same-event discriminator (distinct same-ticker stories score
// < 0.3; only syndications of ONE event reach 0.5). The old 48h window let a
// stale event re-emitted with a fresh feed pubDate days later escape collapse and
// surface as a separate "today" card. Since every candidate is already bounded to
// the published_at ceiling, "within the ceiling" means any two same-ticker,
// same-subject, title-similar rows in the pool collapse regardless of the
// intra-window gap. FORK (morning review): this trades a slightly larger
// false-merge exposure window (two genuinely distinct same-company events < 7d
// apart that also clear 0.5 Jaccard) for closing the republish-staleness vector.
// Reversible by restoring 48. See docs/recon/dashboard-display-fix.md.
export const SAME_EVENT_WINDOW_HOURS = TOP_STORIES_MAX_AGE_DAYS * 24;

export const TOP_STORIES_COLUMNS =
  "id, title, source, summary, content, sector, industry_verticals, activity_types, sentiment, published_at, ingested_at, url, companies, primary_company, relevance_score";

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
  primary_company: string | null; // the subject company an article is ABOUT
  relevance_score: number | null;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

// Ticker embedded in the Google News source label, e.g. "Google News (VCTR)".
// Null for non-gnews sources, which then never cluster and pass through as-is.
const parseSourceTicker = (source: string | null): string | null => {
  if (!source) return null;
  const m = source.match(/Google News \(([^)]+)\)/);
  return m ? m[1] : null;
};

// Tokeniser matches src/lib/clustering-utils.ts: lowercase, split on non-word
// runs, keep tokens of length >= 3, set semantics.
const titleTokens = (title: string | null): Set<string> =>
  new Set((title ?? "").toLowerCase().split(/\W+/).filter((w) => w.length >= 3));

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
};

const withinSameEventWindow = (a: TopStoryRow, b: TopStoryRow): boolean => {
  if (!a.published_at || !b.published_at) return false;
  const ta = new Date(a.published_at).getTime();
  const tb = new Date(b.published_at).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) <= SAME_EVENT_WINDOW_HOURS * 60 * 60 * 1000;
};

// Title with the trailing " - Outlet" suffix removed, used as a completeness
// proxy in the keep-which rule (the more specific headline is the longer one).
const cleanedTitleLength = (title: string | null): number =>
  (title ?? "").replace(/\s+-\s+[^-]+$/, "").trim().length;

// Normalised subject company an article is ABOUT (the primary_company column),
// used as the cluster key alongside the feed ticker. Lowercased and stripped to
// alphanumerics so "Yum! Brands" and "Yum Brands" match. Null/empty subjects are
// non-clusterable: two rows collapse only when they share the SAME non-null
// subject, so different companies can never merge even when they arrive through
// the same broker/aggregator feed. See docs/recon/top-stories-dedup.md. This is
// a strict tightening; it can only prevent collapses, never create them.
const subjectKey = (primaryCompany: string | null): string | null => {
  if (!primaryCompany) return null;
  const k = primaryCompany.toLowerCase().replace(/[^a-z0-9]/g, "");
  return k.length > 0 ? k : null;
};

interface DecoratedRow {
  row: TopStoryRow;
  ticker: string | null;
  subject: string | null;
  toks: Set<string>;
  idx: number;
}

// Deterministic keep-which: highest relevance_score, then the more complete
// headline, then earliest published, then lowest id as a total-order tiebreak.
const keepWhichReplaces = (candidate: TopStoryRow, current: TopStoryRow): boolean => {
  const rc = candidate.relevance_score ?? -Infinity;
  const rk = current.relevance_score ?? -Infinity;
  if (rc !== rk) return rc > rk;
  const lc = cleanedTitleLength(candidate.title);
  const lk = cleanedTitleLength(current.title);
  if (lc !== lk) return lc > lk;
  const pc = candidate.published_at ? new Date(candidate.published_at).getTime() : Infinity;
  const pk = current.published_at ? new Date(current.published_at).getTime() : Infinity;
  if (pc !== pk) return pc < pk;
  return candidate.id < current.id;
};

/**
 * Collapse same-event near-duplicates into a single surviving row, preserving
 * input ranking. Two rows are the same event when they share the same parsed
 * feed ticker AND the same non-null subject company (primary_company), were
 * published within SAME_EVENT_WINDOW_HOURS, and have title Jaccard >=
 * SAME_EVENT_TITLE_SIMILARITY. Single-linkage greedy clustering; each cluster
 * renders its keep-which survivor at the rank of its best-placed member. Rows
 * with no parsed ticker, or no subject, never cluster, so different companies
 * arriving through one broker/aggregator feed can never merge. See
 * docs/recon/top-stories-dedup.md.
 */
export function collapseSameEvent(rows: TopStoryRow[]): TopStoryRow[] {
  const decorated: DecoratedRow[] = rows.map((row, idx) => ({
    row,
    idx,
    ticker: parseSourceTicker(row.source),
    subject: subjectKey(row.primary_company),
    toks: titleTokens(row.title),
  }));

  const clusters: DecoratedRow[][] = [];
  for (const d of decorated) {
    const target = clusters.find((cluster) =>
      cluster.some(
        (m) =>
          m.ticker !== null &&
          m.ticker === d.ticker &&
          m.subject !== null &&
          m.subject === d.subject &&
          withinSameEventWindow(m.row, d.row) &&
          jaccard(m.toks, d.toks) >= SAME_EVENT_TITLE_SIMILARITY,
      ),
    );
    if (target) target.push(d);
    else clusters.push([d]);
  }

  return clusters
    .map((cluster) => {
      const survivor = cluster.reduce((best, curr) =>
        keepWhichReplaces(curr.row, best.row) ? curr : best,
      ).row;
      // A1: the representative's DISPLAYED recency must reflect the EVENT age,
      // not the freshest republish. Stamp the survivor with the earliest
      // published_at across the cluster so timeAgo(published_at) shows when the
      // event first broke. A singleton cluster is unchanged (its own date).
      const eventPublishedAt = cluster
        .map((m) => m.row.published_at)
        .filter((p): p is string => !!p)
        .reduce<string | null>(
          (min, p) =>
            min === null || new Date(p).getTime() < new Date(min).getTime() ? p : min,
          null,
        );
      return {
        firstIdx: Math.min(...cluster.map((m) => m.idx)),
        survivor:
          eventPublishedAt && eventPublishedAt !== survivor.published_at
            ? { ...survivor, published_at: eventPublishedAt }
            : survivor,
      };
    })
    .sort((a, b) => a.firstIdx - b.firstIdx)
    .map((c) => c.survivor);
}

// A1 freshness rank: relevance_score with an event-age penalty, so a stale event
// cannot pin to the top tier and the top is no longer a flat block of
// relevance-10. Event age is read from published_at, which collapseSameEvent has
// already set to the cluster's earliest (the true event date), so a fresh-dated
// republish is penalised by the real event age. FORK (morning review): the
// 0.5/day penalty is a first cut (a same-day relevance-9 beats a 6-day
// relevance-10: 9 > 10 - 6*0.5); tune against a live top set. Reversible.
export const FRESHNESS_AGE_PENALTY_PER_DAY = 0.5;

const eventAgeDays = (publishedAt: string | null): number => {
  if (!publishedAt) return 0;
  const days = (Date.now() - new Date(publishedAt).getTime()) / (24 * 60 * 60 * 1000);
  return Number.isFinite(days) && days > 0 ? days : 0;
};

export function rankByFreshness(rows: TopStoryRow[]): TopStoryRow[] {
  const score = (r: TopStoryRow): number =>
    (r.relevance_score ?? 0) - FRESHNESS_AGE_PENALTY_PER_DAY * eventAgeDays(r.published_at);
  // Array.prototype.sort is stable, so equal-score rows keep the collapse order
  // (best-placed member first). Sort a copy to avoid mutating the input.
  return [...rows].sort((a, b) => score(b) - score(a));
}

/**
 * Fetch the Top Stories list: highest relevance_score within a recency window.
 *
 * Tier 1 (primary) prefers freshly surfaced items (ingested within
 * TOP_STORIES_PRIMARY_WINDOW_HOURS). Tier 2 (fallback) runs only when the
 * primary is thin and widens the ingested_at floor to the ceiling. The
 * published_at ceiling (TOP_STORIES_MAX_AGE_DAYS) is identical in both tiers, so
 * the oldest story ever returned is bounded by that one value no matter which
 * tier serves. Both tiers order relevance_score desc, then ingested_at desc, so
 * fresher items win at equal score. relevance_score is saturated (a large block
 * ties at the max), and ingested_at is the transaction timestamp, so a whole
 * ingest batch shares one value and cannot break ties inside the batch. Two
 * further keys de-arbitrate that within-batch block deterministically:
 * published_at desc (the publication-freshness signal; nullsFirst:false, though
 * the published_at ceiling filter already excludes nulls) and finally id asc, a
 * unique total order that makes the result identical across repeated runs. See
 * docs/recon/top-stories-freshness.md.
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
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(TOP_STORIES_CANDIDATE_LIMIT);

  if (primary.error) {
    console.error("Top Stories primary query error:", primary.error.message);
    return [];
  }

  // Collapse same-event near-duplicates, then trim to the rendered count. The
  // over-fetch above means removing a duplicate backfills the next distinct
  // story rather than shortening the list. The MIN_RESULTS gate now checks the
  // count of distinct stories, so a primary window thinned by collapse widens to
  // the fallback the same way an ingest drought does.
  const primaryRows = rankByFreshness(collapseSameEvent((primary.data ?? []) as TopStoryRow[]));
  if (primaryRows.length >= TOP_STORIES_MIN_RESULTS) return primaryRows.slice(0, TOP_STORIES_LIMIT);

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
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(TOP_STORIES_CANDIDATE_LIMIT);

  if (fallback.error) {
    console.error("Top Stories fallback query error:", fallback.error.message);
    return primaryRows.slice(0, TOP_STORIES_LIMIT);
  }

  const fallbackRows = rankByFreshness(collapseSameEvent((fallback.data ?? []) as TopStoryRow[]));
  // The fallback window is a superset of the primary, so after the identical
  // collapse it returns at least as many distinct stories; prefer it when it
  // does.
  const chosen = fallbackRows.length >= primaryRows.length ? fallbackRows : primaryRows;
  return chosen.slice(0, TOP_STORIES_LIMIT);
}
