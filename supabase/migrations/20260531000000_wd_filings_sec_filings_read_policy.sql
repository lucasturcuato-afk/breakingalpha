-- WD-filings: SELECT RLS policy on sec_filings so the Company Intel Filings
-- tab reads under the app's normal anon/authenticated client.
--
-- Context: sec_filings has relrowsecurity=true but NO policies, so the
-- deployed page (getSupabaseWithUser -> anon key + user cookie, RLS-governed)
-- reads zero rows and the Filings tab shows "No SEC filings in the coverage
-- window" even for NVIDIA (cik 1045810). The EDGAR ingest backfill and the
-- verification harness only passed because they used the SERVICE_ROLE key,
-- which bypasses RLS. companies and articles already carry an "Allow all"
-- PERMISSIVE policy (roles {public}, USING true), which is why they render;
-- this adds the read-side equivalent to sec_filings.
--
-- Scope: SELECT only. Writes stay with the service-role pipeline ingest
-- (backend/ingest_sec.py); no INSERT/UPDATE/DELETE policy is added, so this is
-- not a write over-grant. Role target mirrors articles (public, USING true).
--
-- insider_transactions had the identical RLS-enabled-no-policy gap and was
-- deliberately NOT touched here, because at the time the Insider tab was a
-- coming-soon stub and the table was empty. That follow-up has since shipped:
-- sql/0019_insider_transactions_read_policy.sql adds the matching SELECT
-- policy and IS APPLIED. The table now holds 5,084 rows and the Insider tab is
-- live. This paragraph described the state on 2026-05-31 and is kept for
-- history; do not read it as current.
--
-- Apply cadence follows the repo convention (committed migration, applied by
-- Noah via Studio/CLI). NOT yet applied to pnfjelfvtypkpnwpflmv as of
-- 2026-05-31: the available Supabase MCP is read-only and no direct DB
-- connection/CLI is available in this environment, so DDL could not be applied
-- from here. After applying, verify the fix through the RLS-governed client:
--   curl -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" \
--     ".../rest/v1/sec_filings?cik=eq.1045810&select=accession_number,form_type"
-- should return the 2 NVIDIA rows (10-Q + 8-K) instead of [].

CREATE POLICY "Public read access"
  ON sec_filings
  FOR SELECT
  TO public
  USING (true);

GRANT SELECT ON sec_filings TO anon, authenticated;
