-- 0027_content_type_backfill.sql
--
-- HAND-APPLY. Corrects articles.content_type, which is currently inverted on
-- every row.
--
-- THE BUG. content_type was set at FETCH time from the article's SOURCE
-- (`"full_text" if source in FULL_TEXT_SOURCES else "snippet"`), while
-- articles.content is only ever written by the Tail-A enrichment pass in
-- run_ingestion, which covers fulltext.SCRAPEABLE_SOURCES. Those two sets are
-- DISJOINT, so the label and the contents could never agree.
--
-- MEASURED FULL-TABLE, before the fix (162,327 rows):
--   content_type = 'full_text'                     1,768   and ALL hold no content
--     = SEC 8-K 976 + SEC 10-Q 730 + Federal Reserve 62, exactly
--   content_type = 'snippet' AND content NOT NULL  5,635   every row that DOES
--                                                          hold content
--   rows where both are true                           0
--
-- WHY IT MATTERS. src/app/api/theses/route.ts:282 selects content_type (but NOT
-- content) and line 315 injects `content_type=snippet|full_text` into the thesis
-- generation prompt next to a 200-character summary slice. The generator is told
-- "full_text" for rows that have none, and "snippet" for every row that does.
--
-- The code fix ships alongside this file: content_type is now written as
-- 'snippet' at insert and promoted to 'full_text' in the SAME update that writes
-- the content. New rows are correct once that deploys, so ORDER DOES NOT MATTER
-- between deploying and running this. This file only repairs history.
--
-- Section 2 is idempotent: re-running is a no-op because the WHERE clauses no
-- longer match. NO SCHEMA CHANGE.


-- ===========================================================================
-- 1. INSPECT (read-only). Run this first.
-- ===========================================================================

-- 1a. The inversion, in one row. Before the backfill expect
--     both_true = 0, claims_full_text_but_empty = 1768, has_content_but_snippet = 5635.
SELECT
    count(*) FILTER (WHERE content_type = 'full_text' AND content IS NOT NULL)
        AS both_true,
    count(*) FILTER (WHERE content_type = 'full_text' AND content IS NULL)
        AS claims_full_text_but_empty,
    count(*) FILTER (WHERE content_type = 'snippet'   AND content IS NOT NULL)
        AS has_content_but_snippet,
    count(*) FILTER (WHERE content_type = 'snippet'   AND content IS NULL)
        AS snippet_and_empty_correct,
    count(*) AS total
FROM public.articles;

-- 1b. Which sources are affected, so the remap is inspectable per source.
SELECT
    source,
    content_type,
    (content IS NOT NULL) AS has_content,
    count(*)              AS rows
FROM public.articles
WHERE (content_type = 'full_text' AND content IS NULL)
   OR (content_type = 'snippet'   AND content IS NOT NULL)
GROUP BY source, content_type, (content IS NOT NULL)
ORDER BY rows DESC;

-- 1c. Any value outside the two expected ones? Expect zero rows.
SELECT content_type, count(*) AS rows
FROM public.articles
WHERE content_type IS NULL
   OR content_type NOT IN ('snippet', 'full_text')
GROUP BY content_type;


-- ===========================================================================
-- 2. BACKFILL. Run only after reading section 1.
-- ===========================================================================
-- Two statements, not one CASE, so each count is visible on its own and the
-- two directions cannot hide inside a single total. The predicates are disjoint
-- and neither can match a row the other already changed, so order is irrelevant.
--
-- The rule in both directions is the same and is the whole point:
-- content_type describes whether THIS ROW holds content, nothing else.

BEGIN;

-- 2a. Claimed full text, holds none. Expect 1,768 rows.
--     These are SEC/Fed rows labelled from their source. Nothing populates
--     content for them, so 'snippet' is the truthful label.
UPDATE public.articles
   SET content_type = 'snippet'
 WHERE content_type = 'full_text'
   AND content IS NULL;

-- 2b. Holds content, labelled a snippet. Expect 5,635 rows.
--     These are the enrichment-scraped rows. Written before the code fix, so
--     their content_type was never promoted.
UPDATE public.articles
   SET content_type = 'full_text'
 WHERE content IS NOT NULL
   AND content_type IS DISTINCT FROM 'full_text';

-- If either count disagrees with section 1a, ROLLBACK; instead of COMMIT.
COMMIT;


-- ===========================================================================
-- 3. VERIFY (read-only).
-- ===========================================================================
-- Expect claims_full_text_but_empty = 0 and has_content_but_snippet = 0, and
-- both_true = 5635 (the rows that genuinely hold content).
SELECT
    count(*) FILTER (WHERE content_type = 'full_text' AND content IS NOT NULL)
        AS both_true,
    count(*) FILTER (WHERE content_type = 'full_text' AND content IS NULL)
        AS claims_full_text_but_empty,
    count(*) FILTER (WHERE content_type = 'snippet'   AND content IS NOT NULL)
        AS has_content_but_snippet,
    count(*) AS total
FROM public.articles;

-- The invariant this file establishes, stated as a query. Expect zero rows,
-- now and after every future ingest run.
SELECT count(*) AS rows_violating_invariant
FROM public.articles
WHERE (content_type = 'full_text') <> (content IS NOT NULL);
