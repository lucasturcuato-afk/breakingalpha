-- 0023_top_stories_index.sql
--
-- HAND-APPLY. Fixes the dashboard "Top Stories" statement timeouts.
--
-- SYMPTOM. The dashboard hero intermittently rendered "No stories yet. Stories
-- will appear once articles are ingested by the pipeline" while the articles
-- table held thousands of fresh rows. The browser console showed the real
-- cause:
--
--     Top Stories primary query error: canceling statement due to statement
--     timeout                                                        (57014)
--
-- MEASURED. The same query alternates between ~0.4s and >3.5s within seconds,
-- and crosses the statement timeout on the slow swings. Eight consecutive runs
-- of the ranking query failed 8/8 during one degraded window and 0/6 minutes
-- earlier. A lookup by primary key stays at ~0.45s throughout, so the cost is
-- the FILTER + SORT, not the row payload.
--
-- The query (src/lib/top-stories.ts, fetchTopStories) is:
--
--     SELECT ... FROM articles
--     WHERE ingested_at >= $1 AND published_at >= $2
--     ORDER BY relevance_score DESC, ingested_at DESC, published_at DESC, id ASC
--     LIMIT 24
--
-- with no index covering either range predicate or the leading sort key, so
-- Postgres scans and sorts the table on every dashboard load.
--
-- ALREADY SHIPPED IN THE APP (this index is the durable fix, not the only one):
--   - ranking now selects only the light columns, keeping the article `content`
--     bodies out of the sort: 1.54s avg -> 0.38s avg, measured
--   - the winners are hydrated by id afterwards (index-backed, ~0.45s)
--   - statement timeouts retry with backoff
--   - a failed read now renders an error state instead of "No stories yet"
--
-- SAFE TO RUN. CREATE INDEX CONCURRENTLY does not take a write lock, so ingest
-- keeps running during the build. It cannot run inside a transaction block: if
-- you are pasting into the Supabase SQL editor, run each statement on its own.
-- Re-running is a no-op thanks to IF NOT EXISTS.

-- Primary ranking index. published_at leads because it is the always-present
-- ceiling in both tiers; relevance_score DESC then serves the leading sort key
-- so the top-N can be read straight off the index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_top_stories
  ON public.articles (published_at DESC, relevance_score DESC, ingested_at DESC);

-- The second range predicate, also used on its own by the competitor-alerts
-- and watchlist surfaces.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_ingested_at
  ON public.articles (ingested_at DESC);

-- VERIFY after applying. Expect an Index Scan (not a Seq Scan) and a total
-- runtime in the low tens of milliseconds:
--
--   EXPLAIN ANALYZE
--   SELECT id, title, source, published_at, ingested_at, relevance_score,
--          primary_company
--     FROM public.articles
--    WHERE ingested_at >= now() - interval '72 hours'
--      AND published_at >= now() - interval '7 days'
--    ORDER BY relevance_score DESC, ingested_at DESC, published_at DESC, id ASC
--    LIMIT 24;
--
-- Then reload the dashboard: Top Stories should fill on every load, and the
-- console should show no 57014 errors.
