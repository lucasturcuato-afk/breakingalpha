-- 0026_deal_type_backfill.sql
--
-- HAND-APPLY. Repairs articles.deal_type rows holding a value outside the
-- seven-value vocabulary FILTER_PROMPT defines.
--
-- SCOPE, from a FULL-TABLE census (~162,000 rows), not a sample:
--   28 distinct invalid values across ~8,175 rows (~5% of the table).
--   A 30-day sample had shown only 9 of them; the tail is long and thin, with
--   20 of the 28 values holding fewer than 30 rows each. Do not re-derive this
--   list from a recent window.
--
-- The code-side guard ships alongside (validate_deal_type in backend/ingest.py),
-- so NEW rows are correct once that deploys. Order does not matter between
-- deploying and running this. This file only repairs history.
--
-- RUN SECTION 1 FIRST AND READ IT. Section 2 is idempotent: re-running is a
-- no-op because the WHERE clauses no longer match.
--
-- NO SCHEMA CHANGE. No CHECK constraint is added; see section 4 for why.
--
-- THERE IS DELIBERATELY NO `ELSE 'Other'` IN SECTION 2. Every value is listed
-- explicitly. A value not on this list is LEFT ALONE so it surfaces in section 1
-- the next time this is run, instead of being silently flattened into Other.
-- That is the whole reason the census found 28 values rather than 9.


-- ===========================================================================
-- 1. INSPECT (read-only). Run this first.
-- ===========================================================================

-- 1a. Every distinct deal_type with counts, flagged. Note that a row reading
--     'null' under status='INVALID' is the literal 4-character STRING; a row
--     under status='null (allowed)' is a real SQL NULL. They are different
--     things and section 2 treats them differently.
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

-- 1b. Invalid rows with the value section 2 would write. Anything showing
--     'UNREVIEWED - left alone' is NOT touched by section 2 and needs a
--     decision before it can be mapped. Tell me if any appear.
SELECT
    deal_type                                                  AS current_value,
    count(*)                                                   AS rows,
    CASE deal_type
        -- ACTIVITY_TYPES bleed
        WHEN 'Mergers & Acquisitions'    THEN 'M&A'
        WHEN 'IPO & Capital Markets'     THEN 'IPO'
        WHEN 'Earnings & Results'        THEN 'Earnings'
        WHEN 'Macro & Policy'            THEN 'Macro'
        WHEN 'Geopolitics'               THEN 'Geopolitical'
        WHEN 'Private Equity'            THEN 'Funding'
        WHEN 'Venture Capital'           THEN 'Funding'
        WHEN 'Fundraising'               THEN 'Funding'
        WHEN 'Regulation & Legal'        THEN 'Other'
        WHEN 'Leadership & Operations'   THEN 'Other'
        WHEN 'Crypto & Digital Assets'   THEN 'Other'
        -- Invented vocabulary
        WHEN 'Regulation'                THEN 'Other'
        WHEN 'Regulatory'                THEN 'Other'
        WHEN 'Partnership'               THEN 'Other'
        WHEN 'Public Company News'       THEN 'Other'
        WHEN 'Product Launch'            THEN 'Other'
        WHEN 'Market Movement'           THEN 'Other'
        WHEN 'Public Markets'            THEN 'Other'
        WHEN 'Market Entry'              THEN 'Other'
        WHEN 'Expansion'                 THEN 'Other'
        WHEN 'Hiring'                    THEN 'Other'
        WHEN 'Public Markets & Earnings' THEN 'Earnings'
        WHEN 'Macro/Geopolitical'        THEN 'Macro'
        WHEN 'Investment'                THEN 'Funding'
        WHEN 'Infrastructure Investment' THEN 'Funding'
        WHEN 'PE'                        THEN 'Funding'
        WHEN 'Joint Venture'             THEN 'Funding'
        -- Prompt text as data
        WHEN 'Joint-venture disambiguator' THEN 'Other'
        WHEN 'null'                      THEN '(real SQL NULL)'
        ELSE 'UNREVIEWED - left alone'
    END                                                        AS would_become
