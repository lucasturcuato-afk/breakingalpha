-- 0039_drop_thesis_notes.sql
--
-- HAND-APPLY. Noah/Lucas apply this; agents do not apply migrations.
--
-- DROPS public.thesis_notes. The feature it backed is removed in the same PR.
--
-- WHY REMOVE RATHER THAN FIX. The table had RLS enabled and zero policies,
-- and its only reader and writer ran on the user's session, so every read
-- answered empty and every write was refused while the panel said "Saved".
-- It has been in that state since the route shipped on 2026-04-13, and the
-- notes it would have held overlap the commit-note path on
-- morning_brief_calls and compose, which is the mechanism that actually
-- feeds the grading loop. A panel that reports Saved and saves nothing is
-- worse than no panel.
--
-- WHAT IS GONE FROM THE APP, in this PR: src/app/api/theses/notes/route.ts,
-- the notes textarea and Add Note control in
-- src/components/thesis/thesis-detail-panel.tsx, the thesis_notes join and
-- the DDL print in src/app/api/theses/route.ts, and the `notes` field on
-- ThesisItem. Nothing else read the table: verified by grep over src/,
-- backend/, tests/ and e2e/ on 2026-09-06.
--
-- NOTHING IS LOST. Verified live 2026-09-06 through the service role with an
-- exact count: the table holds 0 rows. Section 0 re-checks that before the
-- drop and stops you if a row has appeared since.
--
-- Sections:
--   0. VERIFY FIRST (read-only)
--   1. the drop
--   2. MEASURE AFTER (read-only)


-- ===========================================================================
-- 0. VERIFY FIRST. Read-only.
-- ===========================================================================

-- 0a. The table exists and is empty. Expect: a non-NULL regclass, and 0.
--     If rows_ is not 0, STOP: someone wrote through the service role since
--     2026-09-06. Look at the rows before dropping them.
--
--   SELECT to_regclass('public.thesis_notes')          AS tbl,
--          (SELECT count(*) FROM public.thesis_notes)   AS rows_;

-- 0b. Nothing depends on it: no view, no foreign key from another table.
--     Expect zero rows from both.
--
--   SELECT dependent.relname
--     FROM pg_depend d
--     JOIN pg_rewrite r        ON r.oid = d.objid
--     JOIN pg_class dependent  ON dependent.oid = r.ev_class
--    WHERE d.refobjid = 'public.thesis_notes'::regclass
--      AND dependent.relname <> 'thesis_notes';
--
--   SELECT conrelid::regclass AS referencing_table, conname
--     FROM pg_constraint
--    WHERE contype = 'f' AND confrelid = 'public.thesis_notes'::regclass;


-- ===========================================================================
-- 1. THE DROP. One statement. Runs inside a transaction; on a table with
--    zero rows and no dependents it is instant. IF EXISTS makes a second
--    run a no-op (NOTICE, no error).
-- ===========================================================================

DROP TABLE IF EXISTS public.thesis_notes;


-- ===========================================================================
-- 2. MEASURE AFTER. Read-only.
-- ===========================================================================

-- 2a. Gone. Expect NULL.
--
--   SELECT to_regclass('public.thesis_notes') AS tbl;

-- 2b. Nothing in the API surface still names it. Expect 0.
--
--   SELECT count(*) FROM pg_policies WHERE tablename = 'thesis_notes';
