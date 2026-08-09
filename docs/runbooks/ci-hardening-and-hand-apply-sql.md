# CI hardening and hand-apply SQL runbook

Owner: Noah. Everything in this file is either a repo setting only a human can
change, or a SQL statement that must be run by hand against prod. Nothing here
changes pipeline behavior and nothing here changes what a brief says.

Status of the facts below, all verified 2026-08-08 against `origin/main` at
`ef665172`.

---

## 1. Make `backend-tests` a required status check

`gh api repos/lucasturcuato-afk/breakingalpha/branches/main/protection` returns
404. There is no branch protection on `main` at all today, so `backend-tests`
from #559 is not a required check, because nothing is. The job runs on every
backend PR and its failure is currently advisory in practice: a red run does not
stop a merge.

### The exact check name

GitHub lists required checks by the **check run name**, which is the job's
`name:` field, not the job key. In `.github/workflows/verify-py.yml`:

```yaml
  backend-tests:            # job key, NOT what GitHub shows
    name: backend/tests suite
```

So the string to select is:

```
backend/tests suite
```

The sibling job in the same workflow shows as `ruff + pytest smoke`. Add that one
too if you want lint gated as well; it is the same file and the same trigger set.

### Click path

1. Go to `https://github.com/lucasturcuato-afk/breakingalpha`.
2. **Settings** (top tab bar, far right; requires admin on the repo).
3. Left sidebar, **Rules** -> **Rulesets**. (The older **Branches** ->
   **Branch protection rules** path still works and is equivalent; use Rulesets,
   it is where GitHub is putting new settings.)
4. **New ruleset** -> **New branch ruleset**.
5. Name it `main`.
6. **Enforcement status**: switch from `Disabled` to `Active`.
7. Under **Target branches**, click **Add target** -> **Include default branch**.
8. In the **Rules** checkbox list, tick **Require status checks to pass**.
9. That expands an inline panel. Click **+ Add checks**.
10. Type `backend/tests suite` into the search box. It only appears if that check
    has reported on this repo at least once in the last week; it has (#559
    onward). Select it. Repeat for `ruff + pytest smoke` if you want it too.
11. Leave **Require branches to be up to date before merging** UNTICKED for now.
    Ticking it forces a rebase-and-rerun on every merge, which on a two-person
    repo mostly costs time. Turn it on later if main starts breaking from
    semantic conflicts.
12. Also tick **Require a pull request before merging** in the same Rules list.
    Without it, a direct commit bypasses status checks entirely and the required
    check buys nothing.
13. Scroll to the bottom, **Create**.

### Verify it took

```
gh api repos/lucasturcuato-afk/breakingalpha/rulesets --jq '.[] | {id,name,enforcement}'
gh api repos/lucasturcuato-afk/breakingalpha/rules/branches/main --jq '.[] | .type'
```

The second command should list `pull_request` and `required_status_checks`. Right
now it returns `[]`.

### One warning

`verify-py.yml` is `paths:`-filtered to `backend/**`, `requirements*.txt`,
`ruff.toml`, `scripts/verify-py.sh`, `scripts/backend-tests.sh`, and the workflow
file itself. A required check that does not run on a given PR leaves that PR
**pending forever** and unmergeable, unless the ruleset is configured to skip it.
GitHub's newer Rulesets handle skipped-by-path checks correctly (they are not
treated as pending). The legacy branch protection UI does **not**. This is the
main reason step 3 says use Rulesets. After enabling, open one frontend-only PR
and confirm it is still mergeable before you trust it.

---

## 2. Playwright in CI: NO, not without a dedicated non-prod target

**Decision: the Playwright suite cannot run in CI today, and no read-only subset
was wired, because no honest read-only subset exists.**

### Evidence, from `playwright.config.ts`

Two project shapes, selected by whether `E2E_BASE_URL` starts with `https://`:

```ts
const chromiumProject = {
  name: "chromium",
  use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
  dependencies: ["setup"],
  testIgnore: /(auth-smoke|prod-smoke-5route)\.spec\.ts/,
};
```

