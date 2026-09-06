-- =====================================================================
-- 0042b_view_owner_diagnostic.sql
--
--   *** DIAGNOSTIC. READ-ONLY. Changes nothing. ***
--
-- 0042 BLOCK C failed with:
--     ERROR: 42501: permission denied for schema norm_v2
--
-- A view created WITHOUT `security_invoker` should check the underlying
-- schema and table as its OWNER, so a service_role read of the view should
-- never touch service_role's privileges on norm_v2. Getting 42501 means one
-- of three things, and these queries tell them apart rather than guessing:
--
--   1. The view really is security_invoker after all, because something in
--      this database sets it by default.
--   2. The view's OWNER is a role that itself lacks USAGE on norm_v2.
--   3. The failure came from a statement other than the view read.
--
-- Run this whole block. Every query is a SELECT.
-- =====================================================================
BEGIN;

-- D1. Who is actually running this, and what does the editor's role hold.
SELECT current_user, session_user,
       has_schema_privilege(current_user, 'norm_v2', 'USAGE') AS editor_has_norm_v2_usage;

-- D2. THE VIEW'S OWNER AND ITS OPTIONS. reloptions is NULL when no option was
--     set. If it contains security_invoker=true, cause 1 is confirmed.
SELECT c.relname,
       pg_get_userbyid(c.relowner) AS view_owner,
       c.reloptions
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'cleared_ticker_journal';

-- D3. DOES THE OWNER HAVE WHAT THE VIEW NEEDS. If either is false, cause 2 is
--     confirmed and the owner is the thing to change, not service_role.
SELECT pg_get_userbyid(c.relowner) AS view_owner,
       has_schema_privilege(pg_get_userbyid(c.relowner), 'norm_v2', 'USAGE') AS owner_has_usage,
       has_table_privilege(pg_get_userbyid(c.relowner), 'norm_v2.stamped_identity', 'SELECT') AS owner_can_select
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'cleared_ticker_journal';

-- D4. Isolate the failing statement. C1 does NOT switch role. If this returns
--     rows, the view itself is fine for the editor and the failure was C2.
SELECT count(*) AS c1_rows_as_editor FROM public.cleared_ticker_journal;

-- D5. Who owns the journal table, for the owner-alignment question.
SELECT c.relname, pg_get_userbyid(c.relowner) AS table_owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'norm_v2' AND c.relname IN ('stamped_identity', 'moved_row')
 ORDER BY 1;

COMMIT;
