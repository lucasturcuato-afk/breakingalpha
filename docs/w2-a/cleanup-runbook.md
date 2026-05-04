# W2-A Cleanup Runbook

For Noah. Follow in order. Each step is independently verifiable; do not skip.

## Prerequisites

1. Verify Agent A's PR (`noah/w2-a-scaffolding`) is merged and the migration applied. Confirm with:
   `psql ... -c "SELECT to_regclass('public.aliases');"` should return `aliases`.
2. Read `docs/w2-a/fk-audit-results.md`. The current VERDICT is FLAGGED (not UNSAFE -- no user-state tables are at risk), but two issues need a decision before this runbook proceeds:
   - The FK on `company_mentions.company_id` is `NO ACTION`, not `CASCADE`. The cleanup migration in this PR adds an explicit `DELETE FROM company_mentions` step ahead of the companies-DELETE to handle this. No design-doc amendment required for the FK side.
   - The polluted set includes high-mention real companies (OpenAI at 190 mentions, Meta, Visa, Netflix, etc.). Decide whether to (a) run the cleanup as designed and accept loss of historical `mention_count`/`first_seen`/`key_themes`, (b) ship the flip without bulk cleanup so future ingest stops adding noise but existing rows stay, or (c) narrow the cleanup to only delete companies with `mention_count = 0`. Steps 6-7 below assume option (a). For (b), skip steps 6-7. For (c), edit the migration before uncommenting.

## Cleanup procedure

3. Run the dry-run pollution count again. Confirm the count is within +/- 20% of the count recorded in `fk-audit-results.md` (1260 at time of audit). If wildly different, investigate before proceeding.
   ```sql
   SELECT COUNT(*) FROM companies c
   JOIN wikidata_entity_cache w ON w.name = c.name
   WHERE w.is_company IS NULL;
   ```
4. Apply `docs/w2-a/wikidata-flip.diff` to `backend/wikidata.py`:
   `git checkout -b noah/w2-a-wikidata-flip main && git apply docs/w2-a/wikidata-flip.diff`
   Verify with `git diff backend/wikidata.py` -- should show exactly two single-line changes (lines 131 and 160).
5. Open a PR for the flip on its own branch (`noah/w2-a-wikidata-flip`). Lucas review optional (his lane is ingest.py, not wikidata.py). Merge when ready.
6. Apply the cleanup migration:
   - Open `supabase/migrations/20260503235800_w2a_wikidata_cleanup.sql`
   - UNCOMMENT all three DELETE statements at the bottom of the file (the `company_mentions` DELETE first, then the `companies` DELETE, then the `wikidata_entity_cache` DELETE -- order matters because the FK is `NO ACTION`)
   - Wrap the run in a transaction. Run the `company_mentions` DELETE first; verify the row count is roughly 2310 (per audit); commit if happy
   - Then run the `companies` DELETE; verify the row count matches the dry-run prediction; commit if happy
   - Then run the `wikidata_entity_cache` DELETE
7. Run validation queries from design doc section 10 to confirm pollution is zero:
   ```sql
   SELECT COUNT(*) FROM companies c
   JOIN wikidata_entity_cache w ON w.name = c.name
   WHERE w.is_company IS NULL;
   ```
   Expected: 0.
8. Document the cleanup in the next handoff doc (`docs/HANDOFF.md`): rows deleted from each table, date, any anomalies (e.g., row counts that differed from the audit, or any company_mentions deletes that surprised you).
