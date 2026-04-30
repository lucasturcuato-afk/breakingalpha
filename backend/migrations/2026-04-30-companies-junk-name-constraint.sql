-- =============================================================================
-- Migration: Junk-name prevention CHECK constraint on public.companies
-- Date: 2026-04-30
-- =============================================================================
--
-- Purpose:
--   This is a forward-looking PREVENTION constraint. It complements the
--   one-time cleanup performed in PR #160 (chore/cleanup-junk-companies,
--   migration 2026-04-29-cleanup-junk-companies.sql), which deleted 7
--   specific junk non-company entities from public.companies.
--
--   This migration adds a Postgres CHECK constraint on public.companies that
--   rejects any future INSERT or UPDATE producing a name (case-insensitive,
--   trimmed) that matches one of those 7 known-junk values, so future
--   ingestion runs cannot re-introduce them.
--
-- Blocked names (exact list, case-insensitive after TRIM):
--   1. techcrunch
--   2. bloomberg
--   3. crunchbase
--   4. youtube
--   5. federal reserve
--   6. pentagon
--   7. iran
--
-- Scope notes:
--   - This is a HARD constraint. If a legitimate ingestion path ever needs
--     to produce one of these names (e.g. a real corporate entity that
--     happens to share the string), the constraint must be relaxed
--     DELIBERATELY via a follow-up migration. It is intentionally not
--     soft / advisory.
--   - This constraint does NOT prevent broader categories of junk. It does
--     not block other news outlets, other government agencies, other
--     countries, or other non-company entities. It ONLY blocks the 7 known
--     offenders enumerated above. Broader heuristics / regex / NLP filters
--     are explicitly out of scope.
--   - This migration depends on PR #160's cleanup
--     (chore/cleanup-junk-companies branch, migration
--     2026-04-29-cleanup-junk-companies.sql) being applied FIRST. If it is
--     not, the safety pre-check below will abort the migration with a
--     clear error message rather than silently failing on ALTER TABLE.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Safety pre-check: abort if any existing rows would violate the new
-- constraint. This guarantees PR #160's cleanup has already been applied.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  violation_count INT;
BEGIN
  SELECT COUNT(*) INTO violation_count
  FROM public.companies
  WHERE LOWER(TRIM(name)) IN ('techcrunch', 'bloomberg', 'crunchbase', 'youtube', 'federal reserve', 'pentagon', 'iran');

  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Cannot add constraint: % existing rows would violate. Run PR #160 cleanup migration first.', violation_count;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Add the CHECK constraint.
-- -----------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD CONSTRAINT companies_name_no_junk
  CHECK (LOWER(TRIM(name)) NOT IN ('techcrunch', 'bloomberg', 'crunchbase', 'youtube', 'federal reserve', 'pentagon', 'iran'));

-- -----------------------------------------------------------------------------
-- Verification: confirm the constraint was created.
-- -----------------------------------------------------------------------------
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'companies_name_no_junk';

COMMIT;
