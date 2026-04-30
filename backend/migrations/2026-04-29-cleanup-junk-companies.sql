-- =============================================================================
-- One-time cleanup: remove junk non-company entities from public.companies
-- =============================================================================
--
-- Why: These entries are not real companies. They leaked into public.companies
-- via the news ingestion pipeline, which extracts named entities from article
-- text and inserts them as company rows without sufficient validation. The
-- offending entries fall into a few buckets:
--
--   * News outlets / media platforms: TechCrunch, Bloomberg, Crunchbase, YouTube
--   * Government bodies:               Federal Reserve, Pentagon
--   * Countries:                       Iran
--
-- These showed up in Company Intel search results and clutter the dataset for
-- end users. Removing them is a one-time data hygiene fix.
--
-- Scope:
--   * This is a ONE-TIME cleanup. It is NOT a recurring filter, trigger, or
--     ingestion-side guard.
--   * Future prevention of this class of junk being ingested is OUT OF SCOPE
--     here and is tracked separately.
--   * Canonicalization of legitimate company name variants (e.g. "Anthropic"
--     vs "Anthropic PBC", "Meta" vs "Meta Platforms") is also OUT OF SCOPE.
--   * Only public.companies is touched. Related tables (companies_aliases,
--     watchlist, articles, etc.) are intentionally left alone; FK behavior is
--     left to the existing schema.
--
-- Match semantics:
--   The DELETE matches case-insensitively on the trimmed bare name only. A
--   real entity such as "Bloomberg LP" would NOT be matched and removed.
--
-- Apply manually via the Supabase SQL Editor after merge.
-- =============================================================================

BEGIN;

DELETE FROM public.companies
WHERE LOWER(TRIM(name)) IN (
    'techcrunch',
    'bloomberg',
    'crunchbase',
    'youtube',
    'federal reserve',
    'pentagon',
    'iran'
);

-- Verification: should return 0 after the DELETE above.
SELECT COUNT(*) AS remaining_junk
FROM public.companies
WHERE LOWER(TRIM(name)) IN (
    'techcrunch',
    'bloomberg',
    'crunchbase',
    'youtube',
    'federal reserve',
    'pentagon',
    'iran'
);

COMMIT;
