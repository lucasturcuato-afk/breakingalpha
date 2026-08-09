-- 0024_disk_io_indexes.sql
--
-- HAND-APPLY. Creates disk-IO headroom ahead of the per-generation retrieval
-- layer. Pairs with the query changes in backend/embedding_job.py and
-- backend/ingest.py, which are NOT dependent on this file (they are strictly
-- better either way); these indexes are what makes the remaining scan-shaped
-- queries index-served instead of sequential.
--
-- SYMPTOM. Supabase warns "Disk IO Budget about to deplete" (baseline 5 MB/s
-- once burst credits are exhausted). sql/0023 already documents what this looks
-- like from the application side: 57014 statement timeouts on the Top Stories
-- query, the same query alternating between ~0.4s and >3.5s within seconds.
--
-- EVERY STATEMENT IS CONCURRENTLY. That takes no write lock, so ingest and the
-- app keep running during the build, but it CANNOT run inside a transaction
-- block. In the Supabase SQL editor, run each statement ON ITS OWN. Re-running
-- is a no-op thanks to IF NOT EXISTS.
--
-- Index builds on a large articles table take minutes and consume IO while they
-- run. Build them one at a time, off-peak, ideally not during a pipeline run.
--
-- SECTION 1 IS SKIPPED. articles.url already has a unique index
-- (articles_url_key), so idx_articles_url would be a duplicate. Verified
-- 2026-08-08. See section 1 and docs/runbooks/ci-hardening-and-hand-apply-sql.md.
--
-- Sections:
--   0. VERIFY FIRST (read-only) -- decides which of the rest you actually need
--   1. articles.url            -- SKIP, duplicate of articles_url_key
--   2. trigram indexes         -- leading-wildcard ILIKE (Radar/watchlist)
--   3. jsonb GIN indexes       -- taxonomy containment (Radar follows)
--   4. morning_brief_calls     -- prerequisite for outcome retrieval
--   5. OPTIONAL / conditional  -- only if the VERIFY step says so
--   6. MEASURE AFTER           -- read-only, proves the change


-- ===========================================================================
-- 0. VERIFY FIRST. All read-only. Run these before applying anything.
-- ===========================================================================

-- 0a. Is sql/0023 actually applied? It is marked HAND-APPLY and nothing in the
--     repo can confirm it. If these two rows are MISSING, apply 0023 before
--     anything here: every articles query is scanning today and 0023 is the
--     single biggest fix available.
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'articles'
--      AND indexname IN ('idx_articles_top_stories', 'idx_articles_ingested_at');

-- 0b. Table sizes. These numbers decide whether section 5 is worth it.
--
--   SELECT relname,
--          n_live_tup,
--          pg_size_pretty(pg_total_relation_size(relid)) AS total
--     FROM pg_stat_user_tables
--    WHERE relname IN ('articles','content_embeddings','theses',
--                      'morning_brief_calls','company_mentions')
--    ORDER BY pg_total_relation_size(relid) DESC;

-- 0c. Who is actually scanning. This is the ranked list of offenders and it
--     settles every "might seq-scan" guess empirically.
--
--   SELECT relname, seq_scan, seq_tup_read, idx_scan,
--          CASE WHEN seq_scan > 0 THEN seq_tup_read / seq_scan ELSE 0 END
--            AS avg_rows_per_seq_scan
--     FROM pg_stat_user_tables
--    ORDER BY seq_tup_read DESC
--    LIMIT 10;

-- 0d. Does articles.url already have an index (likely via a UNIQUE constraint)?
--     If this returns a row, SKIP section 1 -- a duplicate index is pure waste.
--
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'articles' AND indexdef ILIKE '%(url%';

-- 0e. Autovacuum health on content_embeddings. If last_autovacuum is old and
--     n_dead_tup is large, index-only scans there fall back to heap fetches on
--     rows carrying a 768-dim vector. A plain VACUUM is then cheaper than any
--     index below.
--
--   SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, last_vacuum
--     FROM pg_stat_user_tables WHERE relname = 'content_embeddings';


-- ===========================================================================
-- 1. articles.url -- SKIP. RESOLVED 2026-08-08: DO NOT CREATE THIS INDEX.
-- ===========================================================================
--
--   *** SKIP THIS ENTIRE SECTION. idx_articles_url IS A DUPLICATE. ***
--
-- Step 0d has been answered. public.articles.url ALREADY carries a unique
-- btree index named `articles_url_key`, created implicitly by its UNIQUE
-- constraint. idx_articles_url below would be a second, functionally identical
-- btree on the same column: pure waste. It costs disk and it costs write IO on
-- every ingest insert, on the exact table whose IO budget this file exists to
-- protect, and the planner would keep choosing articles_url_key regardless.
--
-- The dedup probe described below is ALREADY index-served by articles_url_key.
-- There is nothing to do here.
--
-- Original rationale, kept for the record: backend/ingest.py no longer reads
-- every url ingested in the last 30 days. It probes
-- `url IN (<this run's pool>) AND ingested_at >= cutoff` in bounded chunks.
-- That probe is only cheap if url is indexed. It is. See articles_url_key.
--
-- Confirm for yourself before skipping (read-only, expect one row named
-- articles_url_key):
--
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'articles'
--      AND indexdef ILIKE '%(url%';
--
-- The statement below is left commented out ON PURPOSE so that a future
-- copy-paste of this file cannot create the duplicate by accident. Do not
-- uncomment it unless the query above returns ZERO rows.
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_url
--   ON public.articles (url);


