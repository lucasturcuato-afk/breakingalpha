/**
 * ask-counters - the three scalar reads behind Ask's destination rows.
 *
 * Deal Flow, Trends and Live Feed each carry ONE figure and the window that
 * figure covers. Before this file the three rows carried a fixture counter in
 * development and a notice in production saying they were not wired to a
 * source. They are wired now, so the notice is gone and nothing replaces it.
 *
 * THREE READS, THREE INDEPENDENT ANSWERS. Each row's figure is its own read
 * and its own tri-state. A `null` figure is a read that FAULTED and draws no
 * number and no window at all; it is never a zero. That distinction is the
 * whole reason the shape carries a nullable string rather than a number with a
 * zero default: a zero on this screen is a claim about the corpus, and a failed
 * count is not entitled to make it.
 *
 * THE WINDOW IS PART OF THE FIGURE, NOT DECORATION, and Live Feed is why.
 * Its window resets at UTC midnight and the ingest pass runs after it, so the
 * count is legitimately 0 for several hours every day. Measured read-only
 * against production on 2026-08-30 at 04:48 UTC: 0 since 00:00 UTC, 0 over a
 * rolling 24 hours, 1,820 over 48, with the newest `ingested_at` at
 * 2026-08-29T02:08 UTC. A row that said a bare "today" and showed 0 would read
 * as broken and would not be. Naming the window makes the zero legible, and it
 * is why the label is carried beside the figure rather than implied by it.
 *
 * DEAL FLOW IS ALL TIME FOR THE SAME CLASS OF REASON. Its daily figure is
 * small and lumpy (4 since yesterday when the artboards were drawn), so a day
 * window reads 0 to 4 and looks broken on a quiet day. No weekly deal figure
 * was sourced, so the total is the honest one to draw.
 *
 * WHAT IS NOT HERE, deliberately:
 *
 *   NO TRENDS DELTA. `trend_clusters` carries `sparkline_data`, `novelty_score`
 *   and `matched_prior_cluster_keys`, and they look like they would support an
 *   "N moved". They do not: sparkline was populated for two weeks in April 2026
 *   and abandoned, every current cluster is null, and `novelty_score` is 1 on
 *   468 of 539 rows. `trend-signals.ts:166` already records that the table has
 *   no field for movement of any kind.
 *
 *   NO PER-READER FEED FIGURE. `/live-feed` never reads the `follows` table; it
 *   filters on profile sectors. "Your N followed names" has no source here.
 *
 *   NO STALENESS STAMP. Nothing here records when the pipeline last ran, and
 *   "today's pass has not run yet" is a claim about the pipeline this file
 *   cannot check. The window label carries what can be said.
 *
 * Nothing is averaged, divided or scored. All three are counts of real rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { TREND_MIN_ARTICLES, TREND_MIN_SOURCES } from "@/lib/trend-signals";

export type AskCounterId = "deals" | "trends" | "feed";

export interface AskCounter {
  /**
   * The figure, already grouped for display. Null when the read FAULTED, and a
   * faulted read draws nothing rather than a zero.
   */
  figure: string | null;
  /** The window the figure covers, spelled out beside it. Never implied. */
  window: string;
}

export type AskCounters = Record<AskCounterId, AskCounter>;

/**
 * The three windows, in one place, so the label and the query cannot drift
 * apart. Every one of these is a description of the predicate directly below
 * it in `loadAskCounters`, and an edit to one is an edit to both.
 */
export const COUNTER_WINDOWS: Record<AskCounterId, string> = {
  deals: "all time",
  trends: "new this week",
  feed: "since 00:00 UTC",
};

/** Seven days back from the anchor, matching `trendCounts`'s own window. */
export function weekFloor(now: number = Date.now()): string {
  return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
}

/** The current UTC day boundary. The window the Live Feed figure names. */
export function utcDayFloor(now: number = Date.now()): string {
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  return midnight.toISOString();
}

/**
 * Group a count for display. Fixed to en-US rather than the server's locale:
 * this string is built on the server and shipped in the payload, so a host
 * whose locale groups differently would put one separator in the HTML and
 * another in the hydration pass.
 */
export function groupCount(n: number): string {
  return n.toLocaleString("en-US");
}

function figureOf(res: { count: number | null; error: { message: string } | null }, id: AskCounterId): string | null {
  if (res.error) {
    console.error(`[ask-counters] ${id} count`, res.error.message);
    return null;
  }
  /* A read that answered with no rows is a real zero and is drawn as one. Only
     a faulted read is null. `count` is nullable in the client's own types even
     on success, and a successful head request that somehow carried no count is
     not a zero either, so it takes the same branch as a fault. */
  return res.count === null ? null : groupCount(res.count);
}

/**
 * Read all three, in parallel, head-only.
 *
 * `head: true` with `count: "exact"` sends no rows over the wire at all, which
 * is what makes three counts affordable on a server render that already awaits
 * the company directory. Measured against production, cold, on 2026-08-30:
 * 322ms, 394ms and 261ms respectively, run concurrently.
 *
 * THE TRENDS PREDICATE IS IMPORTED, NOT COPIED. `TREND_MIN_ARTICLES` and
 * `TREND_MIN_SOURCES` define which clusters count as worth showing, and the
 * mobile Trends screen filters on the same two. A copy here would let "28 new
 * this week" on Ask mean something different from what /trends-mobile lists.
 *
 * It reproduces `trendCounts(...).newThisWeek` (`trend-signals.ts:169-183`)
 * exactly, as a count rather than as a row fetch: that function counts clusters
 * whose `created_at` falls inside seven days among the clusters the screen
 * fetched, and the screen's fetch is the same two predicates under a 500 row
 * cap that 462 qualifying clusters do not reach. Checked both ways against
 * production on 2026-08-30: fetch-and-derive gives 28, this head count gives
 * 28. Pulling 462 rows to count 28 of them on a server render is the thing
 * being avoided.
 */
export async function loadAskCounters(
  sb: SupabaseClient,
  now: number = Date.now(),
): Promise<AskCounters> {
  const [deals, trends, feed] = await Promise.all([
    sb.from("deal_flow").select("id", { count: "exact", head: true }),
    sb
      .from("trend_clusters")
      .select("id", { count: "exact", head: true })
      .gte("article_count", TREND_MIN_ARTICLES)
      .gte("source_count", TREND_MIN_SOURCES)
      .gte("created_at", weekFloor(now)),
    sb
      .from("articles")
      .select("id", { count: "exact", head: true })
      .gte("ingested_at", utcDayFloor(now)),
  ]);

  return {
    deals: { figure: figureOf(deals, "deals"), window: COUNTER_WINDOWS.deals },
    trends: { figure: figureOf(trends, "trends"), window: COUNTER_WINDOWS.trends },
    feed: { figure: figureOf(feed, "feed"), window: COUNTER_WINDOWS.feed },
  };
}
