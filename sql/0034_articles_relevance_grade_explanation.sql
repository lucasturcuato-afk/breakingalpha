-- =====================================================================
-- 0034_articles_relevance_grade_explanation.sql
--
-- HAND-APPLY. Additive only: two nullable columns on articles.
-- No existing column is altered, dropped or backfilled.
--
-- WHY. Nothing on a stored row explains the score the ingest gate was applied to.
--
--   articles.relevance_reason holds the FILTER's reason -- a different model
--   (gemini-2.5-flash-lite) answering a different prompt (FILTER_PROMPT). Under
--   RELEVANCE_GRADE_MODE=new, which production has run since 2026-06-19, the
--   grader REPLACES relevance_score. So on every grader-scored row since that
--   date, relevance_reason sits next to a number it did not produce and does not
--   describe. It has been read as an explanation of the score. It is not one.
--
--   grade_relevance() has always returned {"score", "band", "reason"}. The score
--   was kept, the band was assigned to the in-memory result and never written,
--   and the ~200-char reason was discarded on the floor at the call site.
--
-- These columns keep the grader's own verdict. They are what makes a false
-- negative auditable: today a low score can be seen, but never explained.
--
-- NOT a backfill, and not backfillable. The reason for a past score was never
-- persisted anywhere and the run logs that might have carried it do not go back
-- far enough (see the note at the bottom). Rows written before this stay NULL.
-- Rows written after it stay NULL for SEC-pinned articles and for grader
-- fallbacks, where the grader produced no verdict to record -- NULL therefore
-- means "no grader verdict", never "the grader had no reason".
--
-- Backend is forward-compatible: _grade_explanation_columns_available() probes
-- once per process and skips both fields when they are absent, exactly like the
-- publisher and grade-source columns before them. Ingest works either way.
-- =====================================================================


-- =====================================================================
-- SECTION 0 -- INSPECT. Read-only. Run first.
-- =====================================================================
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'articles'
--      AND column_name IN ('relevance_grade_reason', 'relevance_band');
--     Expect ZERO rows before applying, two after.
--
--   -- the size of the population that will never have these values:
--   SELECT relevance_grade_source, count(*)
--     FROM public.articles GROUP BY 1 ORDER BY 2 DESC;


-- =====================================================================
-- SECTION 1 -- the columns.
-- =====================================================================

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS relevance_grade_reason text,
  ADD COLUMN IF NOT EXISTS relevance_band         text;

COMMENT ON COLUMN public.articles.relevance_grade_reason IS
  'The RELEVANCE GRADER''s own one-line justification for relevance_score, '
  'capped at 200 chars by grade_relevance(). Distinct from relevance_reason, '
  'which is the FILTER''s reason and does not describe the stored score under '
  'RELEVANCE_GRADE_MODE=new. NULL = no grader verdict (SEC-pinned, legacy '
  'fallback, or the row predates this column).';

COMMENT ON COLUMN public.articles.relevance_band IS
  'The grader''s band for this score: material_first_order (9-10), '
  'secondary_partial (6-7), weak (3-4), template/junk (0-2), or unknown when '
  'the model returned a band outside that set. Computed on every grader call '
  'since the grader shipped and written nowhere until this column. NULL has the '
  'same meaning as in relevance_grade_reason.';


-- =====================================================================
-- SECTION 2 -- VERIFY, after the next pipeline run.
-- =====================================================================
--
--   -- 2a. The columns are being written for grader-scored rows only.
--   SELECT relevance_grade_source,
--          count(*)                                        AS rows,
--          count(relevance_grade_reason)                   AS with_reason,
--          count(relevance_band)                           AS with_band
--     FROM public.articles
--    WHERE ingested_at > now() - interval '1 day'
--    GROUP BY 1 ORDER BY 2 DESC;
--
--     EXPECT: with_reason = with_band = rows for grade_source 'grader', and 0
--     for 'sec_pinned' / 'legacy_fallback' / 'legacy_skip'. A grader row with a
--     NULL reason means apply_relevance_grade stopped stamping it.
--
--   -- 2b. The band actually agrees with the score it was stored beside. This is
--   --     the check worth running: it is the first time the two can be compared.
--   SELECT relevance_band,
--          count(*)      AS rows,
--          min(relevance_score) AS min_score,
--          max(relevance_score) AS max_score
--     FROM public.articles
--    WHERE relevance_band IS NOT NULL
--    GROUP BY 1 ORDER BY 2 DESC;
--
--     EXPECT roughly: material_first_order 9-10, secondary_partial 6-7,
--     weak 3-4, template/junk 0-2. A band spanning the whole 0-10 range means
--     the model is not honouring its own rubric, which is worth knowing before
--     RELEVANCE_NEW_GATE is retuned against these bands.
--
--   -- 2c. Read the actual reasons at the bottom of the distribution. This is
--   --     the false-negative audit the columns exist for.
--   SELECT relevance_score, relevance_band, publisher, title,
--          relevance_grade_reason
--     FROM public.articles
--    WHERE relevance_grade_reason IS NOT NULL
--      AND relevance_score <= 3
--    ORDER BY ingested_at DESC LIMIT 50;
--
--     NOTE the survivorship bias, and do not forget it when reading 2c: these
--     are only the low-scoring articles that PASSED the gate. Articles scored
--     below RELEVANCE_NEW_GATE are never stored, so they cannot appear here at
--     any gate setting. The run-log sample (GRADER_REJECT_LOG_SAMPLE, printed
--     under the greppable tag GRADER_REJECT) is the only view of those, and it
--     lives in the Actions log, which GitHub retains for 90 days.
