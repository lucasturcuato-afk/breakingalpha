-- Self-grading for Morning Brief market calls
-- Created: 2026-04-22 (brief revamp sprint)
--
-- morning_brief_calls:           each gradeable claim extracted from a morning brief
-- morning_brief_call_outcomes:   verdict after market close + LLM reasoning
--
-- Idempotent: safe to re-run. Uses IF NOT EXISTS for tables, indexes, and
-- a DO block for RLS policies so repeated execution does not error.
--
-- NOTE: morning_brief_calls.brief_id is intentionally a plain uuid column
-- (no FK to briefings) because we have not confirmed the briefings PK type
-- in this environment. An index on brief_id covers the common lookup.

CREATE TABLE IF NOT EXISTS morning_brief_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL,
  brief_date date NOT NULL DEFAULT CURRENT_DATE,
  claim_text text NOT NULL,
  claim_type text NOT NULL CHECK (claim_type IN ('aggregate','sector','index','ticker')),
  target_symbol text,
  expected_direction text NOT NULL CHECK (expected_direction IN ('bullish','bearish','neutral')),
  confidence numeric CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mbc_brief_id ON morning_brief_calls(brief_id);
CREATE INDEX IF NOT EXISTS idx_mbc_brief_date ON morning_brief_calls(brief_date);

CREATE TABLE IF NOT EXISTS morning_brief_call_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES morning_brief_calls(id) ON DELETE CASCADE,
  actual_open numeric,
  actual_close numeric,
  actual_pct_change numeric,
  actual_direction text NOT NULL CHECK (actual_direction IN ('up','down','flat')),
  verdict text NOT NULL CHECK (verdict IN ('correct','wrong','partial')),
  verdict_notes text,
  graded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mbco_call_id ON morning_brief_call_outcomes(call_id);
CREATE INDEX IF NOT EXISTS idx_mbco_graded_at ON morning_brief_call_outcomes(graded_at);

-- RLS: public read. service_role bypasses RLS by default,
-- so writes from the grading pipeline are allowed without an explicit write policy.
ALTER TABLE morning_brief_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE morning_brief_call_outcomes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'morning_brief_calls'
      AND policyname = 'mbc_public_read'
  ) THEN
    EXECUTE 'CREATE POLICY mbc_public_read ON morning_brief_calls FOR SELECT USING (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'morning_brief_call_outcomes'
      AND policyname = 'mbco_public_read'
  ) THEN
    EXECUTE 'CREATE POLICY mbco_public_read ON morning_brief_call_outcomes FOR SELECT USING (true)';
  END IF;
END $$;
