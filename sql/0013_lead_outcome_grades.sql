-- Macro lead-outcome grading: schema for the deterministic macro_lead_grader.
-- Created: 2026-07-16 (feat/macro-lead-grader)
--
-- DO NOT AUTO-APPLY. Written for human review; apply manually BEFORE the
-- macro lead grader writes rows. Nothing in this migration is destructive.
--
-- Contract C3. One append-only row per graded morning/evening lead. The
-- grader is fully deterministic (no LLM): it scores whether the brief LED
-- WITH THE RIGHT MOVER on a macro day, using an open-anchored price window
-- reconstructed from persisted briefings.market_tape.
--
-- Window semantics (all levels are index/channel levels off market_tape):
--   prior_close  close of the prior session (morning row: level/(1+pct/100))
--   open_proxy   the morning run's ~10am ET level (session-open stand-in;
--                the true 09:30 open is NOT persisted, so is_open_proxy is
--                always true for these grades)
--   same_close   close of the same session (the D+1 evening row level)
--   t1           follow-through close (the D+2 evening row level)
--
-- grade_score maps to [-1,1]: clean mover identify = +1, partial = 0,
-- missed = -1. confidence is [0,1] and is driven LOW (never discarded) on
-- multi-catalyst days, in-line/no-gap prints, pre-FOMC deferral windows,
-- and open-proxy uncertainty.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS lead_outcome_grades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_date    date NOT NULL,
  brief_type    text NOT NULL CHECK (brief_type IN ('morning','evening')),
  lead_title    text,
  lead_cluster  text,
  mover_identified boolean,
  -- Mapped to [-1,1]: +1 clean identify, 0 partial, -1 missed.
  grade_score   double precision
                  CHECK (grade_score IS NULL OR (grade_score >= -1 AND grade_score <= 1)),
  -- [0,1]. The grader flags low confidence rather than discarding.
  confidence    double precision
                  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- Per-channel contribution (index / rates / vix / oil) to the session move.
  attribution   jsonb,
  -- {prior_close, open_proxy, same_close, t1} per channel.
  window        jsonb,
  is_open_proxy boolean NOT NULL DEFAULT true,
  notes         text,
  graded_at     timestamptz NOT NULL DEFAULT now()
);

-- One grade per (date, type) lead; re-grading upserts on this key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_outcome_grades_brief
  ON lead_outcome_grades (brief_date, brief_type);

CREATE INDEX IF NOT EXISTS idx_lead_outcome_grades_cluster
  ON lead_outcome_grades (lead_cluster)
  WHERE lead_cluster IS NOT NULL;
