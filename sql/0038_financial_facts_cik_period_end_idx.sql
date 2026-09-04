-- financial_facts: index the (cik, period_end) access path that the Company
-- Intel financials read actually uses.
--
-- !!! PROPOSED / NOT APPLIED !!!
-- Written for review only. As of 2026-09-03 NOT applied to the project (repo
-- convention: Noah applies committed migrations by hand). The application fix
-- in src/lib/financial-facts.ts does NOT depend on this index; it is already
-- correct and already faster without it. This index makes the same query
-- cheaper still. Ship order does not matter.
--
-- WHAT THE READ DOES. src/lib/financial-facts.ts asks financial_facts_latest
-- for one company's facts:
--
--   SELECT <9 cols> FROM financial_facts_latest
--    WHERE cik = $1 AND period_end >= $2 AND fiscal_period IN ('FY','Q1'..'Q4')
--    ORDER BY period_end DESC LIMIT 1000
--
-- and financial_facts_latest is
--   SELECT DISTINCT ON (cik, metric_key, period_type, period_start, period_end,
--                       unit) * FROM financial_facts
--    WHERE validation_status = 'validated'
--    ORDER BY ..., filed_date DESC NULLS LAST, created_at DESC
--
-- Postgres pushes a qual into a DISTINCT ON subquery only when the qual's
-- column belongs to the DISTINCT ON key (check_output_expressions in
-- optimizer/path/allpaths.c marks every other output column unsafe). `cik` and
-- `period_end` qualify; `fiscal_period` does not, and neither LIMIT nor the
-- ORDER BY can reduce anything before the dedup. So `cik` and `period_end` are
-- the only two levers the plan has, and both want one index.
--
-- WHY THE EXISTING INDEX IS NOT THAT INDEX.
--   financial_facts_cik_metric_period_idx (cik, metric_key, period_end DESC)
-- puts metric_key between the two columns the query restricts. `period_end`
-- is reachable only as a non-contiguous scan key, so the scan still walks
-- every index entry the company has instead of descending straight to the
-- wanted range. For the longest-filing issuers that is more than an order of
-- magnitude more entries than a recent listing carries.
--
-- WHAT THIS ONE CHANGES. (cik, period_end DESC) makes the bounded read a
-- leading-key range scan: it touches the company's recent rows and stops.
-- Partial on validation_status = 'validated' because the view and the RLS
-- policy both restrict to that, so quarantined rows are dead weight in this
-- index and the predicate lets the planner use it for the view's own WHERE.
--
-- MEASURED read-only, warm buffers, one query at a time: the application bound
-- alone roughly halves the rows the view materialises for the heaviest filers
-- and cuts their warm latency by a similar proportion, and it flattens the
-- spread between the heaviest and lightest companies rather than merely
-- shifting it. This index moves the remaining scan cost, not the row count.
--
-- APPLY IT OUTSIDE A TRANSACTION. CREATE INDEX CONCURRENTLY cannot run inside
-- one, and the Supabase migration runner wraps migrations in a transaction, so
-- run this statement on its own (psql / Studio SQL editor) rather than through
-- `supabase db push`. CONCURRENTLY is deliberate: financial_facts is written by
-- backend/ingest_xbrl_facts.py and a plain CREATE INDEX takes a lock that
-- blocks that job for the duration of the build.

CREATE INDEX CONCURRENTLY IF NOT EXISTS financial_facts_cik_period_end_validated_idx
    ON public.financial_facts (cik, period_end DESC)
    WHERE validation_status = 'validated';

COMMENT ON INDEX public.financial_facts_cik_period_end_validated_idx IS
    'Serves the Company Intel financials read: financial_facts_latest filtered '
    'by cik and bounded by period_end (the only two quals Postgres can push '
    'into the view''s DISTINCT ON). Partial on validated because both the view '
    'and the RLS SELECT policy restrict to validated rows. '
    'See src/lib/financial-facts.ts FACT_LOOKBACK_YEARS.';
