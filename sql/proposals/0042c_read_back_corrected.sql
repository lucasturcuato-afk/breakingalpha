-- =====================================================================
-- 0042c_read_back_corrected.sql
--
--   *** READ-ONLY. Replaces 0042 BLOCK C, which had a bug in the CHECK
--   *** rather than in the view. Changes nothing.
--
-- WHAT WENT WRONG IN BLOCK C. It ran, in this order:
--     SET LOCAL ROLE service_role;
--     SELECT ... has_table_privilege('service_role','norm_v2.stamped_identity','SELECT') ...
-- has_table_privilege() given a TEXT table name must RESOLVE that name, and
-- resolving a schema-qualified name requires USAGE on the schema FOR THE
-- CURRENT ROLE. service_role has no USAGE on norm_v2, so the resolution itself
-- raised 42501 before any privilege was reported.
--
-- The check needed the very privilege whose absence it was asserting. It is
-- the same shape as a signal that sits downstream of the thing it checks.
--
-- The view was never implicated: 0042b showed reloptions NULL and owner
-- postgres, and postgres owns norm_v2.stamped_identity, so the view resolves
-- its source as its owner exactly as intended.
--
-- THE FIX. Every privilege question is asked AS THE EDITOR, which can resolve
-- norm_v2 names. The role switch then wraps ONLY the view read, which is the
-- single thing that has to work as service_role.
-- =====================================================================
BEGIN;

-- C1. The view's contents, as the editor. EXPECT one row per applied 0038
--     clear, each with a non-null cleared_ticker.
SELECT row_id, cleared_ticker, ran_at
  FROM public.cleared_ticker_journal ORDER BY ran_at;

-- C2. THE CONFINEMENT, asked as the EDITOR so the name resolves.
--     has_schema_privilege takes a name and needs no resolution.
--     has_table_privilege is given a REGCLASS resolved here, by a role that
--     can see norm_v2, and the answer is still about service_role.
--     EXPECT three falses.
SELECT has_schema_privilege('service_role', 'norm_v2', 'USAGE')                       AS has_usage,
       has_table_privilege('service_role', 'norm_v2.stamped_identity'::regclass, 'SELECT') AS has_stamped_select,
       has_table_privilege('service_role', 'norm_v2.moved_row'::regclass, 'SELECT')        AS has_moved_row_select;

-- C3. THE READ THAT MATTERS, and the ONLY thing inside the role switch.
--     EXPECT the same count as C1. If this works while C2 is all false, the
--     view reads and the schema does not, which is the entire claim.
SET LOCAL ROLE service_role;
SELECT count(*) AS visible_as_service_role FROM public.cleared_ticker_journal;
RESET ROLE;

-- C4. Every norm_v2 object service_role can reach. EXPECT zero rows, matching
--     0042 A3 exactly. This is what confirms no norm_v2 object became
--     reachable when the view was created.
SELECT n.nspname AS schema, c.relname AS object, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'norm_v2'
   AND has_schema_privilege('service_role', n.nspname, 'USAGE')
 ORDER BY 1, 2;

COMMIT;
