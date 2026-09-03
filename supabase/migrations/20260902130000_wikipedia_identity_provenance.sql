-- Wikipedia IDENTITY provenance on `companies`.
--
-- PROPOSAL. NOT APPLIED. Track D wrote this file and did not run it.
-- Apply by hand after review.
--
-- WHY
-- ---
-- `companies.description` exists and is NULL on all 4,276 rows. It is the third
-- identity source the Coverage Primer was designed around and it has never
-- carried a value, so the IDENTITY pillar today rests on 34 hand-written
-- COMPANY_IDENTITY briefs plus Yahoo's `assetProfile.longBusinessSummary`,
-- which only resolves for rows that carry a live ticker.
--
-- Filling `description` from an English Wikipedia lead paragraph moves 277 of
-- the 302 thin names that lack IDENTITY, 91.7 percent, against 109 for all six
-- other free sources combined at the same 74-character parity bar.
--
-- WHY THE PROVENANCE COLUMNS ARE NOT OPTIONAL
-- -------------------------------------------
-- The paragraph is licensed, not owned. CC BY-SA 4.0 section 3(a)(1) requires,
-- at render time, a URI or hyperlink to the licensed material and a notice
-- referring to the licence. Wikimedia's Terms of Use section 7 names the
-- hyperlink-to-the-article form as an acceptable way to discharge it. The page
-- cannot render that line from a bare text column, so the source url, the
-- article title and the licence travel with the text.
--
-- `description_source_revid` is the revision the paragraph was copied from.
-- Section 3(a)(1)(B) requires indicating whether the material was modified, and
-- that claim is not checkable without knowing what was started from. It is also
-- the only way to tell later whether a stored paragraph has drifted from the
-- live article.
--
-- `description_source` is what the render layer picks on. Precedence is
-- resolved by SOURCE, not by lookup: see src/lib/company-identity.ts.
--
-- NO BACKFILL IN THIS FILE. It adds columns and nothing else. The rows are
-- written by backend/scripts/backfill_wikipedia_identity.py, which refuses to
-- write a paragraph that is not byte-identical to a contiguous slice of the
-- fetched extract.
--
-- ROLLBACK is at the bottom, commented.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS description_source        TEXT,
  ADD COLUMN IF NOT EXISTS description_source_url    TEXT,
  ADD COLUMN IF NOT EXISTS description_source_title  TEXT,
  ADD COLUMN IF NOT EXISTS description_source_revid  BIGINT,
  ADD COLUMN IF NOT EXISTS description_license       TEXT,
  ADD COLUMN IF NOT EXISTS description_license_url   TEXT,
  ADD COLUMN IF NOT EXISTS description_fetched_at    TIMESTAMPTZ;

COMMENT ON COLUMN public.companies.description IS
  'Identity prose. When description_source = ''wikipedia'' this is a VERBATIM '
  'lead paragraph reproduced under CC BY-SA 4.0 section 2(a)(1)(A). It must not '
  'be trimmed, summarised, re-wrapped or model-rewritten anywhere between this '
  'column and the rendered page: any modification makes it Adapted Material '
  'under section 1(a) and fires the ShareAlike condition in section 3(b).';
COMMENT ON COLUMN public.companies.description_source IS
  'Which source produced description. Drives render precedence.';
COMMENT ON COLUMN public.companies.description_source_url IS
  'Hyperlink rendered for CC BY-SA 4.0 section 3(a)(1)(A)(v).';
COMMENT ON COLUMN public.companies.description_source_revid IS
  'Wikipedia revision the paragraph was copied from. Required to make the '
  '"indicate if you modified" claim in section 3(a)(1)(B) checkable.';

-- `wikipedia_repaired` is a distinct value on purpose. Those rows come from the
-- candidate-title repair pass, which is measured at a 30 to 41 percent
-- same-name-different-firm error rate and is therefore OFF by default in the
-- backfill runner. If it is ever switched on, the render layer can still choose
-- to treat those rows differently without a schema change.
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_description_source_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_description_source_check
  CHECK (description_source IS NULL OR description_source IN
         ('wikipedia', 'wikipedia_repaired', 'curated', 'yahoo', 'manual'));

-- A Wikipedia-sourced description without its attribution link is a licence
-- breach waiting to render, so the database refuses to hold one.
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_description_attribution_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_description_attribution_check
  CHECK (
    description_source IS NULL
    OR description_source NOT IN ('wikipedia', 'wikipedia_repaired')
    OR (description_source_url IS NOT NULL
        AND description_source_title IS NOT NULL
        AND description_license IS NOT NULL
        AND description_license_url IS NOT NULL)
  );

-- The read pattern is "give me the rows that already have identity prose" for
-- coverage reporting and re-fetch scheduling. Partial, so it indexes the rows
-- that exist rather than the 4,276 that do not.
CREATE INDEX IF NOT EXISTS companies_description_source_idx
  ON public.companies (description_source, description_fetched_at)
  WHERE description IS NOT NULL;

-- RLS: `companies` is already readable by the app under its existing policies
-- and these are columns on that table, not a new table, so no policy changes
-- are needed. Stated explicitly because a new column on an RLS table is exactly
-- where a silent read failure hides.

-- ROLLBACK
-- ALTER TABLE public.companies
--   DROP CONSTRAINT IF EXISTS companies_description_attribution_check,
--   DROP CONSTRAINT IF EXISTS companies_description_source_check;
-- DROP INDEX IF EXISTS public.companies_description_source_idx;
-- ALTER TABLE public.companies
--   DROP COLUMN IF EXISTS description_source,
--   DROP COLUMN IF EXISTS description_source_url,
--   DROP COLUMN IF EXISTS description_source_title,
--   DROP COLUMN IF EXISTS description_source_revid,
--   DROP COLUMN IF EXISTS description_license,
--   DROP COLUMN IF EXISTS description_license_url,
--   DROP COLUMN IF EXISTS description_fetched_at;
