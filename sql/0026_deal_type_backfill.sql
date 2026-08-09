-- 0026_deal_type_backfill.sql
--
-- HAND-APPLY. Do not auto-run. Backfills articles.deal_type rows that hold an
-- ACTIVITY_TYPES value instead of a deal_type value.
--
-- WHY. backend/ingest.py FILTER_PROMPT defines deal_type over exactly seven
-- values (M&A, IPO, Funding, Earnings, Macro, Geopolitical, Other), but nothing
-- enforced it and the model bleeds ACTIVITY_TYPES entries across. Measured over
-- the last 30 days (20,000 articles sampled): 1,325 rows, 6.6%, were invalid,
-- and every invalid value observed was a verbatim ACTIVITY_TYPES entry.
--
-- The code-side guard ships alongside this file (validate_deal_type in
-- backend/ingest.py), so NEW rows are already correct once that deploys. This
-- file only repairs history.
--
-- RUN SECTION 1 FIRST AND READ THE OUTPUT. Section 1 is read-only and tells you
-- exactly what exists in YOUR data. Only then run section 2. Section 2 is
-- idempotent: re-running it is a no-op because the WHERE clauses no longer match.
--
-- NO SCHEMA CHANGE IS MADE. A CHECK constraint is deliberately NOT added here;
-- see section 4 for why that is a separate decision.


-- ===========================================================================
-- 1. INSPECT (read-only). Run this first.
-- ===========================================================================

-- 1a. Every distinct deal_type currently in the table, with counts, flagged
--     valid or invalid. This is the authoritative list for your data -- if it
--     shows a value that section 2 does not handle, tell me before proceeding.
SELECT
    deal_type,
    count(*)                                                   AS rows,
    round(100.0 * count(*) / sum(count(*)) OVER (), 2)         AS pct_of_table,
    CASE
        WHEN deal_type IS NULL THEN 'null (allowed)'
        WHEN deal_type IN ('M&A','IPO','Funding','Earnings','Macro',
                           'Geopolitical','Other') THEN 'valid'
        ELSE 'INVALID'
    END                                                        AS status
FROM public.articles
GROUP BY deal_type
ORDER BY status DESC, rows DESC;

-- 1b. Invalid rows only, with the value section 2 would write, so you can see
--     the exact remap before running it. Rows appearing here with
--     would_become = 'Other (unmapped)' are NOT touched by section 2.
SELECT
    deal_type                                                  AS current_value,
    count(*)                                                   AS rows,
    CASE deal_type
        WHEN 'Mergers & Acquisitions'  THEN 'M&A'
        WHEN 'Private Equity'          THEN 'Funding'
        WHEN 'Venture Capital'         THEN 'Funding'
        WHEN 'IPO & Capital Markets'   THEN 'IPO'
        WHEN 'Earnings & Results'      THEN 'Earnings'
        WHEN 'Macro & Policy'          THEN 'Macro'
        WHEN 'Geopolitics'             THEN 'Geopolitical'
        WHEN 'Regulation & Legal'      THEN 'Other'
        WHEN 'Fundraising'             THEN 'Funding'
        WHEN 'Crypto & Digital Assets' THEN 'Other'
        WHEN 'Leadership & Operations' THEN 'Other'
        ELSE 'Other (unmapped)'
    END                                                        AS would_become
FROM public.articles
WHERE deal_type IS NOT NULL
  AND deal_type NOT IN ('M&A','IPO','Funding','Earnings','Macro',
                        'Geopolitical','Other')
GROUP BY deal_type
ORDER BY rows DESC;

-- 1c. Total rows section 2 will update. Sanity-check this against 1b.
SELECT count(*) AS rows_to_update
FROM public.articles
WHERE deal_type IN (
    'Mergers & Acquisitions','Private Equity','Venture Capital',
    'IPO & Capital Markets','Earnings & Results','Macro & Policy',
    'Geopolitics','Regulation & Legal','Fundraising',
    'Crypto & Digital Assets','Leadership & Operations'
);