Every local spec runs in `chromium`, and `chromium` has
`dependencies: ["setup"]` plus `storageState: AUTH_FILE`. There is no project
without that dependency. So there is no path to running any spec that does not
first execute `e2e/auth.setup.ts`, which calls `signIn(page)`, which reads:

```ts
// e2e/auth-helper.ts:11-13
email: process.env.E2E_USER_EMAIL,
password: process.env.E2E_USER_PASSWORD,
baseUrl: process.env.E2E_BASE_URL?.replace(/\/$/, ""),
```

Those are real credentials for a real account on the live Supabase project.

The other branch is explicitly prod-targeted:

```ts
const smokeProdProject = {
  name: "smoke-prod",
  testMatch: /(auth-smoke|prod-smoke-5route)\.spec\.ts/,
};
```

And the local webServer is `npm run dev`, which boots the app against whatever
`NEXT_PUBLIC_SUPABASE_URL` is set. The only configured value is the prod project.

### The suite mutates

`e2e/watchlist.spec.ts` is not a reader:

```ts
await input.fill("AAPL");
await page.getByRole("button", { name: "ADD" }).click();   // lines 25-26
...
const deleteBtn = page.getByRole("button", { name: /Remove/i }).first();
if (await deleteBtn.isVisible().catch(() => false)) {
  await deleteBtn.click();                                  // lines 51-55
}
```

That is an INSERT and a DELETE against prod `watchlist_*` tables on every run.
The remove test deletes whatever happens to be first, which is not necessarily
the row the add test created.

### Why a read-only subset was not wired anyway

The tempting subset is `navigation.spec.ts` and `ticker-strip.spec.ts`, which
only `goto` and assert. Both were read; neither writes. But:

- Every route they touch (`/dashboard`, `/morning-brief`) is behind auth. Without
  the setup project they redirect to sign-in and assert nothing useful.
- Running them therefore still means putting `E2E_USER_EMAIL`,
  `E2E_USER_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL` and the anon key into GitHub
  Actions secrets, and having GitHub-hosted runners authenticate against prod on
  every PR. That is a permanent credential-exposure surface bought for two
  low-value smoke specs.
- Their assertions are content-dependent (`/Risk-Off|Risk-On|Neutral/`, arrow
  glyphs, price cells). Against live prod data they are flaky by construction,
  which is exactly how a CI job gets disabled in week one. CLAUDE.md already
  records a floor of 14 deterministic failures.

A gate that needs prod credentials to be green is not a gate. Do not wire it.

### What it would take to promote e2e to a real CI gate

All three, not one of three:

1. **A dedicated non-prod Supabase target.** A separate project ref (or a
   Supabase branch) with its own URL and keys, wired as
   `E2E_SUPABASE_URL` / `E2E_SUPABASE_ANON_KEY`, so a mutating spec destroys
   nothing anyone cares about.
2. **A seeded fixture.** A committed seed script that creates the test user, a
   deterministic watchlist, and a fixed set of articles, theses and a brief, run
   before the suite. Without it the content assertions stay flaky and the mood
   bar, ticker strip and Top Stories specs cannot be made deterministic.
3. **Teardown, or per-run isolation.** The suite is `fullyParallel: false,
   workers: 1` today, so a reset-between-runs step is sufficient; no per-worker
   namespacing needed.

Until all three exist, e2e stays advisory, run supervised and manually, exactly
as CLAUDE.md already says.

---

## 3. `sql/0023_top_stories_index.sql` VERIFY block

`sql/0023` and `sql/0024` are both marked HAND-APPLY, and neither can be proven
from this repo: PostgREST cannot read `pg_indexes`, so no script here can tell
you whether they are applied. Run these in the Supabase SQL editor.

### 0023, step 1: is it already applied

```sql
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename  = 'articles'
   AND indexname IN ('idx_articles_top_stories', 'idx_articles_ingested_at')
 ORDER BY indexname;
```

Expected when applied: exactly 2 rows. Zero rows means 0023 was never run and
every dashboard load is scanning and sorting `articles`.

