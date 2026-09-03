-- LANE E: TTL and invalidation columns for wikidata_entity_cache
--
-- ############################################################################
-- ## THIS FILE MUST NOT BE APPLIED BY AN AGENT. IT IS A PROPOSAL, NOT A RUN. ##
-- ## A HUMAN APPLIES IT, AND ONLY AFTER LANE C AND LANE D ARE DEPLOYED.      ##
-- ############################################################################
--
-- SEQUENCING. THE ORDER IS C, THEN D, THEN E. PLAIN LANGUAGE:
--
--   1. LANE C ships first: resolver widening and index merge. This rebuild
--      recovers company names the entity gate drops today, and every recovered
--      name goes through resolve_entity. If the resolver has not been widened
--      and its indexes merged first, roughly 60% of those recoveries land as
--      DUPLICATE companies rows instead of resolving onto an existing
--      canonical. That is a harder problem to unwind than the one being fixed.
--
--   2. LANE D ships second: the 429 fetch fix. Rebuilding the cache into a
--      throttled fetcher re-poisons it with exactly the same NULLs, at scale,
--      and burns the daily budget doing it. 76.34% of the rows in this table
--      are already NULL for that reason.
--
--   3. LANE E, this file and backend/wikidata_cache_rebuild.py, runs third.
--
-- The rebuild script enforces that order in code. It reads
-- entity_resolver.RESOLVER_CONTRACT and wikidata.FETCH_CONTRACT and refuses to
-- write anything until both report their lane shipped. The lane D gate has no
-- override flag.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FIXES
-- ---------------------------------------------------------------------------
-- wikidata_entity_cache has no TTL and no invalidation. Measured on 2026-08-20:
--   * 24,537 rows, 24,537 distinct names, zero duplicates
--   * oldest checked_at 2026-04-12, still live 130 days later
--   * 18,732 rows (76.34%) carry a NULL wikidata_description
--   * the read path selects is_company and wikidata_description with no
--     checked_at predicate, so a cached verdict is permanent
--   * the only DELETE in the repo is commented out in
--     20260503235800_w2a_wikidata_cleanup.sql, which says "Do not run them as-is"
--
-- Consequence: `Coinbase` has been cached is_company = FALSE since 2026-04-13
-- under the description "american company that operates a cryptocurrency
-- exchange platform", and today's classifier returns TRUE on that exact string.
-- PR #358 shipped the fix for that case on 2026-06-13 and has been inert for 68
-- days. Same for `Coinbase Global` and `Bitcoin Depot`. Every future classifier
-- fix, PR #627 included, is dead on arrival for the same reason.
--
-- ---------------------------------------------------------------------------
-- THE THREE COLUMNS
-- ---------------------------------------------------------------------------
-- classifier_version  Which classifier produced is_company. A row stamped vN is
--                     recognisably stale the moment the classifier becomes
--                     vN+1. Computed by wikidata.classifier_version(), which
--                     fingerprints all four keyword lists AND the parsed logic
--                     of _classify, so nobody has to remember to bump anything.
--
-- fetch_status        What Wikidata actually said. Today the fetcher collapses
--                     "no such entity", "HTTP 429" and "connection reset" into
--                     one indistinguishable NULL, and stores it forever. That
--                     collapse is the root defect.
--                       ok       we hold a non-empty description
--                       absent   Wikidata answered and has no entry (a real negative)
--                       error    429, 5xx or transport. NOT an answer.
--                       unknown  legacy row, written before status was recorded
--
-- last_refetch_at     When the rebuild last ASKED. Distinct from checked_at,
--                     which the rebuild only advances when a fetch actually
--                     happened, so a zero-network re-classify does not lie
--                     about the row's freshness.
--
-- ---------------------------------------------------------------------------
-- THE BACKFILL, AND WHY THE NULL ROWS ARE EXPIRED RATHER THAN PURGED
-- ---------------------------------------------------------------------------
-- Every existing row backfills to classifier_version = 'legacy', which makes it
-- stale by version on day one. That is intended: it is what finally lets PR
-- #358 and PR #627 take effect.
--
-- The 18,732 NULL rows plus the 276 empty-string rows backfill to
-- fetch_status = 'unknown'. We cannot retroactively tell a 429 from a genuine
-- absence, and labelling them 'absent' would be inventing a negative we never
-- measured. 'unknown' is the honest label and it means "re-fetch me".
--
-- They are NOT deleted. A purged row is a cache MISS, and a miss on the current
-- code path calls Wikidata inline inside the ingest hot loop at 0.15 s between
-- calls, which is 400 calls/min against a measured anonymous budget of 10 to 11
-- calls per 52 seconds. Purging converts a poisoned cache into an unpaced
-- live-fetch storm on the ingest critical path, and while the row is gone those
-- names have no verdict at all. Expiring is strictly monotonic instead: the row
-- keeps serving its current verdict, the rebuild picks it up out of band, and if
-- the rebuild never runs we are exactly where we are today. Purge is the one
-- option that can leave the cache worse than it started.
--
-- ---------------------------------------------------------------------------
-- REBUILD COST AFTER THIS MIGRATION (measured budget: 10 to 11 calls / 52 s)
-- ---------------------------------------------------------------------------
--   tier 1, re-classify 5,529 rows that already hold a description   ZERO calls, under a minute
--   tier 2, re-fetch 19,008 unknown-status rows                      27.46 h
--   tier 2 prioritised to names used as articles.primary_company     17.20 h for 11,907 rows
--   a full 24,537-row rebuild if someone forces one                  35.44 h
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
--   DROP INDEX IF EXISTS idx_wikidata_entity_cache_staleness;
--   ALTER TABLE wikidata_entity_cache
--     DROP COLUMN IF EXISTS classifier_version,
--     DROP COLUMN IF EXISTS fetch_status,
--     DROP COLUMN IF EXISTS last_refetch_at;
-- Additive only, so the rollback is a clean drop. No existing column is
-- modified and no row is deleted by this file.

