# Watchlist-driven Finnhub Ingestion — v1 Summary

## What this changes (concrete file list + line counts)

- `backend/ingest.py` — **+127 / -0** (single-file change)
  - New helper `fetch_watchlist_finnhub_articles()` (~115 lines, including a long docstring) added immediately above the existing `fetch_all_articles`.
  - One integration point inside `fetch_all_articles`: a `try/except` block that calls the new helper and `articles.extend(...)` the result. Placed AFTER the NewsAPI block, BEFORE the existing URL-dedupe loop, so the new articles flow through the same dedupe + downstream `store_article` path as everything else.
  - No imports added (reuses `os`, `requests`, `time`, `datetime`, `timedelta`, `timezone`, the module-level `supabase` client, and the existing `strip_html` helper).
  - No existing function signatures changed. No code reordered or renamed.

## What it does NOT change

- `RSS_FEEDS` dict — untouched.
- NewsAPI block in `fetch_all_articles` — untouched.
- `filter_article` / `filter_articles_batch` (Gemini calls) — untouched.
- `store_article`, `upsert_company`, `_normalize_title` — untouched.
- `boost_watchlist_relevance` in `backend/watchlist.py` — untouched.
- `backend/watchlist_sync.py` and the entire `watchlist_articles` write path — untouched. New articles go through the existing `articles` table only, NOT `watchlist_articles`.
- `companies` table writes — still go through the same name-based `upsert_company` (the diagnosis's root cause #2/#3 is OUT OF SCOPE here; that's a separate fix).
- `backend/run.py` — untouched. The new path is invoked transitively through the existing `run_ingestion → fetch_all_articles` call site.

## Key decisions

1. **Single integration point inside `fetch_all_articles`.** The spec required this. The new helper is called like `articles.extend(fetch_watchlist_finnhub_articles())` and its output joins the same in-memory list that the URL-dedupe loop walks. Rationale: any downstream change (Gemini batch, store_article, full-text enrichment, watchlist boost) automatically applies to watchlist-sourced articles with zero additional wiring.

2. **Dedupe candidates against `articles.url` for the last 30 days BEFORE returning.** Two reasons: (a) accuracy of the structured log line's "duplicates" count, and (b) saves Gemini tokens on already-stored URLs. `store_article` ALSO has its own per-URL existence check, so this is belt-and-suspenders — the system is correct even if the preload fails (we log and continue without it).

3. **`type='ticker'` only.** Spec said tickers. `watchlist_sync.run_sync` runs ALL non-sector entries through Finnhub by symbol, but Finnhub's company-news endpoint only resolves ticker symbols cleanly. Companies / non-ticker entries are deferred — the existing `watchlist_sync` path still handles them via Exa + GDELT into `watchlist_articles`.

4. **7-day Finnhub window, cap 8 per ticker.** Both directly from spec. Note: `watchlist_sync.fetch_finnhub_articles` uses a 30-day window with cap 20 — different parameters because that path feeds the per-ticker cache, while this path feeds the global brief and a tighter window keeps the brief market-fresh.

5. **`time.sleep(1.0)` between tickers.** Mirrors the pacing in `watchlist_sync.fetch_finnhub_articles` to stay under Finnhub's free-tier rate limit (60 calls/minute). N tickers × 1s ≈ N seconds added to ingest cron wall time. With ~10 watchlist tickers today that's ~10s. If watchlist grows to 100 tickers we'd revisit.

6. **Reuses module-level `supabase` and `strip_html` rather than re-creating clients.** Same pattern as the rest of `ingest.py`. The Finnhub key is read fresh from `os.environ` inside the helper (graceful skip if unset).

7. **Structured log line at function tail.** Format exactly as spec: `watchlist-finnhub: N tickers, M articles fetched, K inserted, J duplicates`. K is candidates passed back to the caller (post-DB-dedup); the final number actually inserted into `articles` is determined by Gemini relevance gate + `store_article`'s own URL/title dedupe, which is logged separately by the existing pipeline. We chose K = "what we hand back" rather than K = "what eventually lands in DB" because the helper returns before downstream filtering runs.

## Known unknowns