### 0023, step 2: apply, one statement at a time

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block. The Supabase
SQL editor wraps a multi-statement paste in one. Paste and run these ONE AT A
TIME. Both are `IF NOT EXISTS`, so re-running is a no-op.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_top_stories
  ON public.articles (published_at DESC, relevance_score DESC, ingested_at DESC);
```

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_ingested_at
  ON public.articles (ingested_at DESC);
```

### 0023, step 3: prove it worked

```sql
-- 3a. Both indexes now exist and are VALID. invalid = true means the
--     CONCURRENTLY build failed partway; DROP it and rebuild.
SELECT c.relname AS indexname, i.indisvalid, i.indisready,
       pg_size_pretty(pg_relation_size(c.oid)) AS size
  FROM pg_class c
  JOIN pg_index i ON i.indexrelid = c.oid
 WHERE c.relname IN ('idx_articles_top_stories', 'idx_articles_ingested_at');
```

```sql
-- 3b. The actual Top Stories query is now index-served.
--     PASS  = "Index Scan" or "Bitmap Index Scan" on idx_articles_top_stories,
--             Execution Time in the low tens of ms.
--     FAIL  = "Seq Scan on articles" with a large "Rows Removed by Filter".
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, source, published_at, ingested_at, relevance_score,
       primary_company
  FROM public.articles
 WHERE ingested_at  >= now() - interval '72 hours'
   AND published_at >= now() - interval '7 days'
 ORDER BY relevance_score DESC, ingested_at DESC, published_at DESC, id ASC
 LIMIT 24;
```

```sql
-- 3c. Over the following days, idx_scan must climb. Stuck at 0 means the
--     planner is ignoring the index and it is pure write-cost.
SELECT indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
  FROM pg_stat_user_indexes
 WHERE indexrelname IN ('idx_articles_top_stories', 'idx_articles_ingested_at');
```

Then reload the dashboard. Top Stories should fill on every load and the browser
console should show no `57014` statement-timeout errors.

---

## 4. `sql/0024_disk_io_indexes.sql` VERIFY block

### SKIP SECTION 1. `idx_articles_url` IS A DUPLICATE. DO NOT CREATE IT.

`public.articles.url` already carries a unique index named `articles_url_key`,
created implicitly by its UNIQUE constraint. A btree on `(url)` is exactly what
`idx_articles_url` from section 1 would create, so building it would add a second
full-size index on a high-write column for zero query benefit: more disk, more IO
on every ingest insert, and the planner would keep choosing `articles_url_key`
anyway.

The file's own step `0d` says to skip section 1 if a url index already exists.
It does. **Skip section 1.** The dedup probe in `backend/ingest.py` is already
index-served by `articles_url_key`.

Confirm before you skip:

```sql
-- Expect a row named articles_url_key with UNIQUE INDEX ... USING btree (url).
-- If this returns a row, SECTION 1 OF sql/0024 IS SKIPPED.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename  = 'articles'
   AND indexdef ILIKE '%(url%';
```

### 0024, step 0: read-only triage, run all of these first

```sql
-- 0a. Is 0023 applied? If this returns fewer than 2 rows, stop and do section 3
--     of this runbook first. 0023 is the bigger win.
SELECT indexname FROM pg_indexes
 WHERE tablename = 'articles'
   AND indexname IN ('idx_articles_top_stories', 'idx_articles_ingested_at');

-- 0b. Table sizes. These decide whether section 5 is worth it.
SELECT relname, n_live_tup,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
  FROM pg_stat_user_tables
 WHERE relname IN ('articles','content_embeddings','theses',
                   'morning_brief_calls','company_mentions')
 ORDER BY pg_total_relation_size(relid) DESC;

-- 0c. Who is actually scanning. Settles every "might seq-scan" guess.
SELECT relname, seq_scan, seq_tup_read, idx_scan,
       CASE WHEN seq_scan > 0 THEN seq_tup_read / seq_scan ELSE 0 END
         AS avg_rows_per_seq_scan
  FROM pg_stat_user_tables
 ORDER BY seq_tup_read DESC
 LIMIT 10;

-- 0e. Autovacuum health. If last_autovacuum is old and n_dead_tup is large, a
--     plain VACUUM on content_embeddings is cheaper than any index below.
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, last_vacuum
  FROM pg_stat_user_tables WHERE relname = 'content_embeddings';
```