-- ===========================================================================
-- 2. Trigram indexes -- leading-wildcard ILIKE.
-- ===========================================================================
-- src/lib/radar-following.ts and src/lib/watchlist-utils.ts both build
--   .or("primary_company.ilike.%TERM%,title.ilike.%TERM%")
-- A btree index CANNOT serve a leading wildcard, so these are scan-and-filter
-- today. They run ONCE PER FOLLOW on every Radar page load (the route is
-- force-dynamic, uncached), and again per follow inside embedding_job's
-- priority tier. This is the user-facing offender.
--
-- TRADEOFF, stated honestly: GIN trigram indexes are large (often comparable to
-- the indexed column) and they add write cost on a table that bulk-inserts
-- hundreds of rows per pipeline run. GIN's fastupdate pending list keeps that
-- cost low in practice. If disk SPACE is as tight as disk IO, apply the
-- primary_company one first and measure before adding title.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_primary_company_trgm
  ON public.articles USING gin (primary_company gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_title_trgm
  ON public.articles USING gin (title gin_trgm_ops);


-- ===========================================================================
-- 3. JSONB containment -- taxonomy follows.
-- ===========================================================================
-- radar-following.ts matchTaxonomy does
--   .contains("industry_verticals", '["Technology"]')   -- jsonb @> jsonb
-- industry_verticals and activity_types are JSONB arrays (see CLAUDE.md), and
-- containment without a GIN index is scan-and-filter. jsonb_path_ops is the
-- right opclass here: it is smaller and faster than the default for pure @>
-- containment, which is the only operator these columns are queried with.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_industry_verticals_gin
  ON public.articles USING gin (industry_verticals jsonb_path_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_activity_types_gin
  ON public.articles USING gin (activity_types jsonb_path_ops);


-- ===========================================================================
-- 4. morning_brief_calls.target_symbol
-- ===========================================================================
-- The table has indexes on brief_date, brief_id, resolve_on and is_lead, but
-- none on target_symbol. That is the join key for symbol-scoped outcome
-- retrieval ("prior calls on AAPL and how they resolved"). Cheap now, and a
-- prerequisite rather than an optimization.
--
-- The table is small today, so this changes little on its own; it is here so
-- the retrieval layer never introduces a scan as it grows.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mbc_target_symbol
  ON public.morning_brief_calls (target_symbol);


-- ===========================================================================
-- 5. OPTIONAL / CONDITIONAL -- do not apply blindly.
-- ===========================================================================
-- backend/pattern_memory.py and backend/source_credibility.py both read
--   theses WHERE outcome IS NOT NULL
-- and the only related index (theses_expired_locked_idx) is partial on the
-- OPPOSITE predicate (WHERE outcome IS NULL), so it cannot serve this.
--
-- APPLY ONLY IF step 0b shows theses above roughly 50k rows. Below that a seq
-- scan of a narrow table is cheaper than maintaining another index, and these
-- two jobs run once daily, not per request. Every index has a write cost; do
-- not add this one on faith.
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_theses_graded
--   ON public.theses (generated_at DESC)
--   WHERE outcome IS NOT NULL;


-- ===========================================================================
-- 6. MEASURE AFTER. All read-only.
-- ===========================================================================

-- 6a. Radar keyword follow. BEFORE: Seq Scan on articles with a Filter and a
--     large "Rows Removed by Filter". AFTER: Bitmap Index Scan on
--     idx_articles_title_trgm / idx_articles_primary_company_trgm.
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id, title, source, summary, url, published_at,
--          industry_verticals, activity_types, primary_company
--     FROM public.articles
--    WHERE (primary_company ILIKE '%Nvidia%' OR title ILIKE '%Nvidia%')
--      AND published_at >= now() - interval '7 days'
--    ORDER BY published_at DESC
--    LIMIT 8;

-- 6b. Taxonomy follow. BEFORE: Seq Scan. AFTER: Bitmap Index Scan on
--     idx_articles_industry_verticals_gin.
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM public.articles
--    WHERE industry_verticals @> '["Technology"]'::jsonb
--      AND published_at >= now() - interval '7 days'
--    ORDER BY published_at DESC
--    LIMIT 12;

-- 6c. The new ingest dedup probe. Expect an Index Scan on idx_articles_url
--     (or the pre-existing unique index) and a tiny buffer count. Substitute
--     real urls from a recent run.
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT url FROM public.articles
--    WHERE url IN ('https://example.com/a','https://example.com/b')
--      AND ingested_at >= now() - interval '30 days';

-- 6d. The membership probe that replaced the full content_embeddings pull.
--     Expect an Index Scan / Index Only Scan on the
--     UNIQUE(content_type, content_id) index. Compare its `shared read` count
--     against the old full-table pull:
--
--     OLD (do NOT leave running on a busy instance -- this is the pattern the
--     change removed, shown only so the two buffer counts are comparable):
--       EXPLAIN (ANALYZE, BUFFERS)
--       SELECT content_id FROM public.content_embeddings
--        WHERE content_type = 'article' LIMIT 1000 OFFSET 54000;
--
--     NEW:
--       EXPLAIN (ANALYZE, BUFFERS)
--       SELECT content_id FROM public.content_embeddings
--        WHERE content_type = 'article'
--          AND content_id IN ('<uuid>','<uuid>','<uuid>');

-- 6e. Confirm the new indexes are actually being chosen. idx_scan should climb
--     over the following days; anything stuck at 0 is dead weight worth
--     dropping.
--
--   SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
--     FROM pg_stat_user_indexes
--    WHERE indexrelname IN ('articles_url_key',
--                           'idx_articles_title_trgm',
--                           'idx_articles_primary_company_trgm',
--                           'idx_articles_industry_verticals_gin',
--                           'idx_articles_activity_types_gin',
--                           'idx_mbc_target_symbol')
--    ORDER BY idx_scan DESC;
