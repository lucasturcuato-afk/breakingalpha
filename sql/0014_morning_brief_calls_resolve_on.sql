-- Per-call resolution horizons on brief calls.
-- Created: 2026-07-25 (feat/call-resolution-horizons)
--
-- Adds morning_brief_calls.resolve_on: the date a call's window closes and it
-- becomes eligible for grading. Set at creation by extract_and_persist_claims
-- from the fixed map in backend/call_horizons.py (session +0, week +7,
-- multiweek +21 calendar days from brief_date).
--
-- Additive and non-destructive. Nullable with no default and no backfill,
-- deliberately:
--
--   NULL means "this call predates horizons". The due-scan in
--   backend/grading/grade_brief_calls.py requires resolve_on IS NOT NULL, so
--   every existing row is STRUCTURALLY EXCLUDED from grading forever. That is
--   the point. Backfilling resolve_on (or coalescing it to brief_date in the
--   query) would make all 220 ungraded historical calls due at once and grade
--   them in a single run against prices nobody stood behind at the time. That
--   is the mass-backfill the grader's argument guard exists to prevent
--   (grade_brief_calls.py rejects --backfill and every other unknown arg).
--   Do not add a DEFAULT. Do not backfill.
--
-- Idempotent: safe to re-run.
--
-- NOTE: do NOT apply autonomously. Written for a human to review and run.

ALTER TABLE morning_brief_calls
  ADD COLUMN IF NOT EXISTS resolve_on date;

-- The due-scan reads "calls whose window has closed and are not yet graded".
-- Partial index: NULL rows are never selected, so they do not belong in it.
CREATE INDEX IF NOT EXISTS idx_mbc_resolve_on
  ON morning_brief_calls (resolve_on)
  WHERE resolve_on IS NOT NULL;

COMMENT ON COLUMN morning_brief_calls.resolve_on IS
  'Date this call''s window closes and it becomes gradeable. Set at creation from backend/call_horizons.py. NULL = pre-horizons, never graded.';
