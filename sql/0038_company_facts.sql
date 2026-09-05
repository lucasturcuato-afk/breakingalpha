-- 0038_company_facts.sql
--
-- HAND-APPLY. Noah/Lucas apply this; agents do not apply migrations.
--
-- The fact layer's store: what an article actually SAYS about a company,
-- one row per stated claim per article, traceable to the article, the
-- outlet, the timestamp and the verbatim sentence. Nothing writes to it yet.
-- The extractor (backend/fact_extractor.py, PR 2) and the readers (PR 3)
-- ship separately; this file lands the tables they need so the day-one
-- backfill has somewhere to go. Companion module: backend/company_facts.py
-- (fact-type vocabulary, claim-key normalisation). Design note:
-- docs/company-facts-store.md.
--
-- Prior art, followed rather than reinvented:
--   supabase/migrations/20260603120000_create_financial_facts.sql
--       long/narrow, provenance-by-source-id, read through a view
--   sql/0026_claim_evidence.sql
--       UNIQUE on the source article makes a daily pass idempotent; source
--       fields are COPIED at write time so the ledger stays auditable if the
--       article later mutates
--   sql/0023 / sql/0024
--       every index CONCURRENTLY, one statement at a time; rank on light
--       columns and hydrate after; never ORDER BY a wide column
--
-- WHY sql/ AND NOT supabase/migrations/. Every hand-applied file since June
-- (0023 through 0037) lives here with the VERIFY / APPLY / MEASURE layout
-- Noah runs from the Studio editor; supabase/migrations/ implies `supabase db
-- push` ordering, which this repo does not use. 0038 is the next free number
-- across sql/ and sql/proposals/ together (they share one sequence: 0033 and
-- 0036 exist on both sides).
--
-- ---------------------------------------------------------------------
-- DESIGN, in the order the constraints enforce it
-- ---------------------------------------------------------------------
--
-- 1. company_id is NULLABLE. articles carry company NAMES (primary_company
--    text, companies text[]), not ids. Measured over the full table on
--    2026-09-05 (keyset on id, headline echoes excluded): of genuine prose
--    rows, 34.6% have no primary_company and 21.7% have no primary_company
--    AND an empty companies[]. A prose article with no resolved company still
--    states real facts.
--    Dropping them at write time is unrecoverable; attaching them later is a
--    backfill over the partial index in section 2d. ON DELETE SET NULL mirrors
--    financial_facts. Company MERGE tooling (sql/proposals/0033-0035) must
--    repoint company_facts.company_id before deleting the absorbed row, or
--    the facts detach silently.
--
-- 2. One row per stated claim per article. No arrays of facts, no JSON blob.
--    claim_text is the verbatim sentence, capped at 500 characters, and it is
--    the only wide column: keep it out of every ORDER BY (sql/0023).
--
-- 3. DEDUP IS NOT ON WRITE. Five outlets reporting one figure is
--    corroboration, and all five rows stay. The read view in section 3
--    groups them.
--
-- 4. The view counts corroboration by DISTINCT article_id. It does NOT count
--    distinct publisher: articles.publisher and publisher_domain are NULL on
--    93.8% of prose rows (full table, 2026-09-05; named RSS feeds carry the
--    outlet in `source`, and Google News rows before 2026-08-15 predate
--    publisher capture), so a publisher-based count would read 1 for nearly
--    everything. publisher_domain is exposed as a secondary signal with the
--    same caveat.
--
-- 5. UNIQUE (id, article_id), the claim_evidence shape. A later child table
--    (calls citing fact_id, PR 4) can declare a composite FK on
--    (fact_id, article_id) and structurally cannot cite a fact under the
--    wrong article.
--
-- 6. UNIQUE (article_id, claim_key) makes re-extraction idempotent. claim_key
--    is computed in Python (backend/company_facts.py:claim_key), versioned
--    by its prefix, and folds company_id in so one sentence naming two
--    companies yields two rows. It is plain columns, so a PostgREST upsert
--    can target it with on_conflict.
--
-- 7. speaker and speaker_role are NULL unless the article names the person.
--    speaker_role without speaker is rejected: "an executive said" is
--    reported coverage, not attribution. A reader decides between "NVIDIA's
--    CFO said" and "coverage flagged" on `speaker IS NOT NULL`, nothing else.
--
-- 8. company_facts_extractions is the ledger. One row per
--    (article, extractor_version) with a status that separates "processed,
--    the text stated nothing" (empty) from "never processed" (no row).
--    Without it a backfill's progress cannot be measured.
--
-- 9. Only what the text states. No sentiment, no confidence, no inferred
--    period. A numeric value must carry the verbatim token it was read from
--    (value_raw), enforced by CHECK: a number the text did not print cannot
--    be stored.
--
-- Sections:
--   0. VERIFY FIRST (read-only)
--   1. tables
--   2. indexes (CONCURRENTLY, one statement at a time)
--   3. read view
--   4. RLS and grants
--   5. OPTIONAL, only after measurement
--   6. MEASURE AFTER (read-only)


