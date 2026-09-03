-- 0036_ingest_rss_feed_stats.sql
--
-- HAND-APPLY. Noah/Lucas apply this; agents do not apply migrations.
--
-- Ships WITH its writer in this same PR (backend/ingest.py), so the column is
-- not inert on arrival. Order of operations does not matter -- see SAFETY below.
--
-- THE GAP THIS CLOSES
-- -------------------
-- `ingest_run_stats` (sql/0028_ingest_observability.sql) instruments the Google
-- News leg thoroughly -- gnews_tickers, gnews_entries_seen, gnews_fetched,
-- gnews_skipped_stale, gnews_skipped_no_link_or_title, and specifically
-- gnews_all_stale_tickers, which 0028's own comment calls "the shape a
-- silently-dead feed takes".
--
-- The named RSS leg has none of that. `source_fetch_stats` is built per feed in
-- backend/ingest.py (fetched / fresh / stale, one entry per feed) and is then
-- used only for two things: the per-wire stdout line, and a single summed
-- `rss_skipped_stale` integer. The per-feed detail is discarded.
--
-- So a permanently broken named feed is invisible in anything queryable. It
-- prints one `RSS error <source>: ...` line among ~24 per run, contributes
-- zero articles, and the run exits 0. That is exactly how the three Reuters
-- feeds and Pitchbook sat dead in RSS_FEEDS until someone probed them by hand
-- on 2026-05-08 (see the comment above RSS_FEEDS). This is more likely to
-- matter now than it was: the feed count went from 18 to 24 on 2026-09-02, and
-- the six new ones are third-party URLs nobody controls.
--
-- A consolidated `RSS ZERO-YIELD (n/24): a, b, c` stdout line ships separately
-- (the feed-expansion PR). That makes a dead feed greppable in ONE run log. It
-- is not enough: it does not make the fact trendable, and nobody greps a log
-- they have no reason to open. "Has WSJ Business returned zero for six
-- consecutive runs" is the question that actually catches a silent death, and
-- answering it needs history. That is what this column is for.
--
-- This is live already, not hypothetical: a read-only probe of all 24 feeds on
-- 2026-09-03 found SEC 10-Q timing out at 20.05s and contributing zero, and
-- nothing queryable records that.
--
-- WHY jsonb AND NOT A CHILD TABLE
-- -------------------------------
-- Same reasoning as cross_source_clusters.members (sql/0025): the value is
-- written whole, read whole, bounded (one small object per feed, 24 feeds), and
-- a child table would add a join to a read path on an instance that is already
-- IO-constrained (sql/0024). One jsonb column is the cheap, honest shape.
--
-- SAFETY. One nullable column on a small, append-only table. No existing column
-- is altered. Either merge order is safe, verified against the code rather than
-- assumed:
--   * Column applied BEFORE the writer merges -> column stays NULL. Harmless.
--   * Writer merges BEFORE the column is applied -> the first insert fails on
--     the unknown column, and _persist_ingest_run_stats retries ONCE with
--     _STATS_OPTIONAL_KEYS removed. "rss_feed_stats" is added to that tuple in
--     this PR, so the retry succeeds and the run still records every other
--     field. That mechanism already exists for sql/0033; this reuses it rather
--     than inventing a second one.
-- In neither order can this mark the ingest step degraded: the whole writer is
-- wrapped in its own try/except and prints a NOTE instead of raising.

ALTER TABLE public.ingest_run_stats
  ADD COLUMN IF NOT EXISTS rss_feed_stats jsonb;

COMMENT ON COLUMN public.ingest_run_stats.rss_feed_stats IS
  'Per-named-feed fetch funnel for this run: '
  '{"<source>": {"fetched": N, "fresh": N, "stale": N}, ...}, one key per '
  'RSS_FEEDS entry. fetched=0 is the silently-dead-feed shape; it is also what '
  'a genuinely quiet feed looks like, so read it across runs, not on one run. '
  'Source: source_fetch_stats in backend/ingest.py fetch_all_articles().';


-- ===========================================================================
-- WRITER -- INCLUDED IN THIS PR
-- ===========================================================================
-- backend/ingest.py, in the _persist_ingest_run_stats payload:
--     "rss_feed_stats": source_fetch_stats,
-- and "rss_feed_stats" added to _STATS_OPTIONAL_KEYS.
--
-- source_fetch_stats is already built per feed in fetch_all_articles and is
-- already a plain dict of dicts of ints, so it serializes as-is. No new
-- computation, no new read, no measurable cost.


-- ===========================================================================
-- VERIFY / USE (read-only)
-- ===========================================================================
-- Column landed:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'ingest_run_stats' AND column_name = 'rss_feed_stats';
--
-- Feeds that returned nothing on each of the last 6 runs -- the query this
-- column exists to make possible:
--
--   WITH recent AS (
--     SELECT rss_feed_stats
--       FROM public.ingest_run_stats
--      WHERE rss_feed_stats IS NOT NULL
--      ORDER BY run_started_at DESC
--      LIMIT 6
--   )
--   SELECT feed,
--          count(*)                                   AS runs_seen,
--          sum((stats->>'fetched')::int)              AS total_fetched
--     FROM recent, jsonb_each(rss_feed_stats) AS f(feed, stats)
--    GROUP BY feed
--   HAVING sum((stats->>'fetched')::int) = 0
--    ORDER BY feed;
--
-- Any row returned is a feed that has produced nothing across six consecutive
-- runs. Confirm by hand before deleting it: a low-volume feed inside a quiet
-- week is indistinguishable from a dead one on this metric alone.
