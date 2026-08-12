# Dashboard `stories` group takes 13.6s

**Status:** observation only. NOT fixed in the reveal-gate PR. **Next PR, ahead of the request-duplication work** (`DASHBOARD_REQUEST_DUPLICATION.md`).
**Measured:** 2026-08-12, `/dashboard`, Chrome, dev server, signed in, warm route (third consecutive reload).
**Method:** per-source settle timestamps recorded by the reveal gate's dev-only `window.__dashboardGate.settleTimes()`.

## The measurement

Every dashboard source's settle time from navigation start:

```
  2017ms  market-cards
  7197ms  watchlist
  7366ms  daily-briefs
  7630ms  system-intelligence
  7675ms  watchlist-feed
  7676ms  fresh-radar
  8089ms  desk-record
  8136ms  your-calls
  8798ms  following
 13570ms  stories          <-- 4.8s behind the next slowest
```

**`stories` is the only source past the 10s reveal budget.** Every `/api/` route finished by 8.8s. The reveal therefore lands on `timeout` rather than `all-settled` on every load on this hardware, with the stories section filling in ~3.6s after the rest of the page appears.

## What `stories` actually is

It is not one query. `DashboardPageInner`'s main effect (`src/app/dashboard/page.tsx`) declares four independent async functions and the gate settles when all four have finished:

| function | reads | via |
|---|---|---|
| `loadCounts` | `articles` — three `count` queries (today total, bullish, bearish) | Supabase direct |
| `loadSpark` | `articles` | Supabase direct |
| `loadBriefing` | `briefings` | Supabase direct |
| `loadStories` | `articles`, then `source_credibility` for the matched sources | Supabase direct |

They run in parallel via `Promise.allSettled([...]).finally(() => settleStories())`, so 13.6s is the **slowest of the four**, not their sum. Which one dominates is not yet isolated.

**None of these go through `/api/`.** They are browser-to-Supabase calls, which is why they do not appear in the `/api/` network timing table in `DASHBOARD_REQUEST_DUPLICATION.md`.

## Likely contributing factor

`articles` is ~169,000 rows and the instance has been under sustained disk-IO pressure throughout this work — plain `count(*)` and unindexed-column scans on `articles` returned `57014` statement timeouts repeatedly on the same day this was measured. `loadCounts` issues three `count` queries against that table. That is a plausible dominant cost but has **not** been confirmed.

## Caveats

- **Dev server.** Route compilation is excluded here (warm reload, third consecutive), but the browser-to-Supabase latency is real and unrelated to Turbopack.
- **Production is unmeasured.** Do not tighten `DASHBOARD_REVEAL_TIMEOUT_MS` off this number.
- The n=2 request pattern elsewhere suggests React StrictMode double-invocation in dev; if these four effects also double-run, the real cost could be roughly half.

## What would isolate it

1. Instrument each of the four functions separately (same `settleTimes` trick, four ids instead of one) to find which dominates.
2. `EXPLAIN ANALYZE` the three `loadCounts` count queries against `articles` — check whether they are index-served or scanning.
3. Re-measure against a production build to remove StrictMode doubling.
4. Compare against `sql/0023` / `sql/0024` index status; `idx_articles_top_stories` is HAND-APPLY and its application has never been confirmed in this repo.

## Related

- The reveal gate ships at a 10s budget with this behaviour known and accepted; see the PR description.
- `scratch/DASHBOARD_REQUEST_DUPLICATION.md` — separate issue, 46 `/api/` requests per load.
- `scratch/INGEST_RECON.md` — the `articles` table profile and the disk-IO history.

---

## RESOLVED (measured 2026-08-12, same method, same hardware)

Root cause was NOT evenly spread across the four functions.

| function | before | finding |
|---|---|---|
| `loadCounts` | 3,410ms x3 | **HTTP 500 `57014`** every time. Three `count: "exact"` queries on a ~169k-row `articles` table, sequentially scanning. Identical timing at 1h/6h/24h/72h windows proves the scan is insensitive to selectivity. It had **never once returned data**; the silent catch defaulted the stat band to 0. |
| `loadSpark` | 633ms | 200, but **1,000 rows of ~31,000** (`content-range: 0-999/*`). PostgREST's default cap. The sparkline was silently wrong. |
| `loadBriefing` | 581ms | innocent |
| `loadStories` | 555ms | innocent |

**Fixes, code only, no migration:**
- `count: "exact"` -> `count: "planned"` (planner estimate, 1,050ms, returns). A failed count now sets `countsFailed` and the tile renders "no count" rather than a fabricated 0.
- `loadSpark` reads `pipeline_runs.ingest_count` instead of scanning `articles`. Server-side aggregate already maintained by the pipeline; 468ms, 201 rows over 12 days.