-- ===========================================================================
-- 0. VERIFY FIRST. All read-only.
-- ===========================================================================

-- 0a. Nothing here exists yet. All four should return NULL.
--
--   SELECT to_regclass('public.company_facts')              AS facts,
--          to_regclass('public.company_facts_extractions')  AS ledger,
--          to_regclass('public.company_facts_corroborated') AS view_,
--          to_regclass('public.company_facts_company_asof_idx') AS idx;

-- 0b. The FK targets exist and companies is the deduplicated post-0020 table.
--
--   SELECT count(*) AS companies FROM public.companies;
--   SELECT to_regclass('public.articles') AS articles;

-- 0c. Ground the size estimate in the design note against the real table.
--
--   SELECT relname, n_live_tup,
--          pg_size_pretty(pg_total_relation_size(relid)) AS total
--     FROM pg_stat_user_tables
--    WHERE relname IN ('articles', 'financial_facts', 'claim_evidence');


-- ===========================================================================
-- 1. TABLES. Plain CREATE; both tables are empty on arrival, so the UNIQUE
--    constraints build instantly and take no lock anyone will notice.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.company_facts (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- provenance: every fact traces to exactly one article
    article_id           uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    -- nullable on purpose; see design point 1
    company_id           uuid REFERENCES public.companies(id) ON DELETE SET NULL,

    -- what kind of statement this is
    fact_type            text NOT NULL
                         CHECK (fact_type IN ('figure', 'guidance', 'commentary', 'stated_cause', 'event')),

    -- the verbatim sentence the fact was read from; the only wide column
    claim_text           text NOT NULL CHECK (length(claim_text) BETWEEN 1 AND 500),

    -- figure detail. NULL when the sentence states no number. value_raw is the
    -- token exactly as printed ("$17 billion", "71%-72%"); value_num is its
    -- parse, and may not exist without it.
    metric_key           text,
    value_raw            text,
    value_num            numeric,
    value_unit           text,

    -- period, only as the text states it. period_text is verbatim ("Q4",
    -- "fiscal 2028"); period_end is set only when the text gives a calendar
    -- date without needing the issuer's fiscal calendar to resolve it.
    period_text          text,
    period_end           date,
    period_type          text CHECK (period_type IN ('duration', 'instant', 'forward')),

    -- attribution; both NULL unless the article names the person
    speaker              text,
    speaker_role         text,

    -- the date a reader windows on, kept as a 4-byte column so the indexes
    -- stay narrow: article_published_at::date, or ingested_at::date for the
    -- 1.9% of prose rows whose feed carried no date (ingest never now-stamps
    -- a date-less item, so published_at is NULL there). article_published_at
    -- IS NULL marks that fallback on the row.
    as_of                date NOT NULL,

    -- copied from articles at write time (claim_evidence pattern)
    article_published_at timestamptz,        -- NULL only when the feed had no date
    source               text NOT NULL,     -- articles.source, verbatim
    publisher            text,              -- articles.publisher, NULL on 93.8% of prose rows
    publisher_domain     text,              -- articles.publisher_domain, same caveat

    -- extraction identity
    extractor_version    text NOT NULL,
    extraction_model     text NOT NULL,
    claim_key            text NOT NULL,     -- backend/company_facts.py:claim_key
    extracted_at         timestamptz NOT NULL DEFAULT now(),

    -- 5. child tables reference (fact, article) together
    CONSTRAINT company_facts_id_article_uq UNIQUE (id, article_id),
    -- 6. re-extracting an article is idempotent
    CONSTRAINT company_facts_article_claim_uq UNIQUE (article_id, claim_key),
    -- 7. a role without a name is not attribution
    CONSTRAINT company_facts_role_requires_speaker
        CHECK (speaker_role IS NULL OR speaker IS NOT NULL),
    -- 9. a number must have been printed
    CONSTRAINT company_facts_value_requires_raw
        CHECK (value_num IS NULL OR value_raw IS NOT NULL)
);

