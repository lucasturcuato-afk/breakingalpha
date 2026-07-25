-- Lead-weight calibrator BETA GATE: add a `status` column to lead_weights.
-- Created: 2026-07-25 (feat/calibrator-beta-gate-proposed)
--
-- DO NOT AUTO-APPLY. Written for human review; apply manually AFTER 0015.
-- Numbered 0018 (not 0016) to leave a gap for the two sibling beta PRs landing
-- alongside this one.
--
-- Additive and non-destructive: one new nullable-with-default column plus two
-- indexes. No existing column, constraint, or row value is dropped or rewritten.
-- Idempotent: safe to re-run.
--
-- WHY
-- ---
-- The calibrator learns early in beta (floor lowered to N>=8 confidence-weighted
-- graded days; sub-floor fits are allowed but flagged low_confidence). But a fit
-- must NEVER auto-write the live weights the scorer reads. So a fit now produces a
-- PROPOSED row (status='proposed'), and a HUMAN promotes it to status='active' by
-- hand. The live scorer (impact_ranking.compute_unified_lead via
-- _read_active_weights_row) must read ONLY status='active' rows; a proposed row is
-- invisible to it no matter how high its version.
--
-- status vocabulary:
--   'active'   - the row the live scorer may read (at most one, enforced below).
--   'proposed' - a calibrator fit awaiting human promotion. Scorer IGNORES it.
--
-- low_confidence: TRUE when the proposing fit had N below the MIN_TRAIN_DAYS
-- floor (a thin beta sample). Recorded so a human weighs a proposal accordingly.

ALTER TABLE lead_weights
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS low_confidence boolean NOT NULL DEFAULT false;

-- Allowed status values. Existing/seed rows default to 'active' so pre-gate
-- behavior is unchanged.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_weights_status_chk'
  ) THEN
    ALTER TABLE lead_weights
      ADD CONSTRAINT lead_weights_status_chk
      CHECK (status IN ('active', 'proposed'));
  END IF;
END $$;

-- At most ONE active row (belt-and-suspenders: even a human fat-finger cannot
-- leave two active rows). The scorer still picks max(version) among active, but
-- this makes "active" unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_weights_single_active
  ON lead_weights ((true)) WHERE status = 'active';

-- Fast active-row lookup for the scorer's status-aware query.
CREATE INDEX IF NOT EXISTS idx_lead_weights_active_version
  ON lead_weights (version DESC) WHERE status = 'active';

-- Back-fill: every pre-existing row is 'active' by the column default above. The
-- seed default row (version 0, is_default=true) stays 'active' but the scorer
-- already excludes it via is_default=false, so it never becomes the live set.

-- ---------------------------------------------------------------------------
-- REQUIRED SCORER CHANGE (NOT in this migration; impact_ranking.py is owned by a
-- sibling PR). For the gate to bind, impact_ranking._read_active_weights_row()
-- must gain ONE predicate on its lead_weights query:
--
--     .eq("status", "active")
--
-- alongside the existing .eq("is_default", False).eq("jul13_invariant_passed", True).
-- Until that predicate lands, the calibrator side is already safe because it
-- NEVER writes: a proposed row only reaches the DB via a deliberate human insert.
-- ---------------------------------------------------------------------------

-- PROMOTION (manual, human-run; NOT executed here). To promote a reviewed
-- proposed row vN to active, in one transaction:
--
--   BEGIN;
--   UPDATE lead_weights SET status = 'proposed' WHERE status = 'active' AND is_default = false;
--   UPDATE lead_weights SET status = 'active'   WHERE version = <N>;
--   COMMIT;