(`0d` is the url check above. It is already answered: SKIP section 1.)

### 0024, step 1: apply, one statement at a time, off-peak

Every one is `CONCURRENTLY`, so none takes a write lock, but none can run inside
a transaction block either. Run each on its own, and not during a pipeline run:
an index build on `articles` takes minutes and eats the same IO budget you are
trying to protect.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_primary_company_trgm
  ON public.articles USING gin (primary_company gin_trgm_ops);
```

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_title_trgm
  ON public.articles USING gin (title gin_trgm_ops);
```

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_industry_verticals_gin
  ON public.articles USING gin (industry_verticals jsonb_path_ops);
```

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_articles_activity_types_gin
  ON public.articles USING gin (activity_types jsonb_path_ops);
```

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mbc_target_symbol
  ON public.morning_brief_calls (target_symbol);
```

Section 5 (`idx_theses_graded`) stays commented out unless step 0b showed
`theses` above roughly 50k rows.

### 0024, step 2: prove it worked

```sql
-- 2a. All builds are VALID. A CONCURRENTLY build that fails leaves an INVALID
--     index behind that costs writes and serves nothing. indisvalid must be t.
SELECT c.relname AS indexname, i.indisvalid, i.indisready,
       pg_size_pretty(pg_relation_size(c.oid)) AS size
  FROM pg_class c
  JOIN pg_index i ON i.indexrelid = c.oid
 WHERE c.relname IN ('idx_articles_primary_company_trgm',
                     'idx_articles_title_trgm',
                     'idx_articles_industry_verticals_gin',
                     'idx_articles_activity_types_gin',
                     'idx_mbc_target_symbol')
 ORDER BY c.relname;
```

```sql
-- 2b. Radar keyword follow.
--     BEFORE: Seq Scan on articles, large "Rows Removed by Filter".
--     AFTER:  Bitmap Index Scan on idx_articles_title_trgm and/or
--             idx_articles_primary_company_trgm, and a much smaller
--             "shared read" count in BUFFERS.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, source, summary, url, published_at,
       industry_verticals, activity_types, primary_company
  FROM public.articles
 WHERE (primary_company ILIKE '%Nvidia%' OR title ILIKE '%Nvidia%')
   AND published_at >= now() - interval '7 days'
 ORDER BY published_at DESC
 LIMIT 8;
```

```sql
-- 2c. Taxonomy follow.
--     BEFORE: Seq Scan. AFTER: Bitmap Index Scan on
--     idx_articles_industry_verticals_gin.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM public.articles
 WHERE industry_verticals @> '["Technology"]'::jsonb
   AND published_at >= now() - interval '7 days'
 ORDER BY published_at DESC
 LIMIT 12;
```

```sql
-- 2d. The ingest dedup probe. Expect an Index Scan on articles_url_key, NOT on
--     idx_articles_url, which is the whole reason section 1 is skipped.
--     Substitute two real urls from a recent run.
EXPLAIN (ANALYZE, BUFFERS)
SELECT url FROM public.articles
 WHERE url IN ('https://example.com/a','https://example.com/b')
   AND ingested_at >= now() - interval '30 days';
```

```sql
-- 2e. Over the following days, idx_scan should climb on each. Note
--     idx_articles_url is deliberately absent from this list.
SELECT indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
  FROM pg_stat_user_indexes
 WHERE indexrelname IN ('articles_url_key',
                        'idx_articles_title_trgm',
                        'idx_articles_primary_company_trgm',
                        'idx_articles_industry_verticals_gin',
                        'idx_articles_activity_types_gin',
                        'idx_mbc_target_symbol')
 ORDER BY idx_scan DESC;