- **Empty `FINNHUB_API_KEY`.** The helper checks and logs `watchlist-finnhub: FINNHUB_API_KEY not set, skipping` then returns []. Verify this env var IS present in the production cron environment. `watchlist_sync.py` already reads it, so it should be set, but worth confirming.
- **Schema assumption: `articles.ingested_at` exists and is indexed.** The 30-day dedupe preload uses `.gte("ingested_at", cutoff)`. From the diagnosis doc and existing ingest code, this column is referenced in `store_article`'s title-dedup logic (line 522 of pre-edit file), so it exists — but performance under a large `articles` row count is worth eyeballing in pg_stat_statements.
- **Watchlist read with `.eq("type", "ticker")`.** The diagnosis confirms the watchlist `type` column has values like `ticker`, `company`, `sector`. We filter to `ticker` only. If the schema later renames or replaces that enum, this query becomes silently empty.
- **Finnhub returns articles whose `url` is empty or duplicated within a single response.** Helper handles both: empty url is skipped; in-batch URL dedupe via `out_urls` set.
- **No test was written.** Per repo memory, there are no tests in this repo and TDD is skipped.

## Needs verification (Wednesday morning) — exact commands Noah should run

These are NOT "I tested it" — they are the verification steps to run before merging.

```bash
# 1. Sanity import (worktree-relative; needs env vars to instantiate clients):
cd /tmp/wt-watchlist-ingest/backend
SUPABASE_URL=$SUPABASE_URL SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY \
GEMINI_API_KEY=$GEMINI_API_KEY NEWS_API_KEY=$NEWS_API_KEY \
python3.11 -c 'import ingest; print("ok"); print(hasattr(ingest, "fetch_watchlist_finnhub_articles"))'
# Expect: imported ok / True

# 2. Dry-run the helper in isolation against real Supabase + Finnhub.
#    Reads watchlist + articles, hits Finnhub. Does NOT write anything.
cd /tmp/wt-watchlist-ingest/backend
python3.11 -c '
import os
from dotenv import load_dotenv
load_dotenv()
import ingest
out = ingest.fetch_watchlist_finnhub_articles()
print(f"returned {len(out)} candidate articles")
for a in out[:5]:
    print(" -", a["source"], "|", a["title"][:80], "|", a["url"])
'
# Expect: structured log line printed, then a sample of titles. None inserted.

# 3. Optional — run the full ingestion locally with the new path:
cd /tmp/wt-watchlist-ingest/backend
python3.11 ingest.py
# Watch for the "watchlist-finnhub:" log line in step [1/4].
# Confirm articles tagged source=<finnhub source name> appear in the relevance log.

# 4. After PR merges to main, on Wednesday's first cron run, grep the cron log:
#    Expect a line of the form:
#      watchlist-finnhub: 12 tickers, 47 articles fetched, 31 inserted, 16 duplicates
#    Then verify in Supabase: SELECT count(*) FROM articles
#      WHERE ingested_at > NOW() - INTERVAL '24 hours'
#      AND primary_company IN (SELECT DISTINCT identifier FROM watchlist WHERE type='ticker');
#    Should be > 0.
```

## Rollback — exact commands

```bash
# Option A — revert the merge commit (preferred once merged):
git revert -m 1 <merge-commit-sha>
git push origin main

# Option B — surgical revert of the integration point only, keeping the helper
# defined but never invoked (lowest-risk hotfix; preserves the helper for
# future re-enable):
# Remove this block from fetch_all_articles in backend/ingest.py:
#     try:
#         articles.extend(fetch_watchlist_finnhub_articles())
#     except Exception as ex:
#         print(f"  watchlist-finnhub error: {ex}")

# Option C — kill switch via env var (not implemented; would need a follow-up
# PR adding `if os.environ.get("WATCHLIST_FINNHUB_DISABLED"): return []`).
```

## Lucas overlap check

`/tmp/lucas-recent.txt` contents:
```
src/components/onboarding/OnboardingWizard.tsx
src/components/thesis/thesis-detail-panel.tsx
```

Confirmed no overlap: this PR only modifies `backend/ingest.py`. Lucas's recent edits are TypeScript frontend files (onboarding wizard, thesis detail panel). Independent surface areas, zero collision risk on merge.
