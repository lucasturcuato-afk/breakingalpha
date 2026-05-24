-- =============================================================================
-- WD92: backfill companies.sector by aggregating most-common sector per company
-- =============================================================================
--
-- Why: companies.sector was 0/3,106 populated before this change. PR #85's
-- dual-dimension refactor added articles.industry_verticals + articles.sector
-- but never wrote sector back to the canonical companies table. The Company
-- Intel page (frontend) renders companies.sector directly, so every company
-- page showed an empty/wrong sector. P0 ship-blocker for beta launch.
--
-- Approach: aggregate articles.sector grouped by LOWER(articles.primary_company)
-- via mode (most-frequent value); write the per-company mode back to
-- companies.sector, but only for rows currently NULL or empty (idempotent).
--
-- Decisions baked into this SQL (see WD92 recon for full rationale):
--   * Source field:     articles.sector (single string per article, cleaner
--                       mode than the JSONB-array industry_verticals).
--   * JOIN strategy:    LOWER(primary_company) = LOWER(name). Narrower but
--                       higher-signal than the broader companies[] array,
--                       which mis-classifies analyst/comparator mentions
--                       (e.g. Mizuho quoted in tech articles → "Technology").
--   * Tiebreaker:       alphabetical ASC. Deterministic — re-runs produce the
--                       same result, never churns existing values.
--   * Idempotency:      WHERE companies.sector IS NULL OR sector = ''. Once a
--                       row is populated, subsequent runs skip it. Protects
--                       any manually-set sectors from being overwritten.
--   * Placeholder guard: excludes primary_company values like 'null',
--                       'newco', 'targetco' (8 articles in current data).
--                       These don't match any companies row today, but the
--                       guard prevents future pollution.
--
-- Trade-off (intentional): 1,214 of 3,106 companies (39%) populated on
-- initial run. The other 1,892 stay NULL — either no primary_company match
-- (entity-resolution gap; future WD: suffix-stripping for Inc/Corp/Ltd) or
-- matched articles all have NULL sector themselves (orthogonal WD49 gap).
-- Strict improvement on the pre-WD92 state of 100% NULL.
--
-- This file is BOTH:
--   1. A record of the initial backfill (already executed against production
--      on 2026-05-18 via the same logic, run from backend Python with the
--      service role key — Supabase MCP was read-only in this env).
--   2. The canonical SQL reference for the idempotent nightly cron, which
--      lives in backend/sector_backfill.py and replicates this logic via
--      supabase-py (matching the rest of the backend, which uses no raw
--      SQL at runtime). Re-running this migration is safe and a no-op for
--      already-populated rows.

WITH ranked AS (
  SELECT
    LOWER(a.primary_company) AS lc_name,
    a.sector                 AS article_sector,
    COUNT(*)                 AS article_count
  FROM articles a
  WHERE a.primary_company IS NOT NULL AND a.primary_company != ''
    AND a.sector           IS NOT NULL AND a.sector           != ''
    AND LOWER(a.primary_company) NOT IN
        ('null', '<null>', 'unknown', 'newco', 'targetco',
         'n/a', 'na', 'none', 'tbd', 'pending')
  GROUP BY LOWER(a.primary_company), a.sector
),
mode_per_company AS (
  SELECT lc_name, article_sector AS mode_sector
  FROM (
    SELECT
      lc_name,
      article_sector,
      ROW_NUMBER() OVER (
        PARTITION BY lc_name
        ORDER BY article_count DESC, article_sector ASC
      ) AS rn
    FROM ranked
  ) ordered
  WHERE rn = 1
)
UPDATE public.companies c
SET    sector = m.mode_sector
FROM   mode_per_company m
WHERE  LOWER(c.name) = m.lc_name
  AND  (c.sector IS NULL OR c.sector = '');

-- Verify post-state
SELECT
  COUNT(*) FILTER (WHERE sector IS NULL OR sector = '') AS null_count,
  COUNT(*) FILTER (WHERE sector IS NOT NULL AND sector != '') AS populated_count,
  COUNT(*) AS total
FROM public.companies;
