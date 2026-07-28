-- Grade adopted claims too: rebuild the due-scan index without its source predicate.
-- Created: 2026-07-27 (fix/grade-adopted-claims)
--
-- backend/grading/grade_user_claims.py used to select source = 'authored' only,
-- so adopted claims were never graded: a call tracked from the brief sat
-- status = 'open' forever with no path to resolution. The grader now scans both
-- sources (GRADEABLE_SOURCES).
--
-- idx_user_claims_due was built to match the old scan and carries
-- "AND source = 'authored'" in its WHERE clause. A partial index only serves a
-- query the planner can prove is contained by that predicate, so the widened
-- scan would NOT use it and would fall back to a sequential scan on user_claims.
-- Dropping the source predicate makes the index match the new scan exactly.
--
-- The remaining predicate (gradeable AND status = 'open') is still the right
-- shape: it keeps the index to the small set of rows that can ever be due,
-- which is what makes it worth having.
--
-- Live definition being replaced (verified 2026-07-27):
--   CREATE INDEX idx_user_claims_due ON public.user_claims
--     USING btree (resolution_window_end)
--     WHERE (gradeable AND (status = 'open'::text) AND (source = 'authored'::text));
--
-- Index-only change. No table is altered, no column added, no row read or
-- written, and no grading math is touched. Idempotent: safe to re-run.
--
-- NOTE: do NOT apply autonomously. Written for a human to review and run.

DROP INDEX IF EXISTS idx_user_claims_due;

CREATE INDEX IF NOT EXISTS idx_user_claims_due
  ON user_claims (resolution_window_end)
  WHERE gradeable AND status = 'open';

COMMENT ON INDEX idx_user_claims_due IS
  'Due-scan for backend/grading/grade_user_claims.py: gradeable open claims by window close, any source.';