COMMENT ON TABLE public.company_facts IS
    'What an article states about a company: one row per stated claim per '
    'article, verbatim sentence, traceable to article_id/source/timestamp. '
    'company_id is nullable (attached later by backfill). Dedup is on READ '
    'via company_facts_corroborated, never on write. '
    'Design: docs/company-facts-store.md';

COMMENT ON COLUMN public.company_facts.company_id IS
    'NULL when the article carried no resolvable company at extraction time. '
    'Attach via company_mentions in a later pass; never drop the fact.';
COMMENT ON COLUMN public.company_facts.speaker IS
    'Named person only. NULL means the coverage said it, not that management did.';
COMMENT ON COLUMN public.company_facts.claim_key IS
    'Versioned normalisation key from backend/company_facts.py. Article-'
    'independent so the read view can group the same claim across articles.';

-- The ledger (design point 8).
CREATE TABLE IF NOT EXISTS public.company_facts_extractions (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id           uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    extractor_version    text NOT NULL,
    -- extracted: >=1 fact written; empty: processed, the text stated
    -- nothing; failed: the call did not complete (error says why).
    -- "never processed" is the ABSENCE of a row, by design.
    status               text NOT NULL CHECK (status IN ('extracted', 'empty', 'failed')),
    facts_written        integer NOT NULL DEFAULT 0 CHECK (facts_written >= 0),
    extraction_model     text,
    error                text,
    processed_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_facts_extractions_article_version_uq
        UNIQUE (article_id, extractor_version),
    CONSTRAINT company_facts_extractions_status_count
        CHECK ((status = 'extracted') = (facts_written > 0))
);

COMMENT ON TABLE public.company_facts_extractions IS
    'Extraction ledger, one row per (article, extractor_version). Backfill '
    'progress = rows here vs prose articles; "empty" is a real outcome, '
    'absence means never processed.';


-- ===========================================================================
-- 2. INDEXES. Each statement CONCURRENTLY and ON ITS OWN, per sql/0024. On an
--    empty table each build is instant; the form is kept so re-applying after
--    the backfill (or on a re-run) stays lock-free.
-- ===========================================================================

-- 2a. "facts for company X in the last N days". The brief's read. Partial:
--     unattached rows are not reachable by company anyway.
CREATE INDEX CONCURRENTLY IF NOT EXISTS company_facts_company_asof_idx
    ON public.company_facts (company_id, as_of DESC)
    WHERE company_id IS NOT NULL;

-- 2b. "facts of type T across companies".
CREATE INDEX CONCURRENTLY IF NOT EXISTS company_facts_type_asof_idx
    ON public.company_facts (fact_type, as_of DESC);

-- 2c. Provenance and cascade by article are served by
--     company_facts_article_claim_uq (article_id leads it). No separate
--     article_id index; adding one would be a duplicate.

-- 2d. The attach-later backlog: what the company_mentions pass has to visit.
CREATE INDEX CONCURRENTLY IF NOT EXISTS company_facts_unattached_idx
    ON public.company_facts (as_of DESC)
    WHERE company_id IS NULL;

-- 2e. Ledger progress: count by (version, status) is the backfill's gauge.
CREATE INDEX CONCURRENTLY IF NOT EXISTS company_facts_extractions_version_status_idx
    ON public.company_facts_extractions (extractor_version, status);


-- ===========================================================================
-- 3. READ VIEW. Corroboration by distinct article. Group keys are exactly the
--    columns a reader filters on (company_id, fact_type), so a WHERE on them
--    pushes through the GROUP BY and the 2a/2b indexes serve it. Always read
--    it with a company or type predicate and a bounded window; never
--    unbounded.
-- ===========================================================================

