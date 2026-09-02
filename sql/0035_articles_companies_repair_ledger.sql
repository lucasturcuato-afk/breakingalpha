-- =====================================================================
-- 0035_articles_companies_repair_ledger.sql
--
-- HAND-APPLY. Additive only: one new table and one new read-only function.
-- No existing column is altered, dropped or backfilled by this file.
--
-- Backs tools/repair_articles_companies.py, the step 12 repair of
-- articles.companies[] after the norm_v2 merge (sql/proposals/0020 + 0020b).
--
-- WHY. The merge repoints dependents by company_id and DELETES the loser
-- companies rows. articles.companies[] stores NAMES, and nothing in 0020 or
-- 0020b touches articles at all, so every merged-away name in that array now
-- refers to a company that does not exist. Those articles stop matching a
-- companies[]-based query. This is the other half of the merge, not cleanup.
--
-- MEASURED 2026-09-01, AFTER the merge (800 clusters, companies 5,599 -> 4,254):
--   articles scanned                                     197,985
--   articles with a non-empty companies[]                 148,746
--   articles holding >=1 name absent from companies        39,186
--     of which the name is a MERGE LOSER (repairable here) 13,972
--     of which the name was never a company row            25,554
--     both                                                     340
--
-- THIS FILE REPAIRS THE 13,972 ONLY. The other 25,554 are articles whose
-- companies[] holds an LLM-extracted string that never resolved to a canonical
-- row ('NVIDIA', 'Visa', 'RTX', 'TSLA'). That is a pre-existing condition with
-- a different cause and a different fix, and silently folding it into a merge
-- repair would hide it. See section 4.
--
-- SCOPE NOTE ON sql/0029 SECTION 4. That section's 12a query joins the backfill
-- ledger, so it can only see articles the BACKFILL wrote: 2,321 of the 39,186,
-- 5.9%. It is not a measure of the problem. This file works from the array
-- itself rather than from the ledger.
-- =====================================================================


-- =====================================================================
-- SECTION 0 -- INSPECT. Read-only. Run first.
-- =====================================================================

-- 0a. Does the table already exist, and does it hold a prior run?
--
--   SELECT to_regclass('public.articles_companies_repair') AS tbl;
--   SELECT run_id, count(*) AS rows, min(applied_at) AS started,
--          max(applied_at) AS finished
--     FROM public.articles_companies_repair
--    GROUP BY run_id ORDER BY started DESC;

-- 0b. The merge must be DRAINED before this runs. A cluster merged after the
--     repair leaves fresh stale names behind it.
--
--   SELECT count(*) FILTER (WHERE merged_at IS NOT NULL) AS merged,
--          count(*) FILTER (WHERE approved AND risk <> 'block'
--                             AND merged_at IS NULL)     AS still_to_merge
--     FROM norm_v2.plan_cluster;
--     still_to_merge MUST be 0.

-- 0c. The apply path this reuses. articles.companies is the only column either
--     one writes.
--
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'apply_companies_backfill';
--     EXPECT one row. If missing, apply sql/0029 section 1b first.


-- =====================================================================
-- SECTION 1 -- the repair ledger.
--
-- Separate from public.articles_companies_backfill on purpose. That table
-- carries UNIQUE (article_id), meaning an article is folded at most once ever,
-- which is correct for a one-shot backfill and wrong here: an article can hold
-- two different loser names, and an article the backfill already touched can
-- also need repairing. Reusing it would either reject valid work or destroy the
-- backfill's own before-image.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.articles_companies_repair (
  id               bigserial   PRIMARY KEY,
  -- One uuid per invocation. Lets you reverse exactly one run.
  run_id           uuid        NOT NULL,
  article_id       uuid        NOT NULL,

  -- What changed and why, at element level, so the ledger explains itself
  -- without needing the plan tables to still exist.
  --   'swap'   loser replaced by survivor (survivor was not already present)
  --   'remove' loser dropped (survivor was already present, so a swap would
  --            have produced a duplicate element)
  action           text        NOT NULL CHECK (action IN ('swap','remove')),
  loser_name       text        NOT NULL,
  survivor_name    text        NOT NULL,

  -- Full before/after of the array. `before` is what makes this reversible.
  -- `after` is stored so a reversal can verify it is undoing its own work
  -- rather than clobbering a later unrelated write.
  companies_before text[]      NOT NULL,
  companies_after  text[]      NOT NULL,

  applied_at       timestamptz NOT NULL DEFAULT now(),

  -- One row per (run, article, loser). An article holding two loser names gets
  -- two rows in the same run, which is the honest record; re-running the same
  -- run_id is a no-op rather than a second append.
  CONSTRAINT articles_companies_repair_uniq UNIQUE (run_id, article_id, loser_name)
);

