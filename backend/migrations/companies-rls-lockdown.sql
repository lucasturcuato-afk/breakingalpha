-- companies RLS lockdown: close the anon/public WRITE hole on public.companies.
--
-- PROBLEM (live, as of recon 2026-06-21 against prod):
--   public.companies has RLS enabled but its only policy is a permissive
--   "Allow all" ALL/USING(true) policy targeting PUBLIC. That grants anon and
--   every authenticated user full INSERT / UPDATE / DELETE on the company
--   universe, not just SELECT. Reads MUST stay open (the frontend reads
--   companies under the anon key constantly); writes must not.
--
-- FIX: drop the permissive ALL policy and replace it with a SELECT-only
--   "Public read access" policy, mirroring public.sec_filings exactly (see
--   supabase/migrations/20260531000000_wd_filings_sec_filings_read_policy.sql).
--   With RLS enabled and no permissive write policy, only the service role
--   (which BYPASSES RLS) can write. Every pipeline writer already uses the
--   service-role key, so no application path breaks (see recon note below).
--
-- PATTERN COPIED FROM (named, verbatim shape):
--   public.sec_filings -> policy "Public read access", FOR SELECT, TO public,
--   USING (true); plus GRANT SELECT TO anon, authenticated. sec_filings keeps
--   ALL writes on the service-role pipeline with NO write policy. This file
--   reproduces that exact shape on companies.
--
-- ============================================================================
-- BEFORE STATE (captured verbatim from pg_policy / pg_class, prod, 2026-06-21).
-- This block is the rollback reference: to revert, recreate the dropped policy.
--
--   RLS on public.companies: relrowsecurity = true, relforcerowsecurity = false
--
--   Policies on public.companies (the only row):
--     policyname      | "Allow all"
--     cmd             | ALL
--     permissive      | true
--     roles           | {public}      (pg_policy.polroles = null -> PUBLIC)
--     using_expr      | true
--     with_check_expr | (null)        (ALL + USING(true), no WITH CHECK ->
--                                      USING governs the write check too)
--
--   Exact reversal (re-open writes) if ever needed:
--     -- DROP POLICY IF EXISTS "Public read access" ON public.companies;
--     -- CREATE POLICY "Allow all" ON public.companies
--     --   AS PERMISSIVE FOR ALL TO public USING (true);
-- ============================================================================
--
-- WRITE-PATH SAFETY (recon 2, all writers confirmed service-role):
--   backend/ingest.py:1391,1398            supabase = get_service_client()        [SERVICE_ROLE]
--   backend/entity_resolver.py:283,388,411 supabase param from ingest.py:1462     [SERVICE_ROLE]
--   backend/edgar/cik_mapping.py:94        sb from ingest_sec.py:52 (SERVICE_ROLE_KEY)
--   backend/scripts/backfill_tickers.py:245 requires SUPABASE_SERVICE_ROLE_KEY (line 93)
--   src/** TypeScript:                      ZERO writes to companies (anon reads only)
--   => No anon/user-scoped write to companies exists. Lockdown is safe to apply as-is.
--
-- Apply cadence follows repo convention: committed migration, applied by Noah
-- in the Supabase SQL editor. Wrapped in a transaction so there is never a
-- window where companies has no SELECT policy (the read never blinks).

BEGIN;

-- 1. Remove the permissive ALL/USING(true) policy that granted anon writes.
DROP POLICY IF EXISTS "Allow all" ON public.companies;

-- 2. Restore the READ half only, matching public.sec_filings exactly.
DROP POLICY IF EXISTS "Public read access" ON public.companies;
CREATE POLICY "Public read access"
  ON public.companies
  FOR SELECT
  TO public
  USING (true);

GRANT SELECT ON public.companies TO anon, authenticated;

COMMIT;

-- Optional defense-in-depth (NOT required; RLS already denies writes with no
-- permissive write policy). Uncomment to also strip table-level write grants:
--   REVOKE INSERT, UPDATE, DELETE ON public.companies FROM anon, authenticated;


-- ============================================================================
-- POST-APPLY VERIFICATION (read-only). Run AFTER the COMMIT above. Safe to run
-- as part of this file or on their own.
-- ============================================================================

-- (V1) One-row gate: SELECT must stay public AND zero permissive write policies
--      may remain. Expected: select_public = true, write_policies = 0,
--      verdict = 'LOCKED OK'.
select
  bool_or(cmd = 'SELECT' and permissive and roles @> array['public']::name[]) as select_public,
  count(*) filter (where cmd in ('INSERT','UPDATE','DELETE','ALL') and permissive) as write_policies,
  case
    when bool_or(cmd = 'SELECT' and permissive and roles @> array['public']::name[])
     and count(*) filter (where cmd in ('INSERT','UPDATE','DELETE','ALL') and permissive) = 0
    then 'LOCKED OK'
    else 'CHECK FAILED'
  end as verdict
from (
  select
    case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
                    when 'd' then 'DELETE' when '*' then 'ALL' end as cmd,
    pol.polpermissive as permissive,
    coalesce((select array_agg(rolname) from pg_roles where oid = any(pol.polroles)),
             array['public']::name[]) as roles
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'companies'
) p;

-- (V2) Eyeball listing: should be exactly one row ->
--      "Public read access" / SELECT / {public} / using_expr = true.
select
  pol.polname as policyname,
  case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
                  when 'd' then 'DELETE' when '*' then 'ALL' end as cmd,
  pol.polpermissive as permissive,
  coalesce((select array_agg(rolname) from pg_roles where oid = any(pol.polroles)),
           array['public']::name[]) as roles,
  pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
  pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'companies'
order by pol.polcmd, pol.polname;