FROM public.articles
WHERE deal_type IS NOT NULL
  AND deal_type NOT IN ('M&A','IPO','Funding','Earnings','Macro',
                        'Geopolitical','Other')
GROUP BY deal_type
ORDER BY rows DESC;

-- 1c. Row counts section 2 will touch, split by statement. Sanity-check these
--     against 1b before running anything. Expect roughly 8,169 and 6.
SELECT
    count(*) FILTER (WHERE deal_type <> 'null')  AS rows_2a_remap,
    count(*) FILTER (WHERE deal_type =  'null')  AS rows_2b_to_null,
    count(*)                                     AS rows_total
FROM public.articles
WHERE deal_type IN (
    'Mergers & Acquisitions','IPO & Capital Markets','Earnings & Results',
    'Macro & Policy','Geopolitics','Private Equity','Venture Capital',
    'Fundraising','Regulation & Legal','Leadership & Operations',
    'Crypto & Digital Assets','Regulation','Regulatory','Partnership',
    'Public Company News','Product Launch','Market Movement','Public Markets',
    'Market Entry','Expansion','Hiring','Public Markets & Earnings',
    'Macro/Geopolitical','Investment','Infrastructure Investment','PE',
    'Joint Venture','Joint-venture disambiguator','null'
);

-- 1d. Confirm for yourself that 'null' is the literal string and not SQL NULL.
--     Expect: is_sql_null = false, char_length = 4.
SELECT deal_type,
       deal_type IS NULL        AS is_sql_null,
       char_length(deal_type)   AS char_length,
       count(*)                 AS rows
FROM public.articles
WHERE deal_type = 'null'
GROUP BY deal_type;


-- ===========================================================================
-- 2. BACKFILL. Run only after reading section 1.
-- ===========================================================================
-- Every mapping is justified by FILTER_PROMPT's own text:
--   Funding  = "a named company is receiving investment capital -- a venture
--              round, private equity investment, debt financing, or fundraising
--              raise". Covers Private Equity, PE, Venture Capital, Fundraising,
--              Investment, Infrastructure Investment.
--   Joint Venture -> Funding because the prompt's JV clause ends "Default to
--              Funding when ambiguous", and with no article context to reframe
--              it, ambiguous is exactly the case.
--   Other    = "regulatory action, product launch, contract award, partnership
--              announcement, legal settlement, personnel change, analyst note,
--              market commentary -- use this as a catch-all". Covers Regulation,
--              Regulatory, Partnership, Product Launch, Market Movement, Hiring,
--              and the vague Public Markets / Market Entry / Expansion /
--              Public Company News.
--   Macro/Geopolitical -> Macro because deal_type opens with "apply the FIRST
--              definition that matches" and Macro precedes Geopolitical in the
--              prompt's own enumeration. Not a coin flip.
--   Geopolitics -> Geopolitical, NOT Other. It is the ACTIVITY_TYPES spelling of
--              a valid deal_type; sending it to Other would discard real signal.
--   'Joint-venture disambiguator' -> Other because it is the literal HEADING of
--              a clause in FILTER_PROMPT that the model copied into the answer
--              field. It says nothing about the article, so the catch-all is
--              right. Deliberately NOT routed through the JV rule to Funding:
--              there is no evidence these four articles were joint ventures.

BEGIN;

