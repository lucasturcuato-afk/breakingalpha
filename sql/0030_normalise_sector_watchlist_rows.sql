-- 0030_normalise_sector_watchlist_rows.sql
--
-- HAND-APPLY, AFTER REVIEW. Agents do not run migrations.
-- Mutates live user rows. Read section 1, eyeball the output, then run section 2.
--
-- Why:
--   watchlist is (identifier text, type watchlist_type). The type is a
--   constrained enum; the identifier is NOT -- no FK, no check constraint. The
--   sector branch of WatchlistAddInput fell through to raw query.trim() when
--   the typed text matched no canonical sector, so shorthand values were
--   stored verbatim:
--       'Finance'    instead of 'Financial Services'
--       'Energy'     instead of 'Energy & Oil/Gas'
--       'Consumer'   instead of 'Consumer & Retail'
--       'Healthcare' instead of 'Healthcare & Biotech'
--   None of those is a member of INDUSTRY_VERTICALS, which is the whitelist
--   articles.industry_verticals is validated against, so once sector matching
--   moves to taxonomy containment these rows match NOTHING.
--
--   The read path (src/lib/watchlist-utils.ts resolveSectorEntry) already
--   accepts these shorthands via an alias table, so the app is correct with or
--   without this migration. This normalises the stored data so the alias table
--   is a compatibility shim for old rows rather than load-bearing forever.
--
-- Scope: 5 rows, verified against production 2026-08-12.
--   'Consumer'   x2 -> 'Consumer & Retail'
--   'Energy'     x1 -> 'Energy & Oil/Gas'
--   'Finance'    x1 -> 'Financial Services'
--   'Healthcare' x1 -> 'Healthcare & Biotech'
--
-- Deliberately NOT touched:
--   'Public Markets' -- maps to nothing in either whitelist. Left for a human
--                       decision; see scratch/C-sector-watchlist-recon.md.
--   'Private Equity', 'Venture Capital' -- already exact ACTIVITY_TYPES members.
--   'Technology', 'Real Estate', 'Consumer & Retail' -- already canonical.
--
-- Collision check: no user holds both a shorthand and its canonical target, so
-- no row is merged and no duplicate is created. There is no UNIQUE constraint
-- on (user_id, identifier, type) in the schema, so this is a data-quality
-- check, not a constraint-violation risk. Section 1 re-verifies it live.

-- ---------------------------------------------------------------------------
-- SECTION 1 -- INSPECT. Run this first. Changes nothing.
-- ---------------------------------------------------------------------------

-- 1a. Every sector row, and what section 2 would do to it.
SELECT
  w.id,
  w.user_id,
  w.identifier                                   AS current_identifier,
  COALESCE(m.canonical, w.identifier)            AS after,
  CASE WHEN m.canonical IS NULL THEN 'unchanged' ELSE 'UPDATE' END AS action
FROM watchlist w
LEFT JOIN (VALUES
  ('consumer',   'Consumer & Retail'),
  ('energy',     'Energy & Oil/Gas'),
  ('finance',    'Financial Services'),
  ('healthcare', 'Healthcare & Biotech')
) AS m(shorthand, canonical)
  ON lower(btrim(w.identifier)) = m.shorthand
WHERE w.type = 'sector'
ORDER BY action DESC, w.identifier;

-- Expect: exactly 5 rows with action = 'UPDATE'.

-- 1b. Collision check. Expect ZERO rows. A row here means a user already holds
--     the canonical value, so normalising would leave them with a duplicate
--     sector entry and section 2 should be amended to delete instead of update.
SELECT
  w.user_id,
  w.identifier AS shorthand_row,
  m.canonical  AS collides_with
FROM watchlist w
JOIN (VALUES
  ('consumer',   'Consumer & Retail'),
  ('energy',     'Energy & Oil/Gas'),
  ('finance',    'Financial Services'),
  ('healthcare', 'Healthcare & Biotech')
) AS m(shorthand, canonical)
  ON lower(btrim(w.identifier)) = m.shorthand
WHERE w.type = 'sector'
  AND EXISTS (
    SELECT 1 FROM watchlist w2
    WHERE w2.type = 'sector'
      AND w2.identifier = m.canonical
      AND w2.user_id IS NOT DISTINCT FROM w.user_id
  );

-- 1c. Anything left off-taxonomy after section 2. Expect only 'Public Markets'.
SELECT w.id, w.user_id, w.identifier
FROM watchlist w
WHERE w.type = 'sector'
  AND lower(btrim(w.identifier)) NOT IN (
    'technology','healthcare & biotech','energy & oil/gas','financial services',
    'consumer & retail','industrials & manufacturing','aerospace & defense',
    'real estate','media & telecom','materials & mining','agriculture',
    'mergers & acquisitions','private equity','venture capital',
    'ipo & capital markets','earnings & results','macro & policy','geopolitics',
    'regulation & legal','fundraising','crypto & digital assets',
    'leadership & operations',
    'consumer','energy','finance','healthcare'   -- normalised by section 2
  );

-- ---------------------------------------------------------------------------
-- SECTION 2 -- APPLY. Only after section 1b returned zero rows.
-- ---------------------------------------------------------------------------

BEGIN;

UPDATE watchlist w
SET identifier = m.canonical,
    updated_at = now()
FROM (VALUES
  ('consumer',   'Consumer & Retail'),
  ('energy',     'Energy & Oil/Gas'),
  ('finance',    'Financial Services'),
  ('healthcare', 'Healthcare & Biotech')
) AS m(shorthand, canonical)
WHERE w.type = 'sector'
  AND lower(btrim(w.identifier)) = m.shorthand
  AND w.identifier <> m.canonical;   -- idempotent: a re-run is a no-op

-- Expect: UPDATE 5. If the count differs, ROLLBACK and re-run section 1.

COMMIT;

-- ---------------------------------------------------------------------------
-- SECTION 3 -- VERIFY after commit. Expect one row: 'Public Markets'.
-- ---------------------------------------------------------------------------
-- Re-run query 1c above.
