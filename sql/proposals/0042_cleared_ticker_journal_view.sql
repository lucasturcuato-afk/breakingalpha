-- =====================================================================
-- 0042_cleared_ticker_journal_view.sql
--
--   *** PROPOSAL. NOT APPLIED. ***
--
-- ONE READ-ONLY VIEW. No table is created, altered or dropped. No row is
-- written anywhere. norm_v2.stamped_identity is READ and never modified.
-- norm_v2.moved_row is NOT touched and NOT exposed; it is named here only to
-- say why the schema is not exposed wholesale.
--
-- WHY IT EXISTS. backend/scripts/backfill_tickers.py must not re-propose a
-- ticker a human cleared on purpose. The record of those clears is
-- norm_v2.stamped_identity WHERE op = 'clear_ticker', written by 0038. The
-- backfill reads through PostgREST, and PostgREST answers norm_v2 with:
--     {"code":"PGRST106","message":"Invalid schema: norm_v2",
--      "hint":"Only the following schemas are exposed: public, graphql_public"}
--
-- ========== WHAT THIS DOES AND DOES NOT EXPOSE. READ THIS PART. ==========
--
-- EXPOSES, to service_role only, three columns of one op:
--     row_id           uuid        which companies row was cleared
--     cleared_ticker   text        the symbol taken off it
--     ran_at           timestamptz when
--
-- DOES NOT EXPOSE:
--   * norm_v2 as a schema. There is NO `GRANT USAGE ON SCHEMA norm_v2` in this
--     file and no change to the PostgREST exposed-schema list. Every other
--     norm_v2 table, INCLUDING Lucas's merge journal norm_v2.moved_row, stays
--     unreachable through the API exactly as it is today.
--   * the other columns of stamped_identity. `after`, `note`, `ran_by` and `id`
--     are not selected. The backfill answers one question, "was this row
--     cleared of this ticker", and a view that answers only that cannot become
--     a back door into the journal.
--   * the 'stamp_identity' rows. The WHERE pins op = 'clear_ticker', so the
--     twenty identity stamps are not visible through this view at all.
--
-- ========== WHY NOT security_invoker, WHICH IS THE OBVIOUS CHOICE ==========
--
-- A security_invoker view runs as the CALLER, so service_role would need
-- `GRANT USAGE ON SCHEMA norm_v2` plus `GRANT SELECT ON norm_v2.stamped_identity`
-- for it to work at all. THAT GRANTS STRICTLY MORE THAN THIS VIEW EXPOSES: with
-- USAGE on the schema, service_role can read every norm_v2 table directly the
-- moment the schema is exposed, or through any other view. It defeats the
-- narrowing this file exists to provide.
--
-- So the view is left at the PostgreSQL default (security_invoker = false): it
-- runs as its OWNER, and the owner's access to norm_v2 is what makes the three
-- columns readable. That is the mechanism that lets a narrow view be a
-- controlled window into a schema the caller cannot otherwise reach. The
-- privilege boundary is then the GRANT on the view, and there is exactly one.
--
-- BLOCK A  pre-flight, read-only
-- BLOCK B  the view
-- BLOCK C  read-back, including a real service_role read
-- BLOCK D  rollback, commented
-- =====================================================================


-- =====================================================================
-- BLOCK A  -- PRE-FLIGHT. Read-only. Changes nothing. Run it first.
-- =====================================================================
BEGIN;

-- A1. The source table must exist with the column this view reads.
--     EXPECT one row: before, jsonb.
SELECT table_schema, table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'norm_v2' AND table_name = 'stamped_identity'
   AND column_name = 'before';

-- A2. What the journal holds, by op. EXPECT clear_ticker rows to exist; if
--     there are none, this view will be empty and the backfill will refuse to
--     run, which is the intended fail-closed direction but worth seeing first.
SELECT op, count(*) AS rows, min(ran_at) AS first_at, max(ran_at) AS last_at
  FROM norm_v2.stamped_identity
 GROUP BY op ORDER BY op;

