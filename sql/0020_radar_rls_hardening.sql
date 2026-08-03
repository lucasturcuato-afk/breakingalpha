-- 0020: RLS hardening for theses, lead_outcome_grades, trend_clusters.
--
-- HUMAN-APPLIED. Agents do not apply migrations. Read the notes before running.
--
-- WHY
-- Verified live against the prod project with the ANON key on 2026-08-03:
--   theses              -> HTTP 200, 57 rows returned UNAUTHENTICATED
--   trend_clusters      -> HTTP 200, rows returned UNAUTHENTICATED
--   user_claims/follows -> 0 rows (correctly owner-scoped already)
--
-- backend/theses_schema.sql grants public SELECT *and* INSERT/UPDATE/DELETE
-- with USING (true). A user_id column was added later
-- (supabase/migrations/20260416_add_theses_user_id.sql) but no policy was ever
-- tightened to match. All 57 live rows are user_id IS NULL (pipeline-generated),
-- so today the read exposure leaks no private data -- the real, present risk is
-- that ANY holder of the anon key can rewrite or DELETE the entire system
-- thesis corpus, which feeds Thesis Tracker, Trends and thesis generation.
--
-- DESIGN
-- theses is a MIXED table: system rows (user_id IS NULL) are meant to be world
-- readable; user rows are private. So SELECT stays open to system rows and adds
-- owner access, while writes become owner-only. Service role bypasses RLS, so
-- the Python pipeline is unaffected.
--
-- COMPATIBILITY (every client read was mapped before writing this)
-- Reads that KEEP working unchanged, because they only touch system rows:
--   src/app/radar/track-record/page.tsx, track-record/[thesis_id]/page.tsx,
--   src/app/trends/page.tsx, src/app/morning-brief|evening-wrap/page.tsx,
--   src/app/print/[briefing_id]/page.tsx, src/components/thesis/TrackedViews.tsx,
--   WhyThisThesis.tsx, verdict-evolution.tsx, feed-row.tsx, story-card.tsx,
--   dc-story-row.tsx  -- all are .select() over pipeline theses.
-- Server routes under src/app/api/theses* use the service role or the user's own
--   session and are unaffected.
-- Writes that REQUIRED a code change (shipped in this PR): the five client-side
--   inserts now stamp user_id via src/lib/create-user-thesis.ts. Without that
--   change this migration would break "add to thesis" on morning-brief,
--   evening-wrap (x3) and dc-analyst-section.
-- NOTE /morning-brief is a PUBLIC route (src/proxy.ts): signed-out visitors can
--   reach its "add to thesis" button. After this migration that action correctly
--   fails for them; the helper returns an explicit "sign in" result instead of
--   writing an orphan row.
--
-- ORDER: apply AFTER deploying this PR, so the inserts already send user_id.
-- REVERSIBLE: the DROP/CREATE pairs below can be inverted; see the rollback tail.

-- ---------------------------------------------------------------------------
-- 1. theses
-- ---------------------------------------------------------------------------
ALTER TABLE public.theses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON public.theses;
DROP POLICY IF EXISTS "Public insert" ON public.theses;
DROP POLICY IF EXISTS "Public update" ON public.theses;
DROP POLICY IF EXISTS "Public delete" ON public.theses;

-- System theses stay world-readable; a user additionally sees their own.
CREATE POLICY theses_read_system_or_own ON public.theses
  FOR SELECT
  USING (user_id IS NULL OR auth.uid() = user_id);

-- Writes are owner-only. user_id IS NULL rows become immutable from the client
-- (service role still bypasses RLS, so the pipeline keeps writing them).
CREATE POLICY theses_insert_own ON public.theses
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY theses_update_own ON public.theses
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY theses_delete_own ON public.theses
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. lead_outcome_grades  (sql/0014 never enabled RLS at all)
-- ---------------------------------------------------------------------------
-- Not user data: it is the desk's graded lead record, written by the backend
-- and read today only by backend jobs. Public READ is retained deliberately so
-- a future public record surface needs no migration; writes become service-role
-- only (no write policy + RLS enabled = client writes rejected).
ALTER TABLE public.lead_outcome_grades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_outcome_grades_public_read ON public.lead_outcome_grades;
CREATE POLICY lead_outcome_grades_public_read ON public.lead_outcome_grades
  FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- 3. trend_clusters  (backend/trend_clusters_schema.sql granted PUBLIC INSERT)
-- ---------------------------------------------------------------------------
-- Public insert let anyone write fabricated rows into the observation layer that
-- feeds Trends and thesis generation. Reads stay public; inserts become
-- service-role only.
DROP POLICY IF EXISTS "Public insert" ON public.trend_clusters;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying; expect the anon key to be blocked on writes)
-- ---------------------------------------------------------------------------
-- SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('theses','lead_outcome_grades','trend_clusters')
--  ORDER BY tablename, cmd;
--
-- Expected after apply:
--   theses               SELECT theses_read_system_or_own
--                        INSERT theses_insert_own
--                        UPDATE theses_update_own
--                        DELETE theses_delete_own
--   lead_outcome_grades  SELECT lead_outcome_grades_public_read   (no write policy)
--   trend_clusters       SELECT "Public read"                     (no insert policy)

-- ---------------------------------------------------------------------------
-- ROLLBACK (only if a client read regresses unexpectedly)
-- ---------------------------------------------------------------------------
-- DROP POLICY IF EXISTS theses_read_system_or_own ON public.theses;
-- DROP POLICY IF EXISTS theses_insert_own ON public.theses;
-- DROP POLICY IF EXISTS theses_update_own ON public.theses;
-- DROP POLICY IF EXISTS theses_delete_own ON public.theses;
-- CREATE POLICY "Public read"   ON public.theses FOR SELECT USING (true);
-- CREATE POLICY "Public insert" ON public.theses FOR INSERT WITH CHECK (true);
-- CREATE POLICY "Public update" ON public.theses FOR UPDATE USING (true);
-- CREATE POLICY "Public delete" ON public.theses FOR DELETE USING (true);
-- CREATE POLICY "Public insert" ON public.trend_clusters FOR INSERT WITH CHECK (true);
