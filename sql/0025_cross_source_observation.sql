-- 0025_cross_source_observation.sql
--
-- HAND-APPLY. Do not auto-run. Adds publisher identity to articles, plus the
-- two tables behind Part 1 (outcome-based source reliability) and Part 2
-- (Stage 1 cross-source observation).
--
-- SAFE TO RUN BEFORE OR AFTER THE APP DEPLOYS. Everything is additive:
--   - No existing column is altered, dropped, or backfilled.
--   - backend/ingest.py probes for the publisher columns once per run and
--     omits them when absent, so ingest keeps working either way.
--   - backend/source_reliability.py and backend/cross_source.py probe the same
--     way and print an explicit NOTE rather than silently degrading.
--
-- ORDER DOES NOT MATTER between sections, but section 1 is the one that
-- unblocks everything else, so apply it first if you split this up.
--
-- CONCURRENTLY NOTE: the two index builds on `articles` use CONCURRENTLY
-- because that table is large and under IO pressure (see sql/0023 and
-- sql/0024). CONCURRENTLY CANNOT run inside a transaction block: in the
-- Supabase SQL editor, run those two statements ON THEIR OWN, one at a time,
-- off-peak. Everything else can go in one paste.


-- ===========================================================================
-- 1. articles.publisher / articles.publisher_domain
-- ===========================================================================
-- WHY. `articles.source` names the FEED, not the publisher. Measured on a
-- 6,000-article window: 88% of rows carry one of 819 distinct
-- `Google News (TICKER)` values, and 996 of 1,000 sampled URLs are
-- news.google.com redirect blobs, so the URL cannot recover the publisher
-- either. The real outlet is in the RSS <source> element and was never read.
--
-- NO BACKFILL IS POSSIBLE. The " - Publisher" title suffix is already stripped
-- from stored rows and the <source> element was never persisted. Rows ingested
-- before this ships keep publisher = NULL, which is the honest state. Consumers
-- treat NULL as "unknown" and refuse to invent an identity from the feed name.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS publisher text;

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS publisher_domain text;

-- Run each of the next two ON ITS OWN (CONCURRENTLY cannot be in a transaction).
-- Partial on NOT NULL: today every row is NULL, so the index stays tiny and
-- grows only as real publishers land.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_publisher
  ON public.articles (publisher)
  WHERE publisher IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_publisher_domain
  ON public.articles (publisher_domain)
  WHERE publisher_domain IS NOT NULL;


-- ===========================================================================
-- 2. source_reliability  (PART 1)
-- ===========================================================================
-- Outcome-based source signal derived from the CLEAN price-attribution grader
-- (morning_brief_call_outcomes WHERE attribution = 'clean' AND verdict IN
-- ('correct','wrong')), NOT from theses.outcome.
--
-- This table does NOT replace `source_credibility`. That table is still
-- written by backend/source_credibility.py and still read by
-- backend/trend_mapper.py. Nothing here is wired into generation.
--
-- accuracy / wilson_lower_95 are NULLABLE ON PURPOSE. They stay NULL until an
-- identity clears the reportable sample bar (n >= 10). A NULL is the honest
-- answer for a 1-outcome source; a number would invite ranking on noise.

CREATE TABLE IF NOT EXISTS public.source_reliability (
  identity                 text PRIMARY KEY,
  n_clean_outcomes         integer     NOT NULL DEFAULT 0,
  n_correct                integer     NOT NULL DEFAULT 0,
  n_wrong                  integer     NOT NULL DEFAULT 0,
  -- Credit diluted 1/N across the identities sharing one resolved call, so a
  -- story covered by six outlets does not hand out six full credits.
  credit_weight            numeric     NOT NULL DEFAULT 0,
  distinct_symbols         integer     NOT NULL DEFAULT 0,
  accuracy                 numeric,
  wilson_lower_95          numeric,
  confidence               text        NOT NULL DEFAULT 'insufficient'
                             CHECK (confidence IN ('insufficient','low','moderate','high')),
  is_syndicator            boolean     NOT NULL DEFAULT false,
  ready_for_weighting      boolean     NOT NULL DEFAULT false,
  -- Recorded on every row so no reader mistakes this for clean single-source
  -- attribution. morning_brief_calls has no source column; a call is attributed
  -- to the identities in its brief's story rail that concern the call's target.
  attribution_method       text        NOT NULL DEFAULT 'brief_rail_target_fanout',
  last_outcome_at          timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Ordering by sample size, NOT by accuracy. The old source_credibility index is
-- `(win_rate desc)`, which is exactly what surfaced three n=1 sources at a
-- perfect 1.0 to the UI. Do not add a bare accuracy index here.
CREATE INDEX IF NOT EXISTS idx_source_reliability_n
  ON public.source_reliability (n_clean_outcomes DESC);

ALTER TABLE public.source_reliability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS source_reliability_public_read ON public.source_reliability;
CREATE POLICY source_reliability_public_read ON public.source_reliability
  FOR SELECT USING (true);
-- No write policy: writes go through the service role (backend/supabase_client.py).


-- ===========================================================================
-- 3. cross_source_clusters  (PART 2)
-- ===========================================================================
-- One row per same-event group carrying 2+ distinct publisher identities.
-- OBSERVATION ONLY. Nothing in this table asserts that any source is correct.
-- `figure_findings` records where members carry differing or exclusive numbers;
-- a divergence may simply be two different quantities (revenue vs market cap).
--
-- `members` is jsonb rather than a child table on purpose: it is written and
-- read whole, it is capped at 25 members per cluster in
-- backend/cross_source.py, and a child table would add a join to a read path we
-- want to stay cheap on an IO-constrained instance.

CREATE TABLE IF NOT EXISTS public.cross_source_clusters (
  cluster_key              text PRIMARY KEY,
  base_key                 text        NOT NULL,
  article_count            integer     NOT NULL DEFAULT 0,
  distinct_identities      integer     NOT NULL DEFAULT 0,
  distinct_non_syndicators integer     NOT NULL DEFAULT 0,
  -- True when two or more members share the earliest timestamp, so no single
  -- first mover can be named honestly.
  tied_lead                boolean     NOT NULL DEFAULT false,
  lead_identity            text,
  window_start             timestamptz,
  window_end               timestamptz,
  members                  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  figure_findings          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  computed_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cross_source_computed_at
  ON public.cross_source_clusters (computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_cross_source_identities
  ON public.cross_source_clusters (distinct_identities DESC);

ALTER TABLE public.cross_source_clusters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cross_source_clusters_public_read ON public.cross_source_clusters;
CREATE POLICY cross_source_clusters_public_read ON public.cross_source_clusters
  FOR SELECT USING (true);
-- No write policy: writes go through the service role.


-- ===========================================================================
-- 4. VERIFY (read-only)
-- ===========================================================================
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'articles' AND column_name LIKE 'publisher%';
--
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('source_reliability','cross_source_clusters');
--
-- After the next pipeline run, publisher capture should be visible:
--   SELECT publisher, count(*) FROM public.articles
--    WHERE publisher IS NOT NULL
--    GROUP BY publisher ORDER BY count(*) DESC LIMIT 20;