```

---

## 5. `sql/v4b_price_alerts_notifications.sql`: KEEP. Already applied.

**Recommendation: neither delete nor apply. It is already applied in prod. Keep
it as the only committed schema record for two live tables.**

The premise that this file targets a nonexistent `price_alerts` table is wrong,
and the filename is what makes it look that way. The file is named
`v4b_price_alerts_notifications.sql`, but every DDL statement inside it is
correctly prefixed. Grepping for a bare `price_alerts` identifier returns nothing
that is not part of `watchlist_price_alerts`:

```
$ grep -nE '(^|[^_a-z])price_alerts' sql/v4b_price_alerts_notifications.sql
(no output)
```

The three objects it creates, checked SELECT-only against prod PostgREST on
2026-08-08:

```
price_alerts                        -> HTTP 404   (does not exist, and nothing references it)
watchlist_price_alerts              -> HTTP 200   content-range: 0-0/1     (exists, 1 row)
watchlist_notifications             -> HTTP 206   content-range: 0-0/122   (exists, 122 rows)
watchlist_articles.score_breakdown  -> HTTP 200   (column exists)
```

That last one is the file's trailing
`ALTER TABLE watchlist_articles ADD COLUMN IF NOT EXISTS score_breakdown text;`.
It is present too, so the file is applied in full.

### Reasoning from the code that actually reads the table

`backend/watchlist_sync.py` is the only backend reader and writer:

- line 542, `check_price_alerts` reads `supabase_client.table("watchlist_price_alerts")`
- line 617 writes back to the same table
- line 708 calls `check_price_alerts` from the sync loop

The frontend agrees. `src/app/api/watchlist-alerts/route.ts` hits
`from("watchlist_price_alerts")` at lines 18, 61, 97 and 122. Nothing anywhere in
`backend/` or `src/` references a bare `price_alerts` table.

So the code, the file, and prod all name the same table, and prod has it.

### Why not delete

`sql/v4b_price_alerts_notifications.sql` is the ONLY file in `sql/` or
`supabase/` that mentions these tables at all:

```
$ grep -rln "price_alerts" sql/ supabase/
sql/v4b_price_alerts_notifications.sql
```

Deleting it destroys the only recorded DDL, RLS policies and CHECK constraints
for two tables that are live and carrying rows, and that a cron-driven pipeline
writes to. That is a real regression in recoverability for zero benefit.

### Why not re-apply

Every statement is `IF NOT EXISTS` or wrapped in a
`DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block, and all four
objects already exist. Running it is a verified no-op, so there is nothing to
gain and a nonzero chance of a hand-paste mistake against prod.

### The one thing worth changing later, and it is not urgent

The filename says `price_alerts` while the DDL says `watchlist_price_alerts`.
That mismatch is what generated this whole investigation. A rename to
`v4b_watchlist_price_alerts_notifications.sql` would kill the ambiguity, but it
is cosmetic and renaming an applied migration file has its own confusion cost.
Left alone deliberately; this runbook is the record instead.

---

## 6. Backend test quarantine: all 13 still red, none may leave

Re-run against `origin/main` at `ef665172` on 2026-08-08, Python 3.11 via
`.venv`. Command:

```
python -m pytest -p no:cacheprovider -q --no-header -rA <the 13 node ids>
```

Result: `13 failed, 14 warnings in 1.36s`. **Zero of the 13 now pass.**
`backend/tests/known_failures.txt` is therefore unchanged by this PR.

