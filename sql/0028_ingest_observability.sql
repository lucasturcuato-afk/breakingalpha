-- 0028_ingest_observability.sql
--
-- HAND-APPLY. Do not auto-run. Adds the storage behind the ingest observability
-- work: per-row relevance-score provenance, and a per-run funnel breakdown for
-- the gate and the Google News freshness leg.
--
-- SAFE TO RUN BEFORE OR AFTER THE APP DEPLOYS. Everything is additive:
--   - No existing column is altered, dropped, or backfilled.
--   - No ingest drop decision depends on anything here. The same breakdown is
--     printed to stdout whether or not this has been applied.
--   - backend/ingest.py probes for articles.relevance_grade_source once per run
--     (_grade_source_column_available) and omits it when absent, so the insert
--     batch cannot 400 on a column that does not exist yet.
--   - The ingest_run_stats insert is wrapped in its own try/except
--     (_persist_ingest_run_stats) and prints a NOTE rather than failing the run.
--
-- Section 1 and section 2 are independent. Either can be applied alone.
--
-- NOTHING IS INDEXED ON `articles`. This migration touches that table exactly
-- once, to add one nullable column. The single index here is on
-- ingest_run_stats, a brand new empty table, where the build is instant and
-- uncontended. So everything can go in a single paste, at any time, with no
-- CONCURRENTLY caveat and no off-peak window.
--
-- An earlier draft carried a partial index on articles.relevance_grade_source.
-- It was dropped: nothing in the ingest write path reads that column, so the
-- index served only the ad-hoc grouping query in section 3, which filters on
-- ingested_at and is already served by the sql/0023 and sql/0024 indexes. On a
-- table that size, adding an index no query plan asked for is a cost with no
-- reader. If the grouping query is ever measured slow, add it then.


-- ===========================================================================
-- 1. articles.relevance_grade_source
-- ===========================================================================
-- WHY. Under RELEVANCE_GRADE_MODE=new the re-anchored Flash grade is
-- authoritative, but when grade_relevance fails the row silently keeps its
-- legacy Flash-Lite score. Nothing on the row recorded that, so the stored
-- corpus mixes two scoring populations that cannot be separated after the fact
-- and the fallback rate cannot be trended. This column names the scorer that
-- produced the relevance_score the row is stored with.
--
-- VALUES (backend/ingest.py GRADE_SOURCE_* constants):
--   'grader'          re-anchored grade applied and authoritative
--   'legacy_fallback' grader failed, legacy Flash-Lite score retained  <-- the one
--   'sec_pinned'      deterministic SEC bypass, never sent to the grader
--   'legacy_skip'     GRADER_SKIP_IRRELEVANT cost guard skipped the grade
--   'legacy_mode'     RELEVANCE_GRADE_MODE was legacy|shadow, legacy authoritative
--   NULL              row predates this column, or was stored by a path that
--                     never ran apply_relevance_grade. NULL is left as NULL and
--                     never guessed: the historical mixed population stays
--                     honestly unlabelled rather than being back-filled with an
--                     assumption.
--
-- Deliberately text, not an enum: a new provenance value must not require a
-- migration before ingest can record it.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS relevance_grade_source text;

COMMENT ON COLUMN public.articles.relevance_grade_source IS
  'Which scorer produced relevance_score: grader | legacy_fallback | sec_pinned | legacy_skip | legacy_mode. NULL = unlabelled (pre-0028 or ungraded path).';

-- Adding a nullable column with no default is a catalog-only change in
-- Postgres: no table rewrite, no backfill, no long lock on a large table.


-- ===========================================================================
-- 2. ingest_run_stats
-- ===========================================================================
-- WHY. The ingest funnel existed only as stdout on one run. The gate is the
-- single biggest filter in the pipeline and logged nothing at all on its drop
-- branch; the Google News freshness leg (~88% of volume) rejected on a bare
-- `continue` with no counter. Neither could be trended, so a grader shift that
-- halved the keep rate, or a feed that went all-stale, was indistinguishable
-- from a quiet news day. One row per ingest run, written best-effort at the end
-- of run_ingestion.
--
-- Counts only. Nothing here feeds back into the pipeline; no reader of this
-- table can change what gets ingested.

CREATE TABLE IF NOT EXISTS public.ingest_run_stats (
  id                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_started_at                 timestamptz NOT NULL,
  recorded_at                    timestamptz NOT NULL DEFAULT now(),
  duration_s                     double precision,

  -- Config in effect for this run, so a shift in the numbers can be attributed
  -- to a config change rather than to the news.
  relevance_grade_mode           text,
  freshness_days                 integer,
  ingest_gate                    integer,

  -- Ingest gate funnel. gate_candidates is the post-dedup, post-filter pool the
  -- gate actually saw. gate_passed + gate_dropped = gate_candidates.
  gate_candidates                integer,
  gate_passed                    integer,
  gate_dropped                   integer,
  -- {"result_none": N, "relevant_falsy": N, "below_gate": N}. Keys mirror the
  -- gate condition's short-circuit order, so the three buckets partition
  -- gate_dropped exactly.
  gate_dropped_by_reason         jsonb,

  -- Google News freshness leg. entries_seen = fetched + skipped_stale +
  -- skipped_no_link_or_title.
  gnews_tickers                  integer,
  gnews_entries_seen             integer,
  gnews_fetched                  integer,
  gnews_skipped_stale            integer,
  gnews_skipped_no_link_or_title integer,
  -- Tickers that returned entries and kept none of them because every entry was
  -- stale. This is the shape a silently-dead feed takes: the fetch still
  -- succeeds, the ticker just contributes nothing.
  gnews_all_stale_tickers        integer,

  -- {"grader": N, "legacy_fallback": N, "sec_pinned": N, ...}. Same vocabulary
  -- as articles.relevance_grade_source. legacy_fallback is the grader failure
  -- rate for the run.
  grade_source_counts            jsonb,

  articles_stored                integer
);

CREATE INDEX IF NOT EXISTS idx_ingest_run_stats_run_started_at
  ON public.ingest_run_stats (run_started_at DESC);

ALTER TABLE public.ingest_run_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingest_run_stats_public_read ON public.ingest_run_stats;
CREATE POLICY ingest_run_stats_public_read ON public.ingest_run_stats
  FOR SELECT USING (true);
-- No write policy: writes go through the service role (backend/supabase_client.py).


-- ===========================================================================
-- 3. VERIFY (read-only)
-- ===========================================================================
-- Column landed:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'articles' AND column_name = 'relevance_grade_source';
--
-- Table landed:
--   SELECT count(*) FROM public.ingest_run_stats;
--
-- After the next pipeline run, the grader fallback rate:
--   SELECT run_started_at,
--          grade_source_counts->>'grader'          AS graded,
--          grade_source_counts->>'legacy_fallback' AS fell_back,
--          gate_candidates, gate_passed, gate_dropped_by_reason
--     FROM public.ingest_run_stats
--    ORDER BY run_started_at DESC LIMIT 20;
--
-- And the same split on the rows themselves:
--   SELECT relevance_grade_source, count(*), round(avg(relevance_score), 2)
--     FROM public.articles
--    WHERE ingested_at > now() - interval '7 days'
--    GROUP BY 1 ORDER BY 2 DESC;
