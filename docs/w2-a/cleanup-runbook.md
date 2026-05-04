# W2-A Cleanup Runbook

For Noah. Follow in order. Each step is independently verifiable; do not skip.

**STATUS:** Path (b) chosen. See `docs/w2-a/fk-audit-results.md` DECISION section. The bulk-cleanup steps (originally 6-7) are NOT executed. This runbook is now flip-only.

## Prerequisites

1. Verify Agent A's PR (`noah/w2-a-scaffolding`) is merged and the migration applied. Confirm with:

   ```sql
   SELECT to_regclass('public.aliases') AS aliases_exists;
   ```

   Should return `aliases`.

2. Read `docs/w2-a/fk-audit-results.md` end to end, including the DECISION section. Confirm path (b) is still the intent.

## Flip procedure

3. Apply `docs/w2-a/wikidata-flip.diff` to `backend/wikidata.py`:

   ```bash
   git checkout -b noah/w2-a-wikidata-flip main
   git apply docs/w2-a/wikidata-flip.diff
   ```

   Verify with `git diff backend/wikidata.py` - should show exactly two single-line changes (lines 131 and 160).

4. Open a PR for the flip on its own branch (`noah/w2-a-wikidata-flip`). Lucas review optional (his lane is ingest.py, not wikidata.py). Merge when ready.

5. Verify the flip is live in production by checking the next ingest run's logs. The `~ Wikidata ambiguous (keep)` log line should no longer appear; instead ambiguous entities should be silently dropped (or appear under a different log line if wikidata.py has one for the drop case).

## Cleanup procedure

DELETED. Path (b) does not run bulk cleanup. The cleanup migration file (`supabase/migrations/20260503235800_w2a_wikidata_cleanup.sql`) remains in the repo as future-reference only. Its DELETE statements MUST stay commented out.

## Validation (post-flip only)

6. Confirm the flip is preventing new pollution. Run weekly for the first month:

   ```sql
   -- Count of "ambiguous-keep" rows added since flip
   SELECT COUNT(*)
   FROM companies c
   JOIN wikidata_entity_cache w ON w.name = c.name
   WHERE w.is_company IS NULL
     AND c.created_at > '<flip-merge-date>';
   ```

   Expected: 0 (or very small, accounting for race conditions during the deploy window).

7. Track existing polluted set. The 1,260 rows from the audit stay. Use this query to monitor:

   ```sql
   SELECT COUNT(*) AS polluted_total
   FROM companies c
   JOIN wikidata_entity_cache w ON w.name = c.name
   WHERE w.is_company IS NULL;
   ```

   Expected: ~1,260 (no growth post-flip).

8. Document the flip in the next handoff doc (`docs/HANDOFF.md`): flip date, validation results from steps 6-7, any anomalies.