CREATE OR REPLACE VIEW public.company_facts_corroborated AS
SELECT
    f.company_id,
    f.fact_type,
    f.claim_key,
    -- primary signal (design point 4)
    count(DISTINCT f.article_id)                  AS n_articles,
    -- secondary only: publisher_domain is NULL on 93.8% of prose rows, so
    -- this undercounts and is never the ranking key
    count(DISTINCT f.publisher_domain)            AS n_domains,
    min(f.as_of)                                  AS first_reported,
    max(f.as_of)                                  AS last_reported,
    bool_or(f.speaker IS NOT NULL)                AS any_attributed,
    -- the earliest row's id, to hydrate claim_text after ranking
    (array_agg(f.id ORDER BY f.as_of, f.article_published_at, f.id))[1]
                                                  AS first_fact_id,
    array_agg(DISTINCT f.article_id)              AS article_ids
FROM public.company_facts f
GROUP BY f.company_id, f.fact_type, f.claim_key;

COMMENT ON VIEW public.company_facts_corroborated IS
    'One row per (company, fact_type, claim_key): how many DISTINCT articles '
    'stated it. Base rows are never merged. Read with a company/type '
    'predicate and a window; hydrate claim_text by first_fact_id.';


-- ===========================================================================
-- 4. RLS AND GRANTS. Mirrors financial_facts: public SELECT, writes stay
--    with the service-role pipeline (no INSERT/UPDATE/DELETE policy). The
--    ledger is operational, service-role only: RLS on, no policy.
-- ===========================================================================

ALTER TABLE public.company_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_facts_public_read ON public.company_facts;
CREATE POLICY company_facts_public_read
    ON public.company_facts
    FOR SELECT
    TO public
    USING (true);

GRANT SELECT ON public.company_facts TO anon, authenticated;
GRANT SELECT ON public.company_facts_corroborated TO anon, authenticated;

ALTER TABLE public.company_facts_extractions ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- 5. OPTIONAL. Only if section 6 shows the metric-over-time query running
--    without an index at real volume. Not part of the default apply.
-- ===========================================================================

-- "capex for company X over time":
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS company_facts_company_metric_asof_idx
--       ON public.company_facts (company_id, metric_key, as_of DESC)
--       WHERE metric_key IS NOT NULL;


-- ===========================================================================
-- 6. MEASURE AFTER. Read-only.
-- ===========================================================================

-- 6a. Everything landed.
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'company_facts'
--   UNION ALL
--   SELECT indexname FROM pg_indexes WHERE tablename = 'company_facts_extractions'
--   ORDER BY 1;
--
--   -- expect: company_facts_article_claim_uq, company_facts_company_asof_idx,
--   --         company_facts_id_article_uq, company_facts_pkey,
--   --         company_facts_type_asof_idx, company_facts_unattached_idx,
--   --         company_facts_extractions_article_version_uq,
--   --         company_facts_extractions_pkey,
--   --         company_facts_extractions_version_status_idx

-- 6b. Sizes, to re-check the design note's per-row estimate once PR 2 has
--     written a day of rows.
--
--   SELECT relname, n_live_tup,
--          pg_size_pretty(pg_relation_size(relid))        AS heap,
--          pg_size_pretty(pg_indexes_size(relid))         AS indexes
--     FROM pg_stat_user_tables
--    WHERE relname IN ('company_facts', 'company_facts_extractions');

-- 6c. The two query shapes are index-served (both should show an Index Scan
--     on the 2a / 2b index, never a Seq Scan on company_facts).
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id, as_of, fact_type, speaker, claim_text
--     FROM public.company_facts
--    WHERE company_id = (SELECT id FROM public.companies WHERE ticker = 'NVDA' LIMIT 1)
--      AND as_of >= current_date - 90
--    ORDER BY as_of DESC
--    LIMIT 50;
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id, company_id, as_of, claim_text
--     FROM public.company_facts
--    WHERE fact_type = 'guidance'
--      AND as_of >= current_date - 30
--    ORDER BY as_of DESC
--    LIMIT 200;

-- 6d. Backfill gauge, once PR 2 runs.
--
--   SELECT extractor_version, status, count(*)
--     FROM public.company_facts_extractions
--    GROUP BY 1, 2 ORDER BY 1, 2;
