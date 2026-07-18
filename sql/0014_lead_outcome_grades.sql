-- Macro lead-outcome grading: schema for the deterministic macro_lead_grader.
-- Created: 2026-07-16 (feat/macro-lead-grader). Renamed 0013 -> 0014 to clear
-- the collision with 0013_morning_brief_calls_is_lead.sql (#486).
--
-- DO NOT AUTO-APPLY. Written for human review; apply manually BEFORE the
-- macro lead grader writes rows. Nothing in this migration is destructive.
-- NOTE: `window` is a reserved Postgres keyword; it MUST be quoted as "window"
-- or the CREATE TABLE fails to apply. Noah applied the quoted form by hand.
--
-- Contract C3. One append-only row per graded morning/evening lead. The
-- grader is fully deterministic (no LLM): it scores whether the brief LED
-- WITH THE RIGHT MOVER on a macro day, using an anchor-anchored price window
-- reconstructed from persisted briefings.market_tape.
--
-- Window semantics (all levels are index/channel levels off market_tape):
--   prior_close  close of the prior session (morning row: level/(1+pct/100))
--   anchor       the session-open reference: the true 09:30 open when the tape
--                carries it (anchor_source=true_open, is_open_proxy=false),
--                else the morning run's recorded snapshot level
--                (anchor_source=run_snapshot, is_open_proxy=true). The anchor
--                is NEVER an assumed clock time; anchor_ts is the tape's actual
--                recorded as_of.
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
  -- {prior_close, anchor, anchor_source, same_close, t1} per channel.
  -- "window" is quoted: unquoted WINDOW is a reserved keyword and fails.
  "window"      jsonb,
  is_open_proxy boolean NOT NULL DEFAULT true,
  -- The ACTUAL recorded timestamp of the tape used as the anchor (read from
  -- market_tape.as_of, never an assumed clock time).
  anchor_ts     timestamptz,
  -- {true_open, run_snapshot}: which basis the anchor came from, so a
  -- mixed-basis training set stays detectable later.
  anchor_source text CHECK (anchor_source IS NULL OR anchor_source IN ('true_open','run_snapshot')),
  notes         text,
  graded_at     timestamptz NOT NULL DEFAULT now()
);

-- Anchor columns are additive; add them if the base table was applied before
-- FIX 1 landed (Noah's hand-applied version predates these two columns).
ALTER TABLE lead_outcome_grades ADD COLUMN IF NOT EXISTS anchor_ts timestamptz;
ALTER TABLE lead_outcome_grades ADD COLUMN IF NOT EXISTS anchor_source text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'lead_outcome_grades' AND column_name = 'anchor_source'
      AND constraint_name = 'lead_outcome_grades_anchor_source_check'
  ) THEN
    ALTER TABLE lead_outcome_grades
      ADD CONSTRAINT lead_outcome_grades_anchor_source_check
      CHECK (anchor_source IS NULL OR anchor_source IN ('true_open','run_snapshot'));
  END IF;
END $$;

-- One grade per (date, type) lead; re-grading upserts on this key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_outcome_grades_brief
  ON lead_outcome_grades (brief_date, brief_type);

CREATE INDEX IF NOT EXISTS idx_lead_outcome_grades_cluster
  ON lead_outcome_grades (lead_cluster)
  WHERE lead_cluster IS NOT NULL;
