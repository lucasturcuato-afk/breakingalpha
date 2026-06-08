# Top Stories Recency: Phase 2 Verification (Self-Critique #2)

Branch: `fix/top-stories-recency`. Companion docs: `top-stories-recency.md`, `top-stories-plan.md`.

---

## 1. Diff re-read line by line vs the revised plan

The diff is one file, `src/app/dashboard/page.tsx` (+45 / -3):

- Named constants added next to `SPARK_DAYS` (plan step 1): `TOP_STORIES_INGESTED_WINDOW_HOURS = 24`, `TOP_STORIES_PUBLISHED_WINDOW_HOURS = 48`, `TOP_STORIES_FALLBACK_WINDOW_HOURS = 168`, `TOP_STORIES_MIN_RESULTS = 3`. Matches the Tunables table exactly.
- Primary query (plan step 2): adds `.gte("ingested_at", hoursAgo(24)).gte("published_at", hoursAgo(48))` and keeps the existing `.order("relevance_score", desc).order("ingested_at", desc).limit(4)` verbatim. The composite sort precedent is preserved, as the plan required.
- Fallback (plan step 2): when `primary.length < TOP_STORIES_MIN_RESULTS`, runs one widened query with both columns at `hoursAgo(168)`, same ordering and limit, and assigns its rows to `data`. Bounded at 7 days, never unbounded.
- One explanatory comment on the dual-column filter (plan step 3).
- Downstream `if (data) { ... data.map(...) }` consumer is untouched; `data` changed from `const` to `let` so the fallback can reassign it.

Drift noted (all benign, all in the direction of less duplication, none changing behavior):
- The plan described three separate cutoff variables; the implementation uses one `hoursAgo(h)` helper that returns the same `new Date(Date.now() - h * 3600 * 1000).toISOString()` UTC ISO string the plan specified. Identical values, less repetition.
- Added a `STORY_COLUMNS` string constant so the primary and fallback queries cannot drift apart on their select list. Not in the plan, but a small DRY safeguard consistent with "minimal and surgical."
- Added `fallbackError` logging mirroring the primary query's existing error log. Defensive, no behavior change on the happy path.

No structural drift. The implementation is the revised plan.

## 2. No Lucas-protected file touched

`git diff --name-only origin/main`:

```
src/app/dashboard/page.tsx
```

(plus the untracked `docs/recon/` documents and screenshots). Checked against the protected list and none appear: NOT MemoModal.tsx, NOT watchlist-utils.ts, NOT WatchlistAddInput.tsx, NOT trends/page.tsx, NOT briefing/route.ts, NOT /api/memo/route.ts. A grep of the changed-file list for those names returns nothing.

## 3. Build, typecheck, lint

- Build: `npm run build` -> `BUILD_EXIT=0`. Next.js 16.2.2 (Turbopack) optimized production build completed; `/dashboard` compiled as a static route. (Worktree note: a clean `npm ci` was run inside the worktree because Turbopack rejects a cross-tree `node_modules` symlink. The change itself is plain TypeScript plus a Supabase query builder call, so no Next.js 16 API surface is involved.)
- Typecheck: `npx tsc --noEmit` reports 5 errors, ALL pre-existing and ALL in unrelated files (`src/components/tour/SignaleraTour.tsx` missing `driver.js` types, and four `tests/unit/*.ts` import-extension errors). Proven pre-existing by running `tsc` against the pristine `origin/main` version of the same tree, which produces the identical 5 errors. Zero errors reference `dashboard/page.tsx`; my file is type-clean.
- Lint: `npx eslint src/app/dashboard/page.tsx` -> `0 errors, 1 warning`. The single warning is a pre-existing `react-hooks/exhaustive-deps` note at line 450 (`watchlistTickers` / `useMemo`), unrelated to and untouched by this change.

## 4. Visual smoke + how recency was verified

Method: a temporary Playwright spec (not committed) signed in with the E2E test account against the LOCAL dev server built from this branch (`E2E_BASE_URL=http://localhost:3000`, so the local build is exercised, not production), loaded `/dashboard`, and inspected the rendered Top Stories module.