ALTER TABLE wikidata_entity_cache
  ADD COLUMN IF NOT EXISTS classifier_version TEXT,
  ADD COLUMN IF NOT EXISTS fetch_status       TEXT,
  ADD COLUMN IF NOT EXISTS last_refetch_at    TIMESTAMPTZ;

-- Backfill. Mirrors backend/wikidata_cache_rebuild._backfill_view exactly, so
-- the pre-migration dry run projects the true post-migration work set.
UPDATE wikidata_entity_cache
   SET classifier_version = 'legacy'
 WHERE classifier_version IS NULL;

UPDATE wikidata_entity_cache
   SET fetch_status = CASE
         WHEN wikidata_description IS NOT NULL AND wikidata_description <> '' THEN 'ok'
         ELSE 'unknown'
       END
 WHERE fetch_status IS NULL;

ALTER TABLE wikidata_entity_cache
  ALTER COLUMN classifier_version SET DEFAULT 'legacy',
  ALTER COLUMN fetch_status       SET DEFAULT 'unknown';

-- Vocabulary is closed. A typo in a rebuild payload should fail loudly at the
-- write rather than silently create a fourth meaning of "we do not know".
ALTER TABLE wikidata_entity_cache
  DROP CONSTRAINT IF EXISTS wikidata_entity_cache_fetch_status_check;
ALTER TABLE wikidata_entity_cache
  ADD CONSTRAINT wikidata_entity_cache_fetch_status_check
  CHECK (fetch_status IN ('ok', 'absent', 'error', 'unknown'));

-- The rebuild's only hot query is "which rows still need work", which filters on
-- fetch_status and compares classifier_version against the current fingerprint.
CREATE INDEX IF NOT EXISTS idx_wikidata_entity_cache_staleness
  ON wikidata_entity_cache (fetch_status, classifier_version);

COMMENT ON COLUMN wikidata_entity_cache.classifier_version IS
  'Fingerprint of the _classify implementation that produced is_company. Mismatch against wikidata.classifier_version() means the verdict is stale and needs a zero-network re-classify.';
COMMENT ON COLUMN wikidata_entity_cache.fetch_status IS
  'ok | absent | error | unknown. What Wikidata actually said. unknown and error both mean the stored description is not an answer and the row needs a re-fetch.';
COMMENT ON COLUMN wikidata_entity_cache.last_refetch_at IS
  'When the rebuild last asked Wikidata. checked_at only advances when a fetch actually happened, so a zero-network re-classify never fakes freshness.';
