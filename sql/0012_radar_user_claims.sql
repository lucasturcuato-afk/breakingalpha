-- Radar: user_claims + user_claim_outcomes (Calls sub-tab, authoring + adopt).
-- Created: 2026-07-04 (feat/radar-unified)
--
-- DO NOT AUTO-APPLY. Written for human review; apply manually AFTER 0011.
--
-- Additive and non-destructive: two new tables. No existing table,
-- column, or constraint is touched. Idempotent: safe to re-run.
--
-- user_claims: a user-authored (or brief-adopted) market call.
--   user_claim preserves the user's words VERBATIM; it is the headline
--   and is never homogenized. The standardized reduction lives in
--   resolution_method (jsonb) beneath it.
--   v1 resolution methods: price_attribution only. Anything else is
--   gradeable = false with an honest gradeability_note (context-only).
--   confidence_in_reduction is the authoring LLM's confidence that the
--   reduction faithfully captures the claim. It is NEVER an input to
--   grading and is not displayed as a probability of being right.
--   Adopted claims (source = 'adopted') are NOT independently graded:
--   the UI joins through adopted_from_call_id to the original
--   morning_brief_call_outcomes row. Only authored gradeable claims are
--   picked up by the grading cron.
--
-- user_claim_outcomes: mirror of morning_brief_call_outcomes (same
-- column shapes and vocabulary) so the existing attribution grader's
-- Outcome maps onto both; only the runner's write target differs.
-- A separate table because morning_brief_call_outcomes has a NOT NULL
-- FK to morning_brief_calls that must not be altered.

CREATE TABLE IF NOT EXISTS user_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_claim text NOT NULL,
  claim_type text NOT NULL
    CHECK (claim_type IN ('ticker','sector','index','aggregate','other')),
  target_symbol text,
  expected_direction text
    CHECK (expected_direction IN ('bullish','bearish','neutral')),
  resolution_method jsonb NOT NULL,
  resolution_window_start date,
  resolution_window_end date,
  evidence_entities text[],
  gradeable boolean NOT NULL DEFAULT false,
  gradeability_note text,
  confidence_in_reduction numeric
    CHECK (confidence_in_reduction IS NULL
           OR (confidence_in_reduction >= 0 AND confidence_in_reduction <= 1)),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','graded','ungradable','archived')),
  source text NOT NULL DEFAULT 'authored'
    CHECK (source IN ('authored','adopted')),
  adopted_from_call_id uuid REFERENCES morning_brief_calls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_claims_user ON user_claims(user_id);
-- The grading cron's due-claims scan: authored, gradeable, still open,
-- window closed.
CREATE INDEX IF NOT EXISTS idx_user_claims_due
  ON user_claims(resolution_window_end)
  WHERE gradeable AND status = 'open' AND source = 'authored';

CREATE TABLE IF NOT EXISTS user_claim_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES user_claims(id) ON DELETE CASCADE,
  actual_open numeric,
  actual_close numeric,
  actual_pct_change numeric,
  actual_direction text CHECK (actual_direction IN ('up','down','flat')),
  verdict text NOT NULL
    CHECK (verdict IN ('correct','wrong','partial','ungradable')),
  attribution text CHECK (attribution IN ('clean','confounded','inconclusive')),
  metadata jsonb,
  verdict_notes text,
  graded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_claim_outcomes_claim
  ON user_claim_outcomes(claim_id);

-- RLS: owner-only, via claim ownership for outcomes. Service role
-- (grading cron) bypasses RLS for writes.
ALTER TABLE user_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_claim_outcomes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_claims'
      AND policyname = 'user_claims_owner_all'
  ) THEN
    EXECUTE 'CREATE POLICY user_claims_owner_all ON user_claims
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_claim_outcomes'
      AND policyname = 'user_claim_outcomes_owner_read'
  ) THEN
    EXECUTE 'CREATE POLICY user_claim_outcomes_owner_read ON user_claim_outcomes
      FOR SELECT USING (EXISTS (
        SELECT 1 FROM user_claims c
        WHERE c.id = user_claim_outcomes.claim_id AND c.user_id = auth.uid()
      ))';
  END IF;
END $$;
