-- 0039_thesis_notes_owner_policies.sql
--
-- HAND-APPLY. Noah/Lucas apply this; agents do not apply migrations.
--
-- THE DEFECT. public.thesis_notes has RLS enabled and ZERO policies, and the
-- only reader and writer is src/app/api/theses/notes/route.ts, which runs on
-- the user's session (getSupabaseWithUser). Under RLS with no policy a
-- session read returns [] and a session write is rejected with 42501. So:
--   GET   always answers { note: null }
--   POST  always fails; the panel then calls setNoteSaved(true) anyway,
--         because fetch() does not throw on a 500, and shows "Saved".
-- Verified live 2026-09-05: the table holds ZERO rows to the service role,
-- so no note was ever persisted. Nothing was lost after being written;
-- every note was refused at the door while the UI said it was saved.
-- The route has been in this shape since 2026-04-13 (commit 6229c324).
-- The date RLS was switched on for this table is not recorded in the repo
-- (the table has no DDL here at all); the pipeline-side lockdown began
-- 2026-06-08 (#338), which is the earliest the feature can have gone dead
-- and the latest date at which it still worked is unknown.
--
-- THE SECOND DEFECT, fixed in the same file. The table has no user_id:
--   thesis_notes(id uuid PK, thesis_id uuid, content text, updated_at)
-- and the route upserts ON CONFLICT (thesis_id), so even with a policy the
-- notes would be ONE NOTE PER THESIS SHARED BY EVERY USER. A note is a
-- reader's private annotation. This adds user_id, scopes uniqueness to
-- (user_id, thesis_id), and writes owner-scoped policies on user_id. The
-- route change that writes user_id ships in the same PR.
--
-- Safe because the table is empty: the NOT NULL column and the new UNIQUE
-- add instantly and nothing can violate them. If a row ever appears before
-- this runs, section 0 stops you.
--
-- Sections:
--   0. VERIFY FIRST (read-only)
--   1. column + uniqueness
--   2. policies
--   3. MEASURE AFTER (read-only)


-- ===========================================================================
-- 0. VERIFY FIRST. All read-only.
-- ===========================================================================

-- 0a. The state this file assumes: RLS on, no policies, no user_id, no rows.
--     Expect: t | 0 | f | 0
--
--   SELECT c.relrowsecurity                                        AS rls_on,
--          (SELECT count(*) FROM pg_policies
--            WHERE schemaname='public' AND tablename='thesis_notes') AS policies,
--          EXISTS (SELECT 1 FROM information_schema.columns
--                   WHERE table_schema='public' AND table_name='thesis_notes'
--                     AND column_name='user_id')                    AS has_user_id,
--          (SELECT count(*) FROM public.thesis_notes)               AS rows_
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname = 'thesis_notes';
--
--   If rows_ is not 0, STOP: someone wrote through the service role and
--   those rows have no owner. Decide who owns them before adding NOT NULL.

-- 0b. The existing uniqueness on thesis_id, which section 1 replaces.
--
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint WHERE conrelid = 'public.thesis_notes'::regclass;
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'thesis_notes';


-- ===========================================================================
-- 1. OWNER COLUMN AND UNIQUENESS. One paste.
-- ===========================================================================

ALTER TABLE public.thesis_notes
    ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL DEFAULT auth.uid()
        REFERENCES auth.users(id) ON DELETE CASCADE;

-- The DEFAULT auth.uid() is a belt for the session path only; the route
-- writes user_id explicitly. Drop the default so a service-role insert
-- without an owner fails instead of storing NULL-as-uid.
ALTER TABLE public.thesis_notes ALTER COLUMN user_id DROP DEFAULT;

-- Replace the per-thesis uniqueness with per-(user, thesis). The old
-- constraint's name is not recorded in the repo; 0b shows it. Both forms are
-- handled: a named constraint, or a bare unique index.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.thesis_notes'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (thesis_id)'
  LOOP
    EXECUTE format('ALTER TABLE public.thesis_notes DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN
    SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'thesis_notes'
       AND indexdef ~* 'UNIQUE INDEX .* \(thesis_id\)$'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
  END LOOP;
END $$;

ALTER TABLE public.thesis_notes
    ADD CONSTRAINT thesis_notes_user_thesis_uq UNIQUE (user_id, thesis_id);

COMMENT ON COLUMN public.thesis_notes.user_id IS
    'Owner. A note is one reader''s private annotation on a thesis; '
    'uniqueness and every policy are scoped to (user_id, thesis_id).';


-- ===========================================================================
-- 2. POLICIES. One paste. Owner-scoped on user_id, all four verbs.
--    Same shape as backend/watchlist_notes_schema.sql.
-- ===========================================================================

ALTER TABLE public.thesis_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS thesis_notes_owner_select ON public.thesis_notes;
CREATE POLICY thesis_notes_owner_select ON public.thesis_notes
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS thesis_notes_owner_insert ON public.thesis_notes;
CREATE POLICY thesis_notes_owner_insert ON public.thesis_notes
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS thesis_notes_owner_update ON public.thesis_notes;
CREATE POLICY thesis_notes_owner_update ON public.thesis_notes
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS thesis_notes_owner_delete ON public.thesis_notes;
CREATE POLICY thesis_notes_owner_delete ON public.thesis_notes
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.thesis_notes TO authenticated;


-- ===========================================================================
-- 3. MEASURE AFTER. Read-only.
-- ===========================================================================

-- 3a. Four policies, one per verb. Expect four rows.
--
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'thesis_notes' ORDER BY cmd;

-- 3b. The uniqueness moved. Expect exactly thesis_notes_user_thesis_uq
--     among the UNIQUE constraints, and nothing on thesis_id alone.
--
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint WHERE conrelid = 'public.thesis_notes'::regclass;

-- 3c. Live proof, from the app: open any thesis, type a note, reload. The
--     note comes back. Before this file it always came back empty.
