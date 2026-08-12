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
