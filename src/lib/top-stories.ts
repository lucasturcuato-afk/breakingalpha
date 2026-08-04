import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type StaleRepublishMode,
  type StaleVerdict,
  resolveStaleRepublishMode,
} from "./stale-republish.ts";
import { queryRows } from "./supabase-query.ts";

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
export const SAME_EVENT_WINDOW_HOURS = 48;

export const TOP_STORIES_COLUMNS =
  "id, title, source, summary, content, sector, industry_verticals, activity_types, sentiment, sentiment_reason, relevance_reason, published_at, ingested_at, url, companies, primary_company, relevance_score";

// RANKING COLUMNS: everything the sort, the recency filters and
// collapseSameEvent need, and nothing else.
//
// The full column list carries `content` (whole article bodies) and `summary`.
// Postgres materializes those payloads through the top-N sort, which is what
// pushed this query past the statement timeout on a cold cache: measured 1.54s
// average and 2.8s+ spikes with content, versus 0.38s without. So ranking runs
// on these light columns and the ~4 survivors are hydrated by id afterwards.
// Two round trips, a quarter of the latency, and no behavior change: the
// ordering keys and the collapse inputs are identical.
export const TOP_STORIES_RANK_COLUMNS =
  "id, title, source, published_at, ingested_at, relevance_score, primary_company";

/**
 * The subset of a row that ranking and same-event collapse actually read.
 * TopStoryRow extends it, so collapseSameEvent works on either a light
 * ranking row or a fully hydrated one.
 */
export interface TopStoryRankRow {
  id: string;
  title: string | null;
  source: string | null;
  published_at: string | null;
  ingested_at: string;
  primary_company: string | null;
  relevance_score: number | null;
}