-- 2a. Value remaps. 27 values -> a valid deal_type.
UPDATE public.articles
   SET deal_type = CASE deal_type
        WHEN 'Mergers & Acquisitions'    THEN 'M&A'
        WHEN 'IPO & Capital Markets'     THEN 'IPO'
        WHEN 'Earnings & Results'        THEN 'Earnings'
        WHEN 'Macro & Policy'            THEN 'Macro'
        WHEN 'Geopolitics'               THEN 'Geopolitical'
        WHEN 'Private Equity'            THEN 'Funding'
        WHEN 'Venture Capital'           THEN 'Funding'
        WHEN 'Fundraising'               THEN 'Funding'
        WHEN 'Regulation & Legal'        THEN 'Other'
        WHEN 'Leadership & Operations'   THEN 'Other'
        WHEN 'Crypto & Digital Assets'   THEN 'Other'
        WHEN 'Regulation'                THEN 'Other'
        WHEN 'Regulatory'                THEN 'Other'
        WHEN 'Partnership'               THEN 'Other'
        WHEN 'Public Company News'       THEN 'Other'
        WHEN 'Product Launch'            THEN 'Other'
        WHEN 'Market Movement'           THEN 'Other'
        WHEN 'Public Markets'            THEN 'Other'
        WHEN 'Market Entry'              THEN 'Other'
        WHEN 'Expansion'                 THEN 'Other'
        WHEN 'Hiring'                    THEN 'Other'
        WHEN 'Public Markets & Earnings' THEN 'Earnings'
        WHEN 'Macro/Geopolitical'        THEN 'Macro'
        WHEN 'Investment'                THEN 'Funding'
        WHEN 'Infrastructure Investment' THEN 'Funding'
        WHEN 'PE'                        THEN 'Funding'
        WHEN 'Joint Venture'             THEN 'Funding'
        WHEN 'Joint-venture disambiguator' THEN 'Other'
   END
 WHERE deal_type IN (
        'Mergers & Acquisitions','IPO & Capital Markets','Earnings & Results',
        'Macro & Policy','Geopolitics','Private Equity','Venture Capital',
        'Fundraising','Regulation & Legal','Leadership & Operations',
        'Crypto & Digital Assets','Regulation','Regulatory','Partnership',
        'Public Company News','Product Launch','Market Movement','Public Markets',
        'Market Entry','Expansion','Hiring','Public Markets & Earnings',
        'Macro/Geopolitical','Investment','Infrastructure Investment','PE',
        'Joint Venture','Joint-venture disambiguator'
   );
-- Expect ~8,169 rows. Compare against 1c.rows_2a_remap.

-- 2b. The literal string 'null' -> a real SQL NULL. Separate statement so the
--     count is visible on its own and cannot hide inside the remap total.
--     This is NOT the same as the 451 rows that already hold a real NULL;
--     those are untouched because `deal_type = 'null'` never matches SQL NULL.
UPDATE public.articles
   SET deal_type = NULL
 WHERE deal_type = 'null';
-- Expect 6 rows. Compare against 1c.rows_2b_to_null.

-- If either count disagrees with section 1, ROLLBACK; instead of COMMIT.
COMMIT;


-- ===========================================================================
-- 3. VERIFY (read-only). Expect zero rows from the first query.
-- ===========================================================================

SELECT deal_type, count(*) AS rows
FROM public.articles
WHERE deal_type IS NOT NULL
  AND deal_type NOT IN ('M&A','IPO','Funding','Earnings','Macro',
                        'Geopolitical','Other')
GROUP BY deal_type
ORDER BY rows DESC;

-- The literal-null rows should now be part of the real-NULL total.
-- Expect 451 + 6 = 457, assuming no new ingest in between.
SELECT count(*) AS real_nulls FROM public.articles WHERE deal_type IS NULL;

-- Corrected distribution, for the record.
SELECT deal_type, count(*) AS rows,
       round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS pct
FROM public.articles
GROUP BY deal_type
ORDER BY rows DESC;


-- ===========================================================================
-- 4. OPTIONAL: a CHECK constraint. NOT applied here, deliberately.
-- ===========================================================================
-- A constraint would make this class of bug impossible rather than merely
-- corrected. It is left out because it changes the failure MODE: a future
-- unmapped value would abort the article INSERT, and ingest inserts in bulk
-- batches, so one bad value could drop a whole batch. The code-side
-- validate_deal_type coerces to 'Other' and logs the value once, which fails
-- soft and still surfaces the leak.
--
-- Apply only if you would rather fail loud, and only AFTER section 3 returns
-- zero rows:
--
--   ALTER TABLE public.articles
--     ADD CONSTRAINT articles_deal_type_check
--     CHECK (deal_type IS NULL OR deal_type IN
--            ('M&A','IPO','Funding','Earnings','Macro','Geopolitical','Other'))
--     NOT VALID;
--
--   -- NOT VALID skips the full-table scan on add. Validate separately, off-peak:
--   ALTER TABLE public.articles VALIDATE CONSTRAINT articles_deal_type_check;
