-- =====================================================================
-- 0029_articles_companies_backfill_audit.sql
--
-- HAND-APPLY. Additive only: creates ONE new table and nothing else.
-- No existing column is altered, dropped or backfilled by this file.
--
-- Backs tools/backfill_primary_fold.py, the historical backfill of
-- articles.companies[] using the resolution logic merged in PR #616
-- (backend/ingest.py _resolve_primary_to_canonical + backend/company_match.py).
--
-- WHY A LEDGER. The fold gate is forward-only: it changes rows written after
-- deploy. The 45k historical rows whose primary_company is absent from
-- companies[] stay invisible to a companies[]-based query until they are
-- rewritten. That rewrite mutates real user-facing data on a 170k-row table,
-- so every single change is recorded here before it is applied, and the whole
-- run is reversible from this table alone.
--
-- THE TABLE IS THE SAFETY MECHANISM. Do not run the backfill without it.
-- =====================================================================


-- =====================================================================
-- SECTION 0 -- INSPECT. Read-only. Run first.
-- =====================================================================

-- 0a. Does the table already exist, and does it hold a prior run?
--
--   SELECT to_regclass('public.articles_companies_backfill') AS tbl;
--   SELECT run_id, count(*) AS rows, min(applied_at) AS started,
--          max(applied_at) AS finished
--     FROM public.articles_companies_backfill
--    GROUP BY run_id ORDER BY started DESC;

-- 0b. articles size, so the runtime estimate is grounded.
--
--   SELECT n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS total
--     FROM pg_stat_user_tables WHERE relname = 'articles';

-- 0c. Is articles.id indexed for keyset pagination? It is the primary key, so
--     this should return the pkey. The backfill pages on id and would be
--     O(n^2) without it.
--
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'articles' AND indexdef LIKE '%(id)%';

-- 0d. THIS DECIDES THE WRITE COST. Every index on articles, and specifically
--     whether `companies` is indexed.
--
--     The backfill changes ONE column, `companies`. If no index covers it,
--     Postgres can use a HOT (heap-only tuple) update and skip index
--     maintenance entirely, which is by far the cheaper path. If a GIN index
--     on companies exists, every one of the ~30.7k updates also writes that
--     index, and HOT is impossible.
--
--     sql/0024 creates GIN indexes on primary_company, title,
--     industry_verticals and activity_types, but NOT on companies. Confirm,
--     because company_mentions taught us the repo does not know every index.
--
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'articles' ORDER BY indexname;
--
--   -- fillfactor governs whether HOT can actually fire (needs free space in
--   -- the page). Default 100 leaves none, so many updates will migrate:
--   SELECT reloptions FROM pg_class WHERE relname = 'articles';

-- 0e. Dead-tuple headroom. The run updates ~18% of the table, so autovacuum
--     will have work to do. Capture before, compare after.
--
--   SELECT n_live_tup, n_dead_tup, last_autovacuum
--     FROM pg_stat_user_tables WHERE relname = 'articles';


-- =====================================================================
-- SECTION 1 -- the ledger.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.articles_companies_backfill (
  id               bigserial   PRIMARY KEY,
  -- One uuid per invocation of the backfill tool. Lets you reverse exactly one
  -- run when several have happened.
  run_id           uuid        NOT NULL,
  article_id       uuid        NOT NULL,

  -- The raw articles.primary_company string that was resolved.
  primary_company  text        NOT NULL,
  -- The canonical companies.name that was appended. This is the join key that
  -- makes the row retrievable, and the value a later sql/proposals/0020 merge
  -- could invalidate if this name turns out to be a merge loser.
  resolved_name    text        NOT NULL,

  -- Full before/after of the array. `before` is what makes this reversible;
  -- `after` is stored too so a reversal can verify it is undoing its own work
  -- rather than clobbering a later unrelated write.
  companies_before text[]      NOT NULL,
  companies_after  text[]      NOT NULL,

  applied_at       timestamptz NOT NULL DEFAULT now(),

  -- Idempotency. An article is folded at most once, ever. A re-run inserts
  -- ON CONFLICT DO NOTHING and skips the update, so re-running the whole
  -- backfill is a no-op rather than a second append.
  CONSTRAINT articles_companies_backfill_article_uniq UNIQUE (article_id)
);

