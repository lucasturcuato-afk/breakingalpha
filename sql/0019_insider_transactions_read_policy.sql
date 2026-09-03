-- 0019_insider_transactions_read_policy.sql
--
-- APPLIED. Reviewed and run by Noah. Kept for the record; the DO block is
-- idempotent, so re-running it is a no-op. Do not let an agent run this.
--
-- STATE. Applied between 2026-06-05 and 2026-07-26. Verified three times since,
-- each against prod:
--   2026-07-26  exactly one policy: Public read access | SELECT | public | true
--               (src/app/company/[id]/page.tsx:330-334)
--   2026-08-29  anon key, PostgREST select -> 206, content-range 0-0/5052
--               (src/lib/data-access/getInsiderTransactions.ts:9-16)
--   2026-08-31  anon key, PostgREST select -> 206, content-range 0-0/5084
--               columns exposed: accession_number, cik, company_id, created_at,
--               id, insider_cik, insider_name, insider_title, output_id,
--               price_per_share, shares, shares_owned_after, ticker,
--               total_value, transaction_code, transaction_date
--
-- The header used to read "NOT APPLIED. Written for Noah to review and run."
-- That was true when it was written and false from the day it was applied. It
-- stayed wrong long enough to be reported as a live security exposure --
-- "insider_transactions RLS no longer denies anon reads, 5,058 rows" -- which
-- is not a regression at all. It is this file working as designed and as
-- reviewed. Reversing it would blank the Insider tab on every company page.
--
-- ANON READ IS THE INTENT, NOT A LEAK. Restating the case, still true:
--   - Form 4 contents are public SEC disclosures.
--   - No user_id column exists, so there is nothing to scope a per-user policy
--     to. The column list verified 2026-08-31 above contains no user data.
--   - The sibling EDGAR tables are equally anon-readable, and were first:
--     companies 5,610 rows and sec_filings 4,628 rows, both verified by anon
--     key 2026-08-31. This grants nothing broader than they already do.
--   - SELECT only. Exactly one policy exists and its cmd is SELECT, so with RLS
--     enabled there is no write policy for a client to use. Writes remain with
--     the service role in backend/ingest_sec.py.
--   - Live product code depends on the read: src/app/company/[id]/page.tsx,
--     src/lib/data-access/getInsiderTransactions.ts and
--     src/lib/company-mobile/build.ts all read this table through the
--     RLS-governed client.
--
-- ORIGINAL RATIONALE, as written before it was applied:
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
