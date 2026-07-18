-- Lead-weight calibrator store (contract C4).
-- Created: 2026-07-16 (feat/lead-weight-calibrator)
--
-- DO NOT AUTO-APPLY. Written for human review; apply manually AFTER 0014.
-- (Renumbered 0013 -> 0015: 0013 is S1's is_lead migration and 0014 is the
--  grader's lead_outcome_grades; all three land distinct.)
--
-- Additive and non-destructive: one new table. No existing table, column, or
-- constraint is touched. Idempotent: safe to re-run.
--
-- lead_weights: the versioned, data-driven store for the four UNIFIED_LEAD
-- contest weights (materiality / session_fit / confirmation / breadth). The
-- offline calibrator (backend/lead_weight_calibrator.py) fits these against the
-- graded record and writes a NEW versioned row per recalibration; it never
-- mutates a prior row, so every weight set is traceable and reversible. The
-- LIVE scorer (impact_ranking.compute_unified_lead) READS the active row; it
-- never writes here. version is a strictly increasing integer; the row with the
-- highest version is the active set. is_default marks the hand-tuned safe
-- fallback (4 / 4 / 3 / 1.5) written when the calibrator refuses (N < 20).
--
-- Guardrail provenance is recorded ON the row so a human can audit any fit
-- without re-running it:
--   n_train              - confidence-weighted lead-attributable graded days seen
--   objective_before     - objective under prior_weights on the train set
--   objective_after      - objective under the fitted weights on the train set
--   prior_weights        - the weights this fit moved FROM (jsonb w-vector)
--   jul13_invariant_passed - the emitted weights still make the Jul 13 case pass
--                          (material macro leads, penny stock does NOT). The
--                          calibrator REFUSES to write a row where this is false.
--   notes                - free-text: refusal reason, per-weight movement, caps.

CREATE TABLE IF NOT EXISTS lead_weights (
  version                integer PRIMARY KEY,
  fit_ts                 timestamptz NOT NULL DEFAULT now(),
  w_materiality          double precision NOT NULL,
  w_session_fit          double precision NOT NULL,
  w_confirmation         double precision NOT NULL,
  w_breadth              double precision NOT NULL,
  n_train                integer NOT NULL DEFAULT 0,
  objective_before       double precision,
  objective_after        double precision,
  prior_weights          jsonb,
  is_default             boolean NOT NULL DEFAULT false,
  jul13_invariant_passed boolean NOT NULL DEFAULT false,
  notes                  text,
  CONSTRAINT lead_weights_nonneg CHECK (
    w_materiality >= 0 AND w_session_fit >= 0
    AND w_confirmation >= 0 AND w_breadth >= 0
  )
);

-- Active-row lookup: the live scorer selects the max(version) row.
CREATE INDEX IF NOT EXISTS idx_lead_weights_version_desc
  ON lead_weights(version DESC);

-- RLS: read-open (the weights are not user data and the live scorer reads them
-- with whatever role the pipeline runs as), write is service-role only. Service
-- role bypasses RLS, so no INSERT policy is needed for the calibrator; the
-- absence of an INSERT/UPDATE/DELETE policy denies those to anon/authenticated.
ALTER TABLE lead_weights ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_weights'
      AND policyname = 'lead_weights_public_read'
  ) THEN
    EXECUTE 'CREATE POLICY lead_weights_public_read ON lead_weights
      FOR SELECT USING (true)';
  END IF;
END $$;

-- Seed the hand-tuned safe default as version 0 (is_default = true). The
-- calibrator treats this as the reversion target and the prior-weights source
-- for its first real fit. Idempotent: ON CONFLICT DO NOTHING.
INSERT INTO lead_weights (
  version, w_materiality, w_session_fit, w_confirmation, w_breadth,
  n_train, is_default, jul13_invariant_passed, notes
) VALUES (
  0, 4.0, 4.0, 3.0, 1.5,
  0, true, true,
  'Seed: hand-tuned safe defaults (materiality=4, session_fit=4, confirmation=3, breadth=1.5). Matches impact_ranking W_* constants. Reversion target until the calibrator has N >= 20 confidence-weighted graded days.'
)
ON CONFLICT (version) DO NOTHING;
