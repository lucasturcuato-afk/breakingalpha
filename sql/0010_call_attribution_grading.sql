-- Attribution-aware call grading: schema support for the resolver rework.
-- Created: 2026-07-03 (feat/resolver-attribution)
--
-- DO NOT AUTO-APPLY. Written for human review; apply manually BEFORE
-- merging/running the new grader (it inserts into the new columns and
-- writes the 'ungradable' verdict).
--
-- Recon correction: the plan assumed morning_brief_call_outcomes already
-- had a metadata column and a permissive verdict constraint. It has
-- neither (see sql/0003_brief_self_grading.sql lines 28-38), so this
-- migration adds both alongside the attribution filter column.
--
-- Everything here is additive and non-destructive:
--   1. New nullable column: attribution (fast filtering on clean hits).
--   2. New nullable column: metadata jsonb (grader evidence: entity and
--      benchmark moves, thresholds, tier, attribution_confidence,
--      ungradable_reason). No existing column is touched.
--   3. verdict CHECK widened to also allow 'ungradable'. Existing values
--      ('correct','wrong','partial') remain valid; no row is rewritten.
--   4. actual_direction NOT NULL relaxed: ungradable outcomes have no
--      realized direction. Existing rows all have values; nothing changes.
--   5. Partial index for attribution filtering.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / DROP IF EXISTS + re-add).
-- No rows are updated, deleted, or backfilled. Old outcomes keep
-- attribution = NULL and metadata = NULL, which correctly marks them as
-- graded by the legacy naive grader.

ALTER TABLE morning_brief_call_outcomes
  ADD COLUMN IF NOT EXISTS attribution text
    CHECK (attribution IN ('clean','confounded','inconclusive'));

ALTER TABLE morning_brief_call_outcomes
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Widen the verdict vocabulary. Constraint name matches the auto-generated
-- name from the inline CHECK in sql/0003_brief_self_grading.sql.
ALTER TABLE morning_brief_call_outcomes
  DROP CONSTRAINT IF EXISTS morning_brief_call_outcomes_verdict_check;
ALTER TABLE morning_brief_call_outcomes
  ADD CONSTRAINT morning_brief_call_outcomes_verdict_check
    CHECK (verdict IN ('correct','wrong','partial','ungradable'));

-- Ungradable rows carry no realized direction. The existing inline CHECK
-- (actual_direction IN ('up','down','flat')) already passes on NULL.
ALTER TABLE morning_brief_call_outcomes
  ALTER COLUMN actual_direction DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mbco_attribution
  ON morning_brief_call_outcomes (attribution)
  WHERE attribution IS NOT NULL;