CREATE INDEX IF NOT EXISTS articles_companies_repair_run_idx
  ON public.articles_companies_repair (run_id, applied_at);
CREATE INDEX IF NOT EXISTS articles_companies_repair_article_idx
  ON public.articles_companies_repair (article_id);
CREATE INDEX IF NOT EXISTS articles_companies_repair_loser_idx
  ON public.articles_companies_repair (loser_name);

COMMENT ON TABLE public.articles_companies_repair IS
  'Per-row ledger for the post-merge articles.companies[] repair '
  '(tools/repair_articles_companies.py). Records the exact before/after of '
  'every mutated row plus which loser name drove it. Reversal: see section 3. '
  'Written by the service role only; nothing in the pipeline reads it.';

ALTER TABLE public.articles_companies_repair ENABLE ROW LEVEL SECURITY;
-- No policies at all: an operator artifact. The service role bypasses RLS and
-- no anon or authenticated client has any business reading it.


-- =====================================================================
-- SECTION 2 -- the loser -> survivor map, readable by the tool.
--
-- norm_v2 is not in PostgREST's exposed schemas, so a client cannot read
-- plan_member / plan_cluster directly. This SECURITY DEFINER function is the
-- narrow window: it returns the map and nothing else, and only for clusters
-- that ACTUALLY MERGED.
--
-- Deliberately NOT a view over the plan tables: the plan can be archived and
-- rebuilt, and a repair run should fail loudly if the map has gone rather than
-- quietly repair nothing.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.norm_v2_merge_map()
RETURNS TABLE (loser_name text, survivor_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, norm_v2, pg_temp
AS $fn$
  SELECT pm.name, pc.survivor_name
    FROM norm_v2.plan_member  pm
    JOIN norm_v2.plan_cluster pc ON pc.new_key = pm.new_key
   WHERE NOT pm.is_survivor
     AND pc.merged_at IS NOT NULL
     AND pm.name <> pc.survivor_name;
$fn$;

COMMENT ON FUNCTION public.norm_v2_merge_map() IS
  'loser name -> survivor name, for clusters that actually merged. Read-only '
  'window onto norm_v2 for tools/repair_articles_companies.py, which cannot '
  'reach that schema through PostgREST. SECURITY DEFINER, service_role only.';

REVOKE ALL ON FUNCTION public.norm_v2_merge_map() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.norm_v2_merge_map() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.norm_v2_merge_map() TO service_role;

-- Sanity: the map should be non-empty and roughly the loser count of the merge.
--   SELECT count(*) AS pairs, count(DISTINCT survivor_name) AS survivors
--     FROM public.norm_v2_merge_map();
--     Expected on the 2026-09-01 merge: ~1,345 pairs over ~800 survivors.


-- =====================================================================
-- SECTION 2b -- merge progress, so the TOOL can refuse rather than the
-- operator having to remember section 0b.
--
-- Repairing while clusters are still unmerged is worse than not repairing:
-- the run reports success, and every cluster merged afterwards silently
-- reintroduces stale names that nothing will look for again. The tool exits
-- non-zero on still_to_merge > 0 and there is deliberately NO flag to override
-- it.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.norm_v2_merge_progress()
RETURNS TABLE (merged bigint, still_to_merge bigint, blocked bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, norm_v2, pg_temp
AS $fn$
  SELECT count(*) FILTER (WHERE merged_at IS NOT NULL),
         count(*) FILTER (WHERE approved AND risk <> 'block' AND merged_at IS NULL),
         count(*) FILTER (WHERE risk = 'block')
    FROM norm_v2.plan_cluster;
$fn$;

COMMENT ON FUNCTION public.norm_v2_merge_progress() IS
  'Merge drain state for tools/repair_articles_companies.py, which refuses to '
  'run while still_to_merge > 0. Read-only window onto norm_v2. SECURITY '
  'DEFINER, service_role only.';

REVOKE ALL ON FUNCTION public.norm_v2_merge_progress() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.norm_v2_merge_progress() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.norm_v2_merge_progress() TO service_role;


-- =====================================================================
-- SECTION 3 -- REVERSAL. Read this before you run the repair, not after.
--
-- Guarded on companies = companies_after, so a row the pipeline changed after
-- the repair is SKIPPED rather than clobbered.
--
-- Reverse in DESCENDING ledger id. An article holding two loser names has two
-- rows whose before/after chain in sequence; undoing them out of order leaves
-- the array in neither state and the guard then skips both.
-- =====================================================================
--
--   -- Preview: how many rows of this run are still reversible?
--   WITH r AS (
--     SELECT l.id, l.article_id, l.companies_before, l.companies_after,
--            a.companies AS companies_now
--       FROM public.articles_companies_repair l
--       JOIN public.articles a ON a.id = l.article_id
--      WHERE l.run_id = '<run-uuid>'
--   )
--   SELECT count(*) FILTER (WHERE companies_now IS NOT DISTINCT FROM companies_after) AS reversible,
--          count(*) FILTER (WHERE companies_now IS DISTINCT FROM companies_after)     AS drifted
--     FROM r;
--
--   -- Reverse, newest ledger row first.
--   DO $$
--   DECLARE r record;
--   BEGIN
--     FOR r IN
--       SELECT id, article_id, companies_before, companies_after
--         FROM public.articles_companies_repair
--        WHERE run_id = '<run-uuid>'
--        ORDER BY id DESC
--     LOOP
--       UPDATE public.articles
--          SET companies = r.companies_before
--        WHERE id = r.article_id
--          AND companies IS NOT DISTINCT FROM r.companies_after;
--     END LOOP;
--   END;
--   $$;
--
--   -- Then confirm nothing of that run is still applied:
--   SELECT count(*) FROM public.articles_companies_repair l
--     JOIN public.articles a ON a.id = l.article_id
--    WHERE l.run_id = '<run-uuid>'
--      AND a.companies IS NOT DISTINCT FROM l.companies_after;
--     EXPECT 0, or exactly the drifted count from the preview.


-- =====================================================================
-- SECTION 4 -- VERIFY, and the population this does NOT fix.
-- =====================================================================
--
--   -- 4a. No merged loser name survives in any articles.companies[].
--   --     This is the invariant the repair exists to establish.
--   SELECT count(*) AS articles_still_holding_a_loser
--     FROM public.articles a
--    WHERE EXISTS (
--       SELECT 1 FROM public.norm_v2_merge_map() m
--        WHERE a.companies @> ARRAY[m.loser_name]
--     );
--     EXPECT 0 after a complete run.
--
--   -- 4b. What the repair deliberately leaves behind. These are names in
--   --     companies[] that are not in public.companies AND are not merge
--   --     losers, i.e. strings the extractor produced that never resolved to a
--   --     canonical row. Measured 2026-09-01: 1,445 distinct names across
--   --     25,554 articles, led by 'NVIDIA' (370), 'Visa' (346), 'RTX' (337),
--   --     'Meta Platforms' (311), 'TSLA' (169).
--   --
--   --     NOT a merge artifact and NOT repairable from the plan map: there is
--   --     no survivor to point them at. Several look like they SHOULD resolve
--   --     ('NVIDIA' vs a canonical 'Nvidia'), which makes this a candidate for
--   --     the same alias/normalization work norm_v2 was built for, on the
--   --     article side rather than the company side. Filed, not fixed.
--   SELECT unnest(a.companies) AS orphan_name, count(*) AS articles
--     FROM public.articles a
--    WHERE a.companies IS NOT NULL
--    GROUP BY 1
--   HAVING NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.name = orphan_name)
--    ORDER BY 2 DESC LIMIT 50;