export interface TopStoryRow extends TopStoryRankRow {
  id: string;
  title: string | null;
  source: string | null;
  summary: string | null;
  content: string | null;
  sector: string | null;
  industry_verticals: string[] | null;
  activity_types: string[] | null;
  sentiment: string | null;
  // One-sentence "why it matters" rationales written per-article at ingest.
  // sentiment_reason names the event sentiment anchored on; relevance_reason
  // leads with the market implication. Either can be null on older rows.
  sentiment_reason: string | null;
  relevance_reason: string | null;
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
// Exported so client surfaces (dashboard hero peers, Fresh-on-radar) can derive
// a story's ticker without duplicating the parse.
export const parseSourceTicker = (source: string | null): string | null => {
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

const withinSameEventWindow = (a: TopStoryRankRow, b: TopStoryRankRow): boolean => {
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

interface DecoratedRow<T extends TopStoryRankRow> {
  row: T;
  ticker: string | null;
  subject: string | null;
  toks: Set<string>;
  idx: number;
}

// Deterministic keep-which: highest relevance_score, then the more complete
// headline, then earliest published, then lowest id as a total-order tiebreak.
const keepWhichReplaces = (candidate: TopStoryRankRow, current: TopStoryRankRow): boolean => {
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
export function collapseSameEvent<T extends TopStoryRankRow>(rows: T[]): T[] {
  const decorated: DecoratedRow<T>[] = rows.map((row, idx) => ({
    row,
    idx,
    ticker: parseSourceTicker(row.source),
    subject: subjectKey(row.primary_company),
    toks: titleTokens(row.title),
  }));

  const clusters: DecoratedRow<T>[][] = [];
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
    .map((cluster) => ({
      firstIdx: Math.min(...cluster.map((m) => m.idx)),
      survivor: cluster.reduce((best, curr) =>
        keepWhichReplaces(curr.row, best.row) ? curr : best,
      ).row,
    }))
    .sort((a, b) => a.firstIdx - b.firstIdx)
    .map((c) => c.survivor);
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
 * THROWS on a failed read (QueryFailedError), and retries once on a statement
 * timeout first. It used to return [] on error, which the dashboard rendered
 * as "No stories yet. Stories will appear once articles are ingested by the
 * pipeline" - a confident, wrong claim about the pipeline for what was really
 * a database timeout. Emptiness must come from a query that succeeded.
 */
export async function fetchTopStories(supabase: SupabaseClient): Promise<TopStoryRow[]> {
  const publishedCeiling = hoursAgo(TOP_STORIES_MAX_AGE_DAYS * 24);

  /** One ranking tier: light columns only, ordered and capped identically. */
  const rankTier = (ingestedFloor: string) =>
    queryRows<TopStoryRankRow>(
      () =>
        supabase
          .from("articles")
          .select(TOP_STORIES_RANK_COLUMNS)
          .gte("ingested_at", ingestedFloor)
          .gte("published_at", publishedCeiling)
          .order("relevance_score", { ascending: false })
          .order("ingested_at", { ascending: false })
          .order("published_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .limit(TOP_STORIES_CANDIDATE_LIMIT),
      "Top Stories ranking",
    );

  // Collapse same-event near-duplicates, then trim to the rendered count. The
  // over-fetch above means removing a duplicate backfills the next distinct
  // story rather than shortening the list. The MIN_RESULTS gate checks the
  // count of distinct stories, so a primary window thinned by collapse widens
  // to the fallback the same way an ingest drought does.
  const primaryRows = collapseSameEvent(
    await rankTier(hoursAgo(TOP_STORIES_PRIMARY_WINDOW_HOURS)),
  );

  let chosen = primaryRows;
  if (primaryRows.length < TOP_STORIES_MIN_RESULTS) {
    // Thin primary window (ingest drought longer than the surfacing window):
    // widen the ingested_at floor to the ceiling. published_at stays pinned to
    // the same ceiling, so nothing older than TOP_STORIES_MAX_AGE_DAYS enters.
    const fallbackRows = collapseSameEvent(await rankTier(publishedCeiling));
    // The fallback window is a superset of the primary, so after the identical
    // collapse it returns at least as many distinct stories; prefer it when it
    // does.
    if (fallbackRows.length >= primaryRows.length) chosen = fallbackRows;
  }

  const winners = chosen.slice(0, TOP_STORIES_LIMIT);
  if (winners.length === 0) return [];

  // Hydrate the survivors only. Keyed by id, so the heavy columns never pass
  // through a sort; the ranking above already fixed the order, which this
  // restores after PostgREST returns the rows in its own order.
  const hydrated = await queryRows<TopStoryRow>(
    () =>
      supabase
        .from("articles")
        .select(TOP_STORIES_COLUMNS)
        .in("id", winners.map((r) => r.id)),
    "Top Stories hydration",
  );
  const byId = new Map(hydrated.map((r) => [r.id, r]));
  // A winner missing from the hydration (deleted between the two reads) is
  // dropped rather than rendered from the partial ranking row.
  return winners.map((w) => byId.get(w.id)).filter((r): r is TopStoryRow => !!r);
}

// ---------------------------------------------------------------------------
// STALE-REPUBLISH RANK PENALTY (DEFAULT OFF -- Lucas-reviewed core ranking)
// ---------------------------------------------------------------------------
//
// CORE-RANKING FLAG: this is the active-path rank hook for the stale-republish
// detector (src/lib/stale-republish.ts). It is gated on STALE_REPUBLISH_MODE and
// is a strict no-op unless mode === "active". In off/shadow (shadow is the
// default) applyStaleRankPenalty returns the input rows untouched and in the
// SAME order, so merging this changes prod ranking by zero. Flipping to active
// is a human (Lucas) decision; see the recon doc Phase D.
//
// WHY A PENALTY, NOT JUST RE-DATING. fetchTopStories orders by relevance_score
// first. A stale republish carries a SATURATED relevance_score (the canonical
// YYGH case is relevance 10), so correcting its displayed recency to the inferred
// event date does NOT sink it: a relevance-10 row stays at the top of a
// relevance-primary sort regardless of its date. Only a targeted rank penalty,
// keyed on the CORRECTED (inferred) date, de-pins it. This is exactly the residual
// the signal-blend freshness penalty (article-signal-score.ts eventAgeDays) calls
// out as unhandled "the republish-dated-today case".
//
// HOW. For each flagged row we compute an effective-age penalty from the inferred
// event date (days stale * PENALTY_PER_STALE_DAY) and subtract it from an
// effective relevance used ONLY for re-sorting here (the stored relevance_score is
// never mutated). A row inferred to be 6 days stale drops by 6 * 1.5 = 9 points,
// pushing a relevance-10 republish below fresh relevance-7+ content. The sort is
// stable and total-ordered (id asc final key) so it is deterministic.

// Per stale-day relevance penalty. Sized so a multi-day-stale republish (the
// YYGH 6-day case) sinks below the fresh top band, while a 1-day re-date barely
// perturbs ordering. Tune in the shadow window before flipping.
export const PENALTY_PER_STALE_DAY = 1.5;

/** Days between the inferred event date and now, floored at 0. */
function staleDays(inferredEventDate: string | null): number {
  if (!inferredEventDate) return 0;
  const ms = Date.now() - new Date(`${inferredEventDate}T00:00:00.000Z`).getTime();
  const d = ms / 86_400_000;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/**
 * Re-rank rows applying the stale-republish penalty. PURE NO-OP unless
 * mode === "active": in off/shadow it returns the input array order unchanged.
 * `verdicts` maps article id -> Layer 1 verdict (computed by the caller via
 * evaluateStaleRepublish). Only rows whose verdict is stale are penalized; all
 * others keep their effective relevance. Stable, deterministic ordering.
 */
export function applyStaleRankPenalty(
  rows: TopStoryRow[],
  verdicts: Map<string, StaleVerdict>,
  mode: StaleRepublishMode = resolveStaleRepublishMode(),
): TopStoryRow[] {
  if (mode !== "active") return rows;
  const effRelevance = (row: TopStoryRow): number => {
    const base = row.relevance_score ?? -Infinity;
    const v = verdicts.get(row.id);
    if (v?.stale && v.inferredEventDate) {
      return base - PENALTY_PER_STALE_DAY * staleDays(v.inferredEventDate);
    }
    return base;
  };
  // Decorate with the original index to make the sort stable and to break ties
  // exactly the way the SQL order did (relevance desc, then original order).
  return rows
    .map((row, idx) => ({ row, idx, eff: effRelevance(row) }))
    .sort((a, b) => (b.eff !== a.eff ? b.eff - a.eff : a.idx - b.idx))
    .map((d) => d.row);
}