-- ===========================================================================
-- 2. BACKFILL. Run only after reading section 1.
-- ===========================================================================
-- Every mapping follows FILTER_PROMPT's own definitions, not a guess:
--   Private Equity / Venture Capital -> Funding: the prompt defines Funding as
--     "a named company is receiving investment capital -- a venture round,
--      private equity investment, debt financing, or fundraising raise".
--   Regulation & Legal / Leadership & Operations -> Other: the prompt lists
--     "regulatory action ... legal settlement, personnel change" under Other.
--   Crypto & Digital Assets -> Other: no deal_type counterpart exists.
--
-- The explicit IN list is the safety rail. An UPDATE that instead wrote 'Other'
-- to everything not in the valid set would flatten any value this file has not
-- reviewed, which is exactly the silent-pollution failure being fixed. Anything
-- section 1b reported as 'Other (unmapped)' is intentionally left untouched for
-- a human decision.

BEGIN;

UPDATE public.articles
   SET deal_type = CASE deal_type
        WHEN 'Mergers & Acquisitions'  THEN 'M&A'
        WHEN 'Private Equity'          THEN 'Funding'
        WHEN 'Venture Capital'         THEN 'Funding'
        WHEN 'IPO & Capital Markets'   THEN 'IPO'
        WHEN 'Earnings & Results'      THEN 'Earnings'
        WHEN 'Macro & Policy'          THEN 'Macro'
        WHEN 'Geopolitics'             THEN 'Geopolitical'
        WHEN 'Regulation & Legal'      THEN 'Other'
        WHEN 'Fundraising'             THEN 'Funding'
        WHEN 'Crypto & Digital Assets' THEN 'Other'
        WHEN 'Leadership & Operations' THEN 'Other'
   END
 WHERE deal_type IN (
        'Mergers & Acquisitions','Private Equity','Venture Capital',
        'IPO & Capital Markets','Earnings & Results','Macro & Policy',
        'Geopolitics','Regulation & Legal','Fundraising',
        'Crypto & Digital Assets','Leadership & Operations'
   );

-- Read the row count. If it does not match section 1c, ROLLBACK instead.
COMMIT;


-- ===========================================================================
-- 3. VERIFY (read-only). Expect zero rows.
-- ===========================================================================

SELECT deal_type, count(*) AS rows
FROM public.articles
WHERE deal_type IS NOT NULL
  AND deal_type NOT IN ('M&A','IPO','Funding','Earnings','Macro',
                        'Geopolitical','Other')
GROUP BY deal_type
ORDER BY rows DESC;

-- And the corrected distribution, for the record.
SELECT deal_type, count(*) AS rows,
       round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS pct
FROM public.articles
GROUP BY deal_type
ORDER BY rows DESC;


-- ===========================================================================
-- 4. OPTIONAL: a CHECK constraint. NOT applied here, deliberately.
-- ===========================================================================
-- A constraint would make this class of bug impossible rather than merely
-- corrected. It is left out of this file because it changes failure MODE: a
-- future unmapped value would abort the article INSERT, and ingest inserts in
-- bulk batches, so one bad value could drop a whole batch. The code-side
-- validate_deal_type already coerces to 'Other' and logs, which fails soft.
--
-- Apply this only if you would rather fail loud than coerce, and only AFTER
-- section 3 returns zero rows:
--
--   ALTER TABLE public.articles
--     ADD CONSTRAINT articles_deal_type_check
--     CHECK (deal_type IS NULL OR deal_type IN
--            ('M&A','IPO','Funding','Earnings','Macro','Geopolitical','Other'))
--     NOT VALID;
--
--   -- NOT VALID skips the full-table scan on add. Validate separately, off-peak:
--   ALTER TABLE public.articles VALIDATE CONSTRAINT articles_deal_type_check;
