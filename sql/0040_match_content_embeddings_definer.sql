-- 0040_match_content_embeddings_definer.sql
--
-- HAND-APPLY. Noah/Lucas apply this; agents do not apply migrations.
--
-- THE DEFECT. public.match_content_embeddings(query_embedding vector,
-- match_threshold double precision, match_count integer) runs as SECURITY
-- INVOKER, and content_embeddings has RLS enabled with zero policies. So the
-- function returns rows to the service role and ZERO rows, with no error,
-- to anon and authenticated callers. Verified live 2026-09-05 with the same
-- arguments: service role 1 row, anon 0 rows, an authenticated session 0
-- rows. Every follow match from a session or browser client therefore reads
-- as "nothing matched":
--   src/lib/radar-following.ts:135            the RPC call
--   src/app/api/radar/following-feed/route.ts  Radar following feed (session)
--   src/app/radar/calls/page.tsx               calls page (browser client)
--   src/lib/watch-data.ts via watch/page.tsx and watch/watchlist/page.tsx
--                                              both watch pages (session)
--
-- THE FIX. The same pattern as sql/0021_related_articles_rpc.sql: SECURITY
-- DEFINER with search_path pinned. The function's return shape was read
-- live: (id, content_type, content_id, similarity). It exposes no embedding
-- vector and no content_text, which is what makes DEFINER acceptable here,
-- exactly as 0021 argues for related_articles.
--
-- ALTER, not CREATE OR REPLACE. The function body is not in this repo (no
-- migration created it), so rewriting it would replace live behaviour with
-- a guess. ALTER FUNCTION changes only the two attributes and leaves the
-- body, the return type and the argument list untouched. The regprocedure
-- cast renders the exact live signature, so argument ORDER, which the repo
-- also does not record, never has to be typed by hand.
--
-- Sections:
--   0. VERIFY FIRST (read-only)
--   1. the change
--   2. MEASURE AFTER (read-only)


-- ===========================================================================
-- 0. VERIFY FIRST. All read-only.
-- ===========================================================================

-- 0a. Exactly one function of that name, currently INVOKER (prosecdef = f),
--     and what it returns. Expect one row, prosecdef f, and a result type
--     that names id/content_type/content_id/similarity and nothing wider.
--
--   SELECT p.oid::regprocedure                          AS signature,
--          p.prosecdef                                  AS is_definer,
--          p.proconfig                                  AS config,
--          pg_get_function_result(p.oid)                AS returns
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'match_content_embeddings';
--
--   If `returns` includes embedding or content_text, STOP and read 0021's
--   reasoning before granting anon a definer path to it.

-- 0b. The RLS state that makes INVOKER return nothing.
--
--   SELECT c.relrowsecurity AS rls_on,
--          (SELECT count(*) FROM pg_policies
--            WHERE schemaname='public' AND tablename='content_embeddings') AS policies
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public' AND c.relname='content_embeddings';
--   -- expect: t | 0


-- ===========================================================================
-- 1. THE CHANGE. One paste. Resolves the live signature by name, refuses to
--    guess if there is not exactly one, then flips the two attributes and
--    (re)grants execute to the web roles.
-- ===========================================================================

DO $$
DECLARE
  sig text;
  n   int;
BEGIN
  SELECT count(*), min(p.oid::regprocedure::text)
    INTO n, sig
    FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname = 'public' AND p.proname = 'match_content_embeddings';

  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.match_content_embeddings, found %', n;
  END IF;

  EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', sig);
  EXECUTE format('ALTER FUNCTION %s SET search_path = public', sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', sig);

  RAISE NOTICE 'altered %', sig;
END $$;


-- ===========================================================================
-- 2. MEASURE AFTER. Read-only.
-- ===========================================================================

-- 2a. Attributes landed. Expect prosecdef t and config {search_path=public}.
--
--   SELECT p.oid::regprocedure, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'match_content_embeddings';

-- 2b. Behavioural proof from the app, per surface, signed in:
--     Radar following feed and both watch pages show matched articles under a
--     topic follow that has an embedding; the calls page shows related
--     stories. Before this file all four rendered their empty state with no
--     error in the console or the network tab.