How recency was verified: each story card renders `timeAgo(published_at || ingested_at)`, so the visible "Xd ago" strings ARE the recency of the items shown. The spec scraped every timestamp in the Top Stories section and asserted the maximum day-granularity age was within the 7-day window.

Observed:

```
RENDERED_TOP_STORIES_TIMESTAMPS=["2d ago","2d ago","2d ago","2d ago"]
MAX_AGE_DAYS_RENDERED=2
2 passed (15.1s)
```

The module showed 4 stories (WULF/RIOT/HUT, UnitedHealth, Xos, ResMed), every one stamped "2d ago", non-empty, with no "Application error". Screenshots: `docs/recon/top-stories-smoke.png` (full page) and `docs/recon/top-stories-section.png` (the module). A pre-existing `InfoTooltip` hydration warning prints in dev mode; it exists unchanged on `origin/main` (3 references, identical), is unrelated to the query change, and did not block rendering.

Direct before/after at the data layer (anon-key query against the live project, same `articles` table the page reads):

```
OLD query (no window), top 4:
  score=10  published  94.9d ago   | Seaport Entertainment Q4 2025 transcript
  score=10  published   2.4d ago   | Saputo Q1 2026 earnings
  score=10  published   2.4d ago   | ResMed acquires Noctrix Health
  score=10  published 173.9d ago   | Truist $10B buyback
NEW primary (24h / 48h):  0 rows  (ingest last ran ~2.1d ago)
FALLBACK (7d / 7d):
  score=10  published   2.3d ago   | UnitedHealth dividend
  score=10  published   2.4d ago   | Xos $100M shelf
  score=10  published   2.2d ago   | WULF/RIOT/HUT
  score=10  published   2.4d ago   | ResMed acquires Noctrix Health

SUMMARY  OLD oldest: 173.9 days   FALLBACK oldest: 2.4 days
```

This is the bug and the fix in one frame: the old query put a 173.9-day and a 94.9-day article in the top 4; the fix excludes them and fills the module with items published within ~2.4 days.

## 5. Edge case: the window empties the module

Construction: I forced the primary window to (near) zero by querying with a 0.001h window on both columns. It returned 0 rows, which is below `TOP_STORIES_MIN_RESULTS = 3`, so the fallback path triggers.

Result: the 7-day fallback returned 4 recent stories (shown above), so an empty primary window does NOT empty the module; it widens to one week and fills.

Stronger evidence: this edge case is the CURRENT live reality. Because the ingest pipeline last ran ~2.1 days ago, the real 24h primary window is genuinely empty right now, so the passing visual smoke above was served entirely by the fallback path. The fallback is not just unit-exercised, it is the live-exercised path, and it produced 4 recent stories.

Terminal sub-case (both windows empty, e.g., pipeline fully down): trace through the code: `primary = []` -> fallback runs -> if fallback is also `[]`, `data = []` -> `if (data)` is truthy on an empty array -> `setStories([])` -> the EXISTING `displayStories.length === 0` branch renders the `EmptyState` "No stories yet" card. No crash, no blank, no unbounded query. If the fallback query itself errors, `data` stays `[]` and the same EmptyState renders. Graceful in every branch.

### Tuning callout for review (raised by the live result)

The headline tunable is the primary `24h` ingested window. The live run showed the pipeline can be quiet for ~2 days, which keeps the 24h primary empty and leans on the 7-day fallback. That is acceptable (the fallback still guarantees nothing older than 7 days, which fully resolves "hundreds of days old"), but if you want the primary window to catch typical batches directly instead of always deferring to the fallback, raise `TOP_STORIES_INGESTED_WINDOW_HOURS` to 48 or 72. The 7-day fallback bound is the real anti-stale guarantee and can stay as is.

## Verdict

Root cause fixed, diff minimal and contained to one non-protected file, build green, typecheck and lint clean of new issues, dashboard renders recent (max 2 days) non-empty Top Stories, and the empty-window edge case degrades to the existing EmptyState through a bounded fallback that is already the live-serving path. Ready for draft PR.
