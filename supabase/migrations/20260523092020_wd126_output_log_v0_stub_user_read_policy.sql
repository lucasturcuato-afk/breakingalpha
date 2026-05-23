-- WD126: defense-in-depth RLS read policy on output_log_v0_stub.
--
-- MANUAL-APPLY ONLY. This migration is committed but NOT applied automatically.
-- Noah applies via Supabase Studio or CLI on his cadence.
--
-- Context: output_log_v0_stub has `relrowsecurity=true` but no per-user SELECT
-- policy. /api/memo-cache and /api/memo reads only work today via the
-- SUPABASE_SERVICE_ROLE_KEY bypass. If the service-role key is ever rotated
-- away (or a future caller is switched to a user-scoped client), every cache
-- read silently 401s and returns cached:false. Recon doc:
--   .claude/recon/agent-b-wd126-recon.md (section 4, "lurking RLS-adjacent
--   footgun")
--
-- The user_id is stored in metadata->>'user_id' (text). This mirrors the read
-- predicate at src/app/api/memo-cache/route.ts line ~84 so the policy and the
-- application filter agree.
--
-- We add SELECT only. Writes still go through the service-role client in
-- src/lib/outputs.ts; no per-user INSERT policy is required at this time. If a
-- future caller writes from a user-scoped client, add a matching INSERT policy
-- in a follow-up migration.

CREATE POLICY "users read own memo cache rows"
  ON output_log_v0_stub
  FOR SELECT
  TO authenticated
  USING (
    output_type = 'memo'
    AND metadata->>'user_id' = auth.uid()::text
  );

GRANT SELECT ON output_log_v0_stub TO authenticated;
