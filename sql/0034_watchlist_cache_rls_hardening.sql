-- 0034: RLS hardening for watchlist_articles and watchlist_briefs.
--
-- HUMAN-APPLIED. NOT APPLIED BY THIS PR. Agents do not apply migrations.
-- Read the notes before running.
--
-- WHY
-- backend/watchlist_articles_schema.sql:44-50 and :69-75 created both tables
-- with RLS enabled and the full public quartet:
--
--   CREATE POLICY "Public read"   ON <t> FOR SELECT USING (true);
--   CREATE POLICY "Public insert" ON <t> FOR INSERT WITH CHECK (true);
--   CREATE POLICY "Public update" ON <t> FOR UPDATE USING (true);
--   CREATE POLICY "Public delete" ON <t> FOR DELETE USING (true);
--
-- NEXT_PUBLIC_SUPABASE_ANON_KEY ships to the browser, so any holder of it can
-- rewrite or delete every row in both tables directly through PostgREST,
-- without touching any app route.
--
-- Verified live against the prod project with the ANON key on 2026-08-31,
-- read-only:
--   watchlist_briefs   -> HTTP 206, content-range 0-0/3      UNAUTHENTICATED
--   watchlist_articles -> HTTP 206, content-range 0-0/19328  UNAUTHENTICATED
--   watchlist          -> HTTP 200, 0 rows (correctly owner-scoped already)
--
-- Write-deny was NOT verified: confirming it requires issuing a write against
-- prod, and this work was SELECT-only by constraint. The policy text above is
-- from the committed schema file. Whoever applies this should confirm the live
-- policy set first with the VERIFY block at the bottom.
--
-- The read exposure leaks no private data: neither table has a user_id column,
-- and the contents are cached public-company news and LLM briefs generated
-- from it. The present risk is INTEGRITY and AVAILABILITY, not confidentiality
-- -- anyone with the anon key can poison the NVDA brief that every user then
-- sees on the company page, in the watchlist, and in the exported PDF, or drop
-- all 19,328 cached article rows.
--
-- DESIGN
-- Writes become service-role only. Reads stay public, deliberately and for the
-- same reason sql/0020 kept lead_outcome_grades readable: no user data is
-- involved, no user_id column exists to scope to, and tightening reads to
-- `authenticated` needs every signed-out read path mapped first. That is a
-- separate decision, not this migration's job.
--
-- Service role bypasses RLS, so removing the write policies leaves both
-- writers working. This is Phase 2 of the lockdown the code prerequisite
-- already shipped for.
--
-- COMPATIBILITY (every writer was mapped before writing this)
--   watchlist_briefs
--     src/app/api/watchlist-briefs/route.ts  -- the ONLY writer. Already
--       service-role, hard: it 500s if SUPABASE_SERVICE_ROLE_KEY is missing
--       rather than falling back to anon. Its header comment names this
--       migration as the reason it exists: "moved here so the write runs as
--       service-role, which is a prerequisite for locking watchlist_briefs
--       writes to service-role-only in the RLS lockdown (Phase 2)".
--     src/app/watchlist/[identifier]/page.tsx:180 posts to that route; it does
--       not write the table from the browser.
--   watchlist_articles
--     backend/watchlist_sync.py:500 upsert, :633 and :645 delete. Uses
--       get_service_client(). Unaffected.
--   No other insert/update/upsert/delete against either table exists in src/
--   or backend/.
--
-- Readers are unaffected: this migration does not touch SELECT.
--
-- ORDER: safe to apply at any time. The service-role writers are already live
-- on main; there is no code change to deploy first.
-- IDEMPOTENT: DROP POLICY IF EXISTS. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. watchlist_articles
-- ---------------------------------------------------------------------------
ALTER TABLE public.watchlist_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert" ON public.watchlist_articles;
DROP POLICY IF EXISTS "Public update" ON public.watchlist_articles;
DROP POLICY IF EXISTS "Public delete" ON public.watchlist_articles;

-- "Public read" is retained deliberately. See DESIGN above.

-- ---------------------------------------------------------------------------
-- 2. watchlist_briefs
-- ---------------------------------------------------------------------------
ALTER TABLE public.watchlist_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert" ON public.watchlist_briefs;
DROP POLICY IF EXISTS "Public update" ON public.watchlist_briefs;
DROP POLICY IF EXISTS "Public delete" ON public.watchlist_briefs;

-- "Public read" is retained deliberately. See DESIGN above.

-- ---------------------------------------------------------------------------
-- VERIFY (run BEFORE, to confirm the live policy set, and AFTER)
-- ---------------------------------------------------------------------------
-- SELECT tablename, policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('watchlist_articles','watchlist_briefs')
--  ORDER BY tablename, cmd;
--
-- Expected after apply: exactly one row per table,
--   watchlist_articles  SELECT  "Public read"
--   watchlist_briefs    SELECT  "Public read"
--
-- Then confirm the writers still work:
--   - POST /api/watchlist-briefs with a real body, expect {"ok":true}
--   - the next scheduled backend/watchlist_sync.py run, expect upserts to land
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (only if a writer regresses unexpectedly)
-- ---------------------------------------------------------------------------
-- CREATE POLICY "Public insert" ON public.watchlist_articles FOR INSERT WITH CHECK (true);
-- CREATE POLICY "Public update" ON public.watchlist_articles FOR UPDATE USING (true);
-- CREATE POLICY "Public delete" ON public.watchlist_articles FOR DELETE USING (true);
-- CREATE POLICY "Public insert" ON public.watchlist_briefs   FOR INSERT WITH CHECK (true);
-- CREATE POLICY "Public update" ON public.watchlist_briefs   FOR UPDATE USING (true);
-- CREATE POLICY "Public delete" ON public.watchlist_briefs   FOR DELETE USING (true);
