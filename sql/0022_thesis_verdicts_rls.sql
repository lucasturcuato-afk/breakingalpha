-- 0022: RLS posture for thesis_verdicts (+ a re-check of 0020).
--
-- HUMAN-APPLIED. Agents do not apply migrations.
--
-- READ THIS FIRST -- the reported problem is NOT the live problem.
--
-- Probed live against prod on 2026-08-04 with the ANON key, using an empty
-- INSERT so nothing was written. An empty insert distinguishes the two cases
-- cleanly: 42501 means RLS refused the row; 23502 means RLS ALLOWED it and only
-- a NOT NULL constraint stopped it.
--
--   thesis_verdicts -> 42501  RLS already blocks anon writes   ✅ SECURE
--   trend_clusters  -> 42501  RLS already blocks anon writes   ✅ SECURE
--   theses          -> 23502  RLS ALLOWED the write            ⚠️  OPEN
--
-- So: the public insert/update policies declared in sql/grader_upgrade.sql:37-49
-- for thesis_verdicts are NOT live -- either never applied or since tightened.
-- No fix is required there. This file only asserts that state idempotently so a
-- future environment cannot drift back.
--
-- THE ACTUAL OPEN HOLE IS `theses`, because sql/0020_radar_rls_hardening.sql has
-- NOT been applied. Until it is, any holder of the public anon key can INSERT,
-- UPDATE and DELETE rows in `theses` -- the shared pipeline corpus that feeds
-- Thesis Tracker, Tracked Views, Trends and thesis generation.
--
--   >>> APPLY sql/0020_radar_rls_hardening.sql FIRST. It is the real fix. <<<
--
-- 0020 is already safe to apply: its prerequisite (client thesis inserts
-- stamping user_id, via src/lib/create-user-thesis.ts) shipped in #545 and was
-- verified in a signed-in browser -- an authenticated "Add to Thesis" wrote a
-- row carrying the caller's user_id.

-- ---------------------------------------------------------------------------
-- thesis_verdicts: assert service-role-only writes, public read.
-- Idempotent. If the environment already matches (as prod does), this is a
-- no-op that simply pins the intent.
-- ---------------------------------------------------------------------------
ALTER TABLE public.thesis_verdicts ENABLE ROW LEVEL SECURITY;

-- Drop any legacy world-writable policies from sql/grader_upgrade.sql.
DROP POLICY IF EXISTS "Public insert" ON public.thesis_verdicts;
DROP POLICY IF EXISTS "Public update" ON public.thesis_verdicts;
DROP POLICY IF EXISTS "Public delete" ON public.thesis_verdicts;

-- Verdicts are the grading record. They are written ONLY by the grading cron
-- (backend/thesis_grader.py) via the service role, which bypasses RLS. Leaving
-- no write policy is what makes client writes impossible.
DROP POLICY IF EXISTS thesis_verdicts_public_read ON public.thesis_verdicts;
CREATE POLICY thesis_verdicts_public_read ON public.thesis_verdicts
  FOR SELECT USING (true);

-- Public read is retained deliberately: /radar/track-record and the Tracked
-- Views review timeline read this table directly from the browser with the anon
-- key. Restricting SELECT would blank both surfaces. Verified: the only client
-- reads are SELECTs of (id, verdict, graded_at, confidence, notes,
-- model_version) -- no write path exists in the app.

-- ---------------------------------------------------------------------------
-- VERIFY after applying (expect 42501 on both, and on theses once 0020 is in)
-- ---------------------------------------------------------------------------
--   curl -s -X POST "$URL/rest/v1/thesis_verdicts" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H "Content-Type: application/json" -d '{}'
--   -> expect {"code":"42501", ... "violates row-level security policy"}
--
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='thesis_verdicts';
--   -> expect exactly one row: SELECT / thesis_verdicts_public_read
