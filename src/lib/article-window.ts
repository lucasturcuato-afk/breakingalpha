/**
 * Adaptive article window for the Company Intel article read.
 *
 * WHY THIS IS NOT A SINGLE CONSTANT
 * ---------------------------------
 * The read in `getCompanyDetail.ts` used a fixed 14-day gate on
 * `articles.published_at`. Measured on prod (2026-08-31, stratified sample of
 * 200 of the 5,599 `companies` rows, seeded draw, five mention-rank bands),
 * that gate is why most company pages render no articles at all:
 *
 *   render rate, at least 1 article      14d        whole corpus
 *   rank 1-100      (head)             100.0%          100.0%
 *   rank 101-500                        97.5%          100.0%
 *   rank 501-1500                       82.5%          100.0%
 *   rank 1501-3000                      32.5%          100.0%
 *   rank 3001-5599  (tail)              12.5%          100.0%
 *   population-weighted                 38.0%          100.0%
 *
 * The obvious fix, raising the constant, is the wrong one. The head band is
 * already truncated by ARTICLE_LIMIT: 66.7% of rank-1-100 companies have 50 or
 * more articles inside 14 days. Because the read orders by relevance_score
 * before published_at, widening the pool re-ranks the whole slate instead of
 * appending to it. Measured on six head companies, a fixed 365-day gate
 * displaced 22 to 50 of the 50 returned rows and moved the median article age
 * from 5 to 9 days out to 27 to 88 days. AMD and Amazon lost 50 of 50. That
 * turns "this week's news" into "this quarter's news" on exactly the pages that
 * work today.
 *
 * So the window escalates instead of widening. A company that already answers
 * the fast window keeps the fast window, byte for byte, and issues no extra
 * query. A company that comes back thin retries once at the wide window, where
 * the pool is small enough that the wider read is purely additive: of the
 * escalating pages in the sample, 98.0% still returned fewer than
 * ARTICLE_LIMIT rows at the wide rung, so nothing is displaced.
 *
 * WHY TWO RUNGS AND NOT MORE
 * --------------------------
 * A 14/90/365 ladder was simulated against the same sample. It reached exactly
 * the same render rates as 14/365 (100.0% and 52.8%) while raising the
 * population-weighted extra-query count from 0.78 to 1.31 per page, because the
 * article corpus is only about six months deep: a company that misses at 14
 * days usually misses at 90 too. The middle rung is pure cost today.
 *
 * WHY THE FLOOR IS 3
 * ------------------
 * `ARTICLE_FALLBACK_MIN` in `getArticleFallback.ts` already defines "too thin
 * to be a page" as fewer than 3 articles. Reusing that number keeps one
 * definition of thin. Measured: a floor of 1 and a floor of 3 both take the
 * population-weighted "at least 1 article" rate to 100.0%, but a floor of 3
 * takes "at least 3 articles" from 41.3% to 52.8% for 0.16 extra queries per
 * page.
 *
 * Latency is not the trade here and should not be argued as one. Warm medians
 * over 3 reps on the real query shape: head names ran 88 to 306 ms at 14 days
 * and 99 to 291 ms at 365 days, with the wide read faster on three of six.
 * The wide rung on a tail name ran 52 to 74 ms. The cost of escalating is one
 * sequential round trip of roughly 60 ms, paid only by pages that render
 * nothing today.
 */

/** Rung 1. Every company starts here, and a well-covered company stays here. */
export const ARTICLE_DAYS_FAST = 14;

/**
 * Rung 2. Wider than the corpus is deep (about 6 months as of 2026-08), which
 * is deliberate: it is a "give me everything" rung, not a tuned horizon, so it
 * does not silently re-narrow as the corpus ages past any fixed cutoff.
 */
export const ARTICLE_DAYS_WIDE = 365;

/**
 * Below this row count the fast rung is treated as a miss. Mirrors
 * ARTICLE_FALLBACK_MIN in getArticleFallback.ts, which is the existing
 * definition of a too-thin article tab.
 */
export const ARTICLE_MIN_ROWS = 3;

/**
 * Decide whether the fast rung's result is thin enough to retry wider.
 *
 * @param fastRowCount rows returned by the ARTICLE_DAYS_FAST read
 * @returns the wider window in days, or null to keep the fast result
 */
export function escalateArticleWindow(fastRowCount: number): number | null {
  return fastRowCount < ARTICLE_MIN_ROWS ? ARTICLE_DAYS_WIDE : null;
}

/**
 * Take the wide rung only when it is strictly additive.
 *
 * The two reads are not transactional and the wide read can lose to a
 * concurrent delete, or fail and hand back an empty array. Neither case should
 * be allowed to shrink a page that already had rows, so the wider result is
 * adopted only when it returns more rows than the fast one.
 */
export function preferWiderRows<T>(fastRows: T[], wideRows: T[]): T[] {
  return wideRows.length > fastRows.length ? wideRows : fastRows;
}