**Result:** `stories` 13,570ms -> 4,839ms. Whole-page reveal now lands on `all-settled`, not `timeout`. The stat band shows a real number (285) for the first time.

**Still open:** the count is now a planner ESTIMATE, not exact. `idx_articles_ingested_at` (sql/0023, HAND-APPLY) is unconfirmed; an exact count stays out of reach until it exists.

---

## AMENDED 2026-08-12 (later the same day): the index landed, `planned` was wrong

`idx_articles_ingested_at` was confirmed MISSING and has now been created by hand.
Re-measured `count: exact` on the identical predicate, 5 reps each:

| query | before index | after index | exact value | planned value |
|---|---|---|---|---|
| total | 3,410ms, HTTP 500 `57014` | **300ms, HTTP 206** | **1,279** | 285 |
| bullish | 3,538ms, HTTP 500 | **301ms, HTTP 200** | **284** | **1** |
| bearish | 3,683ms, HTTP 500 | **329ms, HTTP 200** | **118** | **1** |

Two conclusions, the second more important than the first.

1. `count: exact` is now ~300ms, an 11x improvement, and it returns.
2. **`count: planned` was badly wrong, not slightly wrong.** The planner cannot
   estimate the selectivity of a leading-wildcard `ILIKE`, so it guessed **1** for
   both bullish and bearish. The total was off by 4.5x (285 vs 1,279). The
   "285 high-signal stories" figure reported when the planned-count fix shipped
   was itself a wrong number -- differently wrong from the old silent zero, but
   still not the truth.

Switched all three counts to `count: "exact"`. Verified in the browser: the
headline reads **1,279**. Reveal still lands on `all-settled`.

## What `pipeline_runs.ingest_count` actually counts (asked, answered)

`stored = len(article_ids)` in `backend/ingest.py`, returned by `run_ingest()` and
written by `observe.record_run()`. Counted **after** the relevance gate
(`relevance_score >= ingest_gate`) and **after** dedup. It is:

- NOT articles fetched
- NOT articles that passed the filter but deduped away
- NOT articles selected for the brief (that is `selected_count`, a separate column)

It is new `articles` rows inserted, per run, and the pipeline runs twice daily
(`morning`, `evening`), bucketed here by `started_at`.

**It matches the tile's label.** The card is "Signals Today"; its value is an exact
count of `articles` by `ingested_at >= today`, and the sparkline sums
`ingest_count` per day. Same quantity, two sources. Verified per-day over 12 days:

```
day          sum(ingest_count)   exact articles   delta
2026-08-01              1464             1464         0
2026-08-02                 0                0         0
2026-08-03                 0              534      +534   <-- the one gap
2026-08-04              3635             3635         0
2026-08-05              2643             2643         0
2026-08-06              2829             2829         0
2026-08-07              2977             2977         0
2026-08-08              1346             1346         0
2026-08-09                 0                0         0
2026-08-10              2749             2749         0
2026-08-11              2670             2670         0
2026-08-12              1279             1279         0
TOTAL                  21592            22126      +534
```

**11 of 12 days agree to the row.**

### The one gap, and its cause

`observe.record_run()` fires at the END of all 16 pipeline steps (`run.py:234`),
while ingest is step 1 (`run.py:136`). A run that stores articles and then dies
before finishing writes no row at all, so its ingest_count is lost entirely.
2026-08-03 is that case: 534 articles really landed, no run row carries a count,
and the sparkline plots **0** for that day. 534 / 22,126 = 2.4% of the window,
concentrated as one entirely-wrong bar rather than spread thin.

Note `_run_ingest_guarded` returns 0 on ingest failure, but no run in the window
recorded 0, so this is the crash-before-record path, not the guarded-failure path.

**Fix (backend, NOT done here):** record the ingest count when ingest finishes
rather than when the pipeline does.

### Not a gap

`edgar_ingestion` (144 runs), `daily_grading` (12), `outcome_evaluator` (11) and
`xbrl_facts_ingestion` (10) carry a null `ingest_count` and are filtered out.
That is correct: none of them insert into `articles`. `ingest_sec.py` writes
`selected_count` and touches `sec_filings`, not `articles`.

### Residual risk

Buckets key on the run's `started_at`, not on each article's `ingested_at`. A run
crossing midnight would attribute its articles to the day it started. No such
split appears in this window (all deltas are 0), so the risk is theoretical.
