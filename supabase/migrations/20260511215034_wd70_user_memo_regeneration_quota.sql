-- WD70: per-user daily memo regeneration quota
-- BriefTab Regenerate button enforces 3 regenerations per user per UTC day.
-- This migration is committed but NOT applied automatically. Noah applies via
-- Supabase Studio or CLI.
--
-- Schema note: company_id is TEXT, not UUID. The existing memo-route caller
-- (BriefTab) passes the canonical company NAME as the identifier, and the
-- adjacent output_log_v0_stub.source_id (the memo cache key) is already TEXT
-- for the same reason. Using TEXT here keeps the regenerate handler aligned
-- with the existing cache-invalidation join key without forcing BriefTab to
-- resolve a UUID upstream.
--
-- Table records one row per regenerate click. The route checks COUNT(*) for
-- today (UTC) before inserting. RLS ensures users can only see/insert their
-- own quota rows.

CREATE TABLE IF NOT EXISTS user_memo_regeneration_quota (
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id      TEXT        NOT NULL,
  regenerated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id, regenerated_at)
);

CREATE INDEX IF NOT EXISTS idx_quota_user_day
  ON user_memo_regeneration_quota (user_id, regenerated_at DESC);

ALTER TABLE user_memo_regeneration_quota ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own quota"
  ON user_memo_regeneration_quota
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own quota"
  ON user_memo_regeneration_quota
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON user_memo_regeneration_quota TO authenticated;
