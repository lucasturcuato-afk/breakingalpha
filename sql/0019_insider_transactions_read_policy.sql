-- 0019_insider_transactions_read_policy.sql
--
-- NOT APPLIED. Written for Noah to review and run. Do not let an agent run this.
--
-- WHY. insider_transactions has RLS ENABLED and ZERO policies:
--
--   select relrowsecurity from pg_class where relname = 'insider_transactions';  -- t
--   select count(*) from pg_policies where tablename = 'insider_transactions';   -- 0
--
-- RLS with no policy denies every row to every non-service role. The table holds
-- 2,722 real parsed Form 4 rows across 147 companies (2025-05-27 to 2026-07-23)
-- that no authenticated client can read. The Insider tab is wired and will render
-- its empty state until this lands, then populate with no further code change.
--
-- The policy below is a verbatim copy of what sec_filings and companies already
-- carry, so this grants nothing broader than the sibling EDGAR tables:
--
--   tablename    | policyname         | cmd    | roles  | using
--   companies    | Public read access | SELECT | public | true
--   sec_filings  | Public read access | SELECT | public | true
--
-- Form 4 contents are public SEC disclosures. There is no user-scoped or private
-- data in this table: it is company_id, cik, insider name and title, transaction
-- code, date, share count, price, and shares held after. No user_id column
-- exists, so there is nothing to scope a per-user policy to.
--
-- SELECT only. Writes stay with the service role used by backend/ingest_sec.py.
-- Idempotent: safe to run more than once.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'insider_transactions'
      and policyname = 'Public read access'
  ) then
    create policy "Public read access"
      on public.insider_transactions
      for select
      to public
      using (true);
  end if;
end
$$;

-- Verify after applying:
--   select policyname, cmd, roles from pg_policies where tablename = 'insider_transactions';
--   -- expect exactly one row: Public read access | SELECT | {public}
--
-- Rollback:
--   drop policy "Public read access" on public.insider_transactions;
