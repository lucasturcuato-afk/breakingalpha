-- =====================================================================
-- 0032_ingest_run_stats_freshness.sql
--
-- HAND-APPLY. Additive only: two nullable columns on ingest_run_stats.
-- No existing column is altered, dropped or backfilled.
--
-- WHY. INGEST_FRESHNESS_DAYS never filtered anything: both freshness checks
-- called datetime.fromisoformat() on RFC-822 pubDate, which raises, and the
-- except branch let the entry through. Run 32090228206 recorded 0 of 18,457
-- gnews entries skipped as stale. With the parsing fixed the gate binds for
-- the first time, and a live 2,308-entry sample puts the drop at ~59% at the
-- current 7-day setting.
--
-- These columns exist so the NEXT run answers two questions from data rather
-- than from a re-pull:
--   1. how many entries the filter actually removed (gnews_skipped_stale,
--      already present, previously always 0; and rss_skipped_stale, new), and
--   2. how close the survivors sit to the line, so the effect of retuning
--      INGEST_FRESHNESS_DAYS is predictable before it is changed.
--
-- Backend is forward-compatible: the insert in _persist_ingest_run_stats is
-- wrapped in its own try/except and prints a NOTE rather than failing the run,
-- so ingest works whether or not this has been applied.
-- =====================================================================


-- =====================================================================
-- SECTION 0 -- INSPECT. Read-only.
-- =====================================================================
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'ingest_run_stats'
--      AND column_name IN ('gnews_kept_age_buckets','rss_skipped_stale');
--     Expect ZERO rows before applying, two after.
--
--   -- the pre-fix baseline, for comparison after the next run:
--   SELECT run_started_at, gnews_entries_seen, gnews_skipped_stale, articles_stored
--     FROM public.ingest_run_stats ORDER BY run_started_at DESC LIMIT 5;
--     Every gnews_skipped_stale here should be 0. That is the defect, recorded.


-- =====================================================================
-- SECTION 1 -- the columns.
-- =====================================================================

ALTER TABLE public.ingest_run_stats
  ADD COLUMN IF NOT EXISTS gnews_kept_age_buckets jsonb,
  ADD COLUMN IF NOT EXISTS rss_skipped_stale      integer;

COMMENT ON COLUMN public.ingest_run_stats.gnews_kept_age_buckets IS
  'Age distribution of gnews entries KEPT by the freshness gate: '
  '{kept_lt_1d, kept_1_3d, kept_3_7d, kept_gt_7d, kept_no_date}. '
  'kept_gt_7d must stay 0 while INGEST_FRESHNESS_DAYS is 7; non-zero means an '
  'entry outlived the cutoff, which is a bug. Use the buckets to predict the '
  'effect of retuning the threshold without re-pulling the feeds.';

COMMENT ON COLUMN public.ingest_run_stats.rss_skipped_stale IS
  'Entries dropped as stale across all RSS feeds. Stale is the only skip '
  'reason in that loop, so it equals sum(fetched) - sum(fresh).';


-- =====================================================================
-- SECTION 2 -- VERIFY, after the next pipeline run.
-- =====================================================================
--
--   SELECT run_started_at,
--          gnews_entries_seen,
--          gnews_skipped_stale,
--          round(100.0 * gnews_skipped_stale
--                / nullif(gnews_entries_seen,0), 1) AS pct_stale,
--          rss_skipped_stale,
--          gnews_kept_age_buckets,
--          articles_stored
--     FROM public.ingest_run_stats
--    ORDER BY run_started_at DESC LIMIT 3;
--
--   EXPECT on the first run after the parsing fix ships:
--     gnews_skipped_stale     jumps from 0 to roughly 55-60% of entries_seen
--     articles_stored         falls materially against the prior run
--     gnews_kept_age_buckets  kept_gt_7d = 0
--
--   If gnews_skipped_stale is still 0, the parsing fix is not live.
--   If kept_gt_7d is above 0, the cutoff is not being applied to every entry.