| # | Test | Result | Assertion |
|---|------|--------|-----------|
| 1 | `test_ingest.py::FilterRetryTest::test_both_calls_none_drops` | still red | `TypeError: ...<lambda>() got an unexpected keyword argument 'cache_name'` |
| 2 | `test_ingest.py::FilterRetryTest::test_first_call_success_no_retry` | still red | `TypeError: ..._fa() got an unexpected keyword argument 'cache_name'` |
| 3 | `test_ingest.py::FilterRetryTest::test_retry_after_first_none` | still red | `TypeError: ...<lambda>() got an unexpected keyword argument 'cache_name'` |
| 4 | `test_ingest.py::FilterArticlesOrchestrationTest::test_results_index_aligned_with_none_for_drops` | still red | `AssertionError: Lists differ: [None, None, None] != [{'t': 'a'}, None, {'t': 'c'}]` |
| 5 | `test_ingest.py::FilterArticlesOrchestrationTest::test_single_article_kept` | still red | `AssertionError: Lists differ: [None] != [{'ok': True}]` |
| 6 | `test_market_tape.py::SerializeTapeSnapshotTests::test_missing_dow_serializes_to_null_subfields` | still red | `AssertionError: {'pct': None, 'level': None, 'open': None} != {'pct': None, 'level': None}` |
| 7 | `test_market_tape.py::SerializeTapeSnapshotTests::test_missing_symbol_serializes_null_subfields` | still red | `AssertionError: {'pct': None, 'level': None, 'open': None} != {'pct': None, 'level': None}` |
| 8 | `test_market_tape.py::SerializeTapeSnapshotTests::test_serializes_expected_shape` | still red | `AssertionError: {'pct': 1.33, 'level': 7600.0, 'open': None} != {'pct': 1.33, 'level': 7600.0}` |
| 9 | `test_lead_overview_offline.py::Assertion1_LeadIsFreshNotStaleDebut::test_winner_is_fresh_event_not_stale_debut` | still red | `AssertionError: 'co:qualcomm:ma' != 'co:spacex:stock' : the lead must be the fresh selloff event, not the stale debut` |
| 10 | `test_lead_overview_offline.py::Assertion8_HarnessHonestyMetaCheck::test_real_fixture_winner_satisfies_predicate` | still red | `AssertionError: False is not true : the committed fixture must satisfy the honesty predicate` |
| 11 | `test_run_degraded.py::RunDegradedTest::test_benign_addendum_nothing_to_improve_stays_green` | still red | `AssertionError: 1 != 0` (exit code; `httpx.ConnectError: [Errno 61] Connection refused` upstream) |
| 12 | `test_run_degraded.py::RunDegradedTest::test_benign_no_brief_scoring_skip_stays_green` | still red | `AssertionError: 1 != 0` (same) |
| 13 | `test_run_degraded.py::RunDegradedTest::test_happy_path_exit_zero` | still red | `AssertionError: 1 != 0` (same) |

### Reading of the three groups

**Tests 1 to 5, the `cache_name` group.** The hypothesis that these were stale
doubles predating a signature change is CORRECT, and the fix is still not done.
1 to 3 raise the `TypeError` directly. 4 and 5 are the downstream cascade: the
orchestrator swallows the `TypeError` per article and returns `None` for each, so
the lists come back all-`None`. `known_failures.txt` already describes this
exactly. Fix is a one-line signature change in each test double to accept
`cache_name=None`, but the brief forbids modifying the tests, so this stays
quarantined. **Cheapest debt to clear. Do it in a dedicated follow-up.**

**Tests 6 to 8, the `regularMarketOpen` group.** Production now emits a third
subfield `'open'` in the serialized tape snapshot; the doubles assert the old
two-key shape. #485's work is present in production and absent from the test
expectations. Same story as above: a fixture update, not a code bug. **Second
cheapest.**

**Test 9 and 10, the lead-overview fixture.** Unchanged and still the highest
risk of the three. The offline harness now selects `co:qualcomm:ma` where the
committed fixture expects `co:spacex:stock`, and test 10 confirms the committed
fixture no longer satisfies the harness's own honesty predicate. That is the
signature of a real behavior change in the selector, not just a stale fixture.
**Needs an owner decision before anything is touched. Do not "fix" by editing the
fixture until someone confirms which side is wrong.**

**Tests 11 to 13, the credentialed group.** These are correctly quarantined
forever, not temporarily. They execute the pipeline entrypoint's `__main__` and
assert exit 0. Locally they now fail one layer earlier than
`known_failures.txt` documents: `backend/grading/macro_lead_writer.py:51` raises
`httpx.ConnectError: [Errno 61] Connection refused` before the STORY RAIL step is
reached. Either way the run is reported degraded and exits 1. Making these green
in CI requires a real service-role key in GitHub Actions, which is strictly worse
than leaving them out. **Recommendation: promote these three from "quarantined
debt" to a permanently excluded, separately labeled tier, so the debt list stops
implying they will ever be fixed.**

### Verdict

**Zero tests may leave quarantine. `known_failures.txt` stays at 13 lines.**