CREATE INDEX IF NOT EXISTS articles_companies_backfill_run_idx
  ON public.articles_companies_backfill (run_id, applied_at);

CREATE INDEX IF NOT EXISTS articles_companies_backfill_resolved_idx
  ON public.articles_companies_backfill (resolved_name);

COMMENT ON TABLE public.articles_companies_backfill IS
  'Per-row ledger for the historical articles.companies[] backfill '
  '(tools/backfill_primary_fold.py). Records the exact before/after of every '
  'mutated row. Reversal: UPDATE articles SET companies = companies_before. '
  'Written by the service role only; nothing in the pipeline reads it.';

ALTER TABLE public.articles_companies_backfill ENABLE ROW LEVEL SECURITY;
-- No policies at all: this is an operator artifact. The service role bypasses
-- RLS, and no anon or authenticated client has any business reading it.


-- =====================================================================
-- SECTION 1b -- set-based apply. Optional but strongly recommended.
--
-- Without it the tool issues ONE PostgREST UPDATE per row. At ~30k rows that is
-- ~30k HTTPS round trips, which is 10-25 minutes of pure latency and 30k
-- separate transactions. This function takes a whole batch as jsonb and applies
-- it in ONE statement, one transaction: ~60 calls instead of ~30k.
--
-- DRIFT GUARD. Each element carries the `before` array the tool planned
-- against. A row whose companies[] no longer equals `before` is SKIPPED, not
-- overwritten, so a concurrent pipeline write is never clobbered. The return
-- value reports how many were actually applied, so the caller can detect drift.
--
-- Touches articles.companies ONLY. HARD FREEZE: no company_mentions, no
-- mention_count, no companies, no aliases.
-- =====================================================================