-- A3. WHAT IS EXPOSED THROUGH THE API TODAY, BEFORE THIS FILE.
--     EXPECT zero rows mentioning norm_v2. This is the baseline the read-back
--     in BLOCK C is compared against, so the diff is one view and nothing else.
SELECT n.nspname AS schema, c.relname AS object, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'norm_v2'
   AND has_schema_privilege('service_role', n.nspname, 'USAGE')
 ORDER BY 1, 2;

-- A4. Does the view name already exist? EXPECT zero rows on a first apply.
SELECT schemaname, viewname, viewowner
  FROM pg_views WHERE schemaname = 'public' AND viewname = 'cleared_ticker_journal';

COMMIT;


-- =====================================================================
-- BLOCK B  -- THE VIEW. The only statement in this file that changes anything.
-- =====================================================================
BEGIN;

CREATE OR REPLACE VIEW public.cleared_ticker_journal AS
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
  'backend/scripts/backfill_tickers.py cannot read the journal directly. '
  'Carries row_id, the cleared ticker and the timestamp, and nothing else. '
  'Deliberately NOT security_invoker: that would require granting service_role '
  'USAGE on norm_v2, which exposes more than this view does.';

-- The only privilege granted by this file.
GRANT SELECT ON public.cleared_ticker_journal TO service_role;

COMMIT;


-- =====================================================================
-- BLOCK C  -- READ-BACK. Read-only. Run it after BLOCK B commits.
-- =====================================================================
BEGIN;

-- C1. The view's contents. EXPECT one row per applied 0038 clear block, each
--     with a non-null cleared_ticker.
SELECT row_id, cleared_ticker, ran_at
  FROM public.cleared_ticker_journal ORDER BY ran_at;

SELECT count(*) AS cleared_rows_visible FROM public.cleared_ticker_journal;

-- C2. *** THE CHECK THAT MATTERS. *** Read it AS service_role, which is the
--     role the backfill actually uses. If this errors, the view does not work
--     for its one caller and BLOCK D should be run. If it returns the same
--     count as C1, the view works without service_role holding any privilege
--     on norm_v2, which is the whole design.
SET LOCAL ROLE service_role;
SELECT count(*) AS visible_as_service_role FROM public.cleared_ticker_journal;

-- C3. AND THE CONFINEMENT. Still as service_role, prove the schema itself is
--     NOT reachable. EXPECT has_usage = false, and EXPECT the direct read on
--     the next line to RAISE permission denied if you uncomment it.
SELECT has_schema_privilege('service_role', 'norm_v2', 'USAGE') AS has_usage,
       has_table_privilege('service_role', 'norm_v2.stamped_identity', 'SELECT') AS has_table_select,
       has_table_privilege('service_role', 'norm_v2.moved_row', 'SELECT') AS has_moved_row_select;
-- Uncomment to prove it raises rather than returning rows. It aborts the
-- transaction, so run it last or in its own paste.
-- SELECT count(*) FROM norm_v2.moved_row;

RESET ROLE;

-- C4. Same enumeration as A3. EXPECT it to be UNCHANGED from A3, which is what
--     confirms no norm_v2 object became reachable.
SELECT n.nspname AS schema, c.relname AS object, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'norm_v2'
   AND has_schema_privilege('service_role', n.nspname, 'USAGE')
 ORDER BY 1, 2;

COMMIT;


-- =====================================================================
-- BLOCK D  -- ROLLBACK. Drops the view and nothing else. No journal row is
--             touched, because this file never wrote one.
-- =====================================================================
-- BEGIN;
--
-- DROP VIEW IF EXISTS public.cleared_ticker_journal;
--
-- -- EXPECT zero rows.
-- SELECT schemaname, viewname FROM pg_views
--  WHERE schemaname = 'public' AND viewname = 'cleared_ticker_journal';
--
-- COMMIT;
