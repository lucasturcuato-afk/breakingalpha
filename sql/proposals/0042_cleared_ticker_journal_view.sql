-- =====================================================================
-- 0042_cleared_ticker_journal_view.sql
--
--   *** PROPOSAL. NOT APPLIED. ***
--
-- One read-only view. No table is created, altered or dropped, no row is
-- written, and norm_v2.stamped_identity is not touched.
--
-- WHY IT EXISTS. backend/scripts/backfill_tickers.py must not re-propose a
-- ticker that a human cleared on purpose. The record of those clears is
-- norm_v2.stamped_identity with op = 'clear_ticker', written by
-- sql/proposals/0038. The backfill reads through PostgREST, and PostgREST
-- answers norm_v2 with:
--     {"code":"PGRST106","message":"Invalid schema: norm_v2",
--      "hint":"Only the following schemas are exposed: public, graphql_public"}
-- so the journal is unreachable from the application side. This view is the
-- narrowest thing that closes that gap.
--
-- WHY A VIEW AND NOT EXPOSING norm_v2. Exposing the schema publishes every
-- table in it, including Lucas's merge journal norm_v2.moved_row, to every
-- PostgREST caller. A view publishes two columns of one op and nothing else.
--
-- WHAT IT DELIBERATELY DOES NOT CARRY. No `after`, no `note`, no `ran_by`, no
-- `id`. The backfill needs to answer one question, "was this row cleared of
-- this ticker", and a view that answers only that cannot become a back door
-- into the journal.
--
-- SECURITY. `security_invoker = true` so the view executes as the caller and
-- does not become an ambient-authority read of a non-exposed schema. The
-- backfill runs with the service role, which is what it already needs for
-- companies.
-- =====================================================================
BEGIN;

CREATE OR REPLACE VIEW public.cleared_ticker_journal
  WITH (security_invoker = true) AS
SELECT j.row_id,
       (j.before->>'ticker') AS cleared_ticker,
       j.ran_at
  FROM norm_v2.stamped_identity j
 WHERE j.table_name = 'public.companies'
   AND j.op = 'clear_ticker'
   AND (j.before->>'ticker') IS NOT NULL;

COMMENT ON VIEW public.cleared_ticker_journal IS
  'Read-only projection of norm_v2.stamped_identity WHERE op = ''clear_ticker''. '
  'Exists because PostgREST exposes only public and graphql_public, so '
  'backend/scripts/backfill_tickers.py cannot read the journal directly. Carries '
  'row_id, the cleared ticker and the timestamp, and deliberately nothing else.';

GRANT SELECT ON public.cleared_ticker_journal TO service_role;

-- READ-BACK. Expect one row per applied 0038 block, each with a non-null
-- cleared_ticker. If this returns zero rows the backfill will refuse to run,
-- which is the intended direction: it fails closed on an unreadable journal.
SELECT row_id, cleared_ticker, ran_at
  FROM public.cleared_ticker_journal
 ORDER BY ran_at;

SELECT count(*) AS cleared_rows_visible FROM public.cleared_ticker_journal;

COMMIT;


-- ROLLBACK. Drops only the view.
-- BEGIN;
-- DROP VIEW IF EXISTS public.cleared_ticker_journal;
-- COMMIT;