-- DASHBOARD NOTE. Two deliberate choices, both learned by failing in the
-- Supabase SQL editor on 2026-08-17:
--   1. The body is tagged $fn$, not $$. The editor's statement splitter broke
--      on the semicolons inside a $$-quoted body and sent a truncated fragment,
--      producing "unterminated dollar-quoted string".
--   2. RETURNS jsonb with ONE RETURN, instead of RETURNS TABLE + RETURN NEXT.
--      Fewer statements in the body, nothing for a splitter to mangle.
-- RUN THIS STATEMENT ON ITS OWN, not pasted together with the REVOKE/GRANT.
CREATE OR REPLACE FUNCTION public.apply_companies_backfill(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  n_applied int;
  n_total   int;
BEGIN
  SELECT count(*) INTO n_total FROM jsonb_array_elements(p_rows);
  WITH input AS (
    SELECT (e->>'id')::uuid AS id,
           ARRAY(SELECT jsonb_array_elements_text(e->'before')) AS before_arr,
           ARRAY(SELECT jsonb_array_elements_text(e->'after'))  AS after_arr
      FROM jsonb_array_elements(p_rows) AS e
  ), updated AS (
    UPDATE public.articles a
       SET companies = i.after_arr
      FROM input i
     WHERE a.id = i.id
       AND a.companies IS NOT DISTINCT FROM i.before_arr
    RETURNING a.id
  )
  SELECT count(*) INTO n_applied FROM updated;
  RETURN jsonb_build_object('applied', n_applied,
                            'skipped_drift', n_total - n_applied);
END;
$fn$;

COMMENT ON FUNCTION public.apply_companies_backfill(jsonb) IS
  'Batch apply for tools/backfill_primary_fold.py. Input: jsonb array of '
  '{id, before[], after[]}. Updates articles.companies only, skipping any row '
  'whose current value no longer matches `before`. Returns (applied, '
  'skipped_drift). Operator tool: no pipeline code calls this.';

-- EXECUTE on a new function defaults to PUBLIC. Lock it down, then grant back
-- explicitly to the one role that needs it. The GRANT is not optional: without
-- it the REVOKE above can strip the service role's inherited access and the
-- backfill fails with "permission denied for function".
-- STATEMENT TIMEOUT. Added 2026-08-17 after a live failure.
--
-- The 2026-08-17 run applied 30,207 rows at 130-146 rows/s and then one 500-row
-- chunk died on 57014 "canceling statement due to statement timeout". The
-- function inherits the calling role's statement_timeout, which for a PostgREST
-- role is short. A batch that has to flush the GIN pending list on
-- idx_articles_companies (fastupdate=on, 4MB gin_pending_list_limit) can take
-- far longer than the median batch, and that cost lands on whichever single
-- statement happens to fill the list. So the failure is not proportional to
-- batch size, it is a spike, which is exactly what a short timeout turns into a
-- hard error.
--
-- A function-local setting applies for the duration of the call and does not
-- change the role default for anything else.
ALTER FUNCTION public.apply_companies_backfill(jsonb) SET statement_timeout = '180s';

REVOKE ALL ON FUNCTION public.apply_companies_backfill(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_companies_backfill(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_companies_backfill(jsonb) TO service_role;


-- =====================================================================
-- SECTION 2 -- REVERSAL. Read this before you run the backfill, not after.
--
-- Restores articles.companies[] for one run. Guarded: only rewrites rows whose
-- CURRENT value still equals what the backfill wrote, so a row edited by the
-- pipeline after the backfill is left alone rather than clobbered.
-- =====================================================================
--
--   -- how many rows would revert, and how many have drifted since:
--   SELECT count(*) FILTER (WHERE a.companies = b.companies_after) AS revertable,
--          count(*) FILTER (WHERE a.companies IS DISTINCT FROM b.companies_after)
--            AS drifted_leave_alone
--     FROM public.articles_companies_backfill b
--     JOIN public.articles a ON a.id = b.article_id
--    WHERE b.run_id = '<run_id>';
--
--   -- the reversal itself:
--   UPDATE public.articles a
--      SET companies = b.companies_before
--     FROM public.articles_companies_backfill b
--    WHERE a.id = b.article_id
--      AND b.run_id = '<run_id>'
--      AND a.companies = b.companies_after;   -- drift guard
--
--   -- then clear the ledger for that run so the backfill can run again:
--   DELETE FROM public.articles_companies_backfill WHERE run_id = '<run_id>';


-- =====================================================================
-- SECTION 3 -- VERIFY, after a run.
-- =====================================================================
--
--   -- every ledger row's `after` should be `before` plus exactly one element:
--   SELECT count(*) AS bad_delta
--     FROM public.articles_companies_backfill
--    WHERE array_length(companies_after,1)
--          IS DISTINCT FROM coalesce(array_length(companies_before,1),0) + 1;
--     EXPECT 0.
--
--   -- the appended element is always the recorded resolved_name:
--   SELECT count(*) AS bad_append
--     FROM public.articles_companies_backfill
--    WHERE NOT (resolved_name = ANY(companies_after))
--       OR (resolved_name = ANY(companies_before));
--     EXPECT 0.
--
--   -- HARD FREEZE held: this backfill must not have touched mention counts.
--   -- Compare against a count you captured BEFORE the run.
--   SELECT sum(mention_count) FROM public.companies;
--
--   -- MANDATORY BEFORE JUDGING RETRIEVAL. idx_articles_companies is
--   -- GIN (companies) with the default fastupdate=on, so ~30.7k inserts land in
--   -- the index's PENDING LIST rather than the main tree. Every GIN scan must
--   -- read that pending list linearly on top of the tree, so until it is
--   -- flushed the .contains("companies", ...) queries this backfill exists to
--   -- improve can be SLOWER, not faster. Flush it, then reclaim dead tuples:
--
--   SELECT gin_clean_pending_list('idx_articles_companies'::regclass);
--   VACUUM public.articles;
--
--   -- Plain VACUUM. NEVER VACUUM FULL: it takes an ACCESS EXCLUSIVE lock and
--   -- rewrites the whole table plus all 14 indexes.
--   -- Confirm the dead tuples came back:
--   SELECT n_live_tup, n_dead_tup, last_vacuum
--     FROM pg_stat_user_tables WHERE relname = 'articles';
--
--   -- every resolved_name still names a live company (this is what a later
--   -- sql/proposals/0020 merge would break: a merged-away loser name):
--   SELECT b.resolved_name, count(*) AS articles
--     FROM public.articles_companies_backfill b
--    WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.name = b.resolved_name)
--    GROUP BY 1 ORDER BY 2 DESC;
--     EXPECT zero rows BEFORE 0020. After 0020 this is exactly the set of rows
--     that need rewriting loser -> survivor. See the tool's --stale-check.


-- =====================================================================
-- SECTION 4 -- POST-0020 REPAIR. Not needed until sql/proposals/0020 runs.
--
-- 0020 merges duplicate clusters and DELETES the loser companies rows. It does
-- NOT rewrite articles.companies[], because that column stores NAMES, not ids,
-- and nothing in 0020 touches articles at all.
--
-- So after 0020, any name in articles.companies[] that was a merge loser stops
-- matching a live company and those rows go dark again. Measured 2026-08-15:
-- 2,399 of this backfill's 30,707 writes (7.8%) use a name that would become a
-- loser under the current 0020b plan.
--
-- IMPORTANT: this is a pre-existing condition, not something the backfill
-- creates. Every article that ALREADY carried a loser name has the same
-- problem. The backfill just adds to the population, and because it ledgers
-- resolved_name, its share is the only part that is trivially repairable.
--
-- Nothing needs re-resolving. The repair is a join against the merge plan.
-- =====================================================================
--
--   -- what went stale, backfill-written rows only:
--   SELECT b.resolved_name, count(*) AS rows
--     FROM public.articles_companies_backfill b
--    WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.name = b.resolved_name)
--    GROUP BY 1 ORDER BY 2 DESC;
--
--   -- repair, driven by the 0020 plan tables (loser name -> survivor name).
--   -- array_replace swaps the element in place; the ledger is updated too so
--   -- the reversal in section 2 stays truthful.
--   WITH map AS (
--     SELECT pm.name AS loser_name, pc.survivor_name
--       FROM norm_v2.plan_member pm
--       JOIN norm_v2.plan_cluster pc USING (new_key)
--      WHERE NOT pm.is_survivor AND pc.merged_at IS NOT NULL
--   )
--   UPDATE public.articles a
--      SET companies = array_replace(a.companies, m.loser_name, m.survivor_name)
--     FROM map m
--    WHERE a.companies @> ARRAY[m.loser_name]
--      AND NOT a.companies @> ARRAY[m.survivor_name];   -- avoid a duplicate element
--
--   -- rows that would end up with BOTH names need the loser removed instead:
--   WITH map AS (
--     SELECT pm.name AS loser_name, pc.survivor_name
--       FROM norm_v2.plan_member pm
--       JOIN norm_v2.plan_cluster pc USING (new_key)
--      WHERE NOT pm.is_survivor AND pc.merged_at IS NOT NULL
--   )
--   UPDATE public.articles a
--      SET companies = array_remove(a.companies, m.loser_name)
--     FROM map m
--    WHERE a.companies @> ARRAY[m.loser_name]
--      AND a.companies @> ARRAY[m.survivor_name];
--
-- RUN THE SAME WAY AS THE BACKFILL: batched, with a ledger, not as one
-- statement over the whole table. The two statements above are the LOGIC, not
-- the execution plan.
