# Top Stories Recency: Reconcile (windows coherence + preview fast-follow)

Branch: `fix/top-stories-recency` (continues PR #341). Companion docs: `top-stories-recency.md`, `top-stories-plan.md`, `top-stories-verification.md`.

This addresses three review defects on the in-flight fix:
1. The 24h primary `ingested_at` window is tighter than real ingest cadence, so the primary path is effectively dead and the system runs on the 7-day fallback by default.
2. The query fallback ceiling (7 days) and the implied render recency are incoherent: a query window that returns rows the renderer would not treat as "recent."
3. The "today" tooltip is inaccurate while the fallback serves multi-day-old content.

Plus a second-surface fast-follow: `preview/page.tsx` carries the identical unfiltered query.

---

## PHASE 1 — TARGETED RECON

### 1. Measured ingest cadence (source of truth)

Read-only SELECT against the live `articles` table, gaps between successive ingest batches (collapsing within-batch article spacing by counting only gaps > 5 minutes as batch boundaries), last 30 days:

```
articles_30d            38235
batch_boundaries           44
p50_gap_h               12.30
p95_gap_h               56.64   (~2.36 days)
max_gap_h               68.44   (~2.85 days)
latest_ingest           2026-06-08 13:09 UTC
hours_since_latest      9.37
```

Cross-check against the scheduled cadence in the repo: the active `.github/workflows/schedule.yml` is `workflow_dispatch` only (no `schedule:` trigger), but `.github/workflows/schedule.yml.bak` carries the real cron pair: morning `0 14 * * 1-5` (Mon to Fri) and evening `0 6 * * 2-6` (Tue to Sat). That is twice daily on weekdays with a weekend hole: the last Saturday-morning run (06:00 UTC Sat) to the next Monday-morning run (14:00 UTC Mon) is about 56 hours, which is exactly the measured p95 of 56.64h. The p50 of 12.3h is the normal intraday morning-to-evening spacing. Measurement and schedule agree.

Implication for defect 1: a 24h `ingested_at` primary window is empty across every weekend gap and any weekday gap over 24h. With p50 already 12.3h and p95 56.6h, the 24h window misses the most recent batch a large fraction of the time, so the fallback was carrying normal traffic. The primary window must be at least the p95 gap (56.6h) and ideally above the observed max (68.4h) so the primary path engages on a normal day. Chosen: 72h (3 days), which clears the max observed gap with about 4 hours of headroom.

### 2. Inventory of every recency value in the Top Stories path

Current state on this branch (commit 142d0b8e), all in `src/app/dashboard/page.tsx`:

- `TOP_STORIES_INGESTED_WINDOW_HOURS = 24` (line ~80) consumed in the primary query `.gte("ingested_at", ...)` (line ~248).
- `TOP_STORIES_PUBLISHED_WINDOW_HOURS = 48` (line ~81) consumed in the primary `.gte("published_at", ...)` (line ~249).
- `TOP_STORIES_FALLBACK_WINDOW_HOURS = 168` (line ~84) consumed in the fallback `.gte` on both columns (lines ~267 to 268).
- `TOP_STORIES_MIN_RESULTS = 3` (line ~86) gates the fallback (line ~263).
- `.limit(4)` literal in both queries.

Is there a render cap (the `MAX_AGE_DAYS_RENDERED` referenced in review)? No. There is NO render-side age cap anywhere in the Top Stories path. `MAX_AGE_DAYS_RENDERED=2` from the prior verification was a value MEASURED by the temporary smoke test (the max age it observed in the rendered cards), not a constant in the code. Tracing the render path:
- `displayStories = storyTab === "for-you" ? forYouStories : stories` (dashboard line ~407).
- `forYouStories = sortByRelevance(stories, profile, storyToContent)` (line ~446). `sortByRelevance` (`src/lib/personalization.ts:104`) is a pure `[...items].sort(...)` with NO filter; it drops nothing.
- Render iterates `displayStories[0]` plus `displayStories.slice(1)` (lines ~713, ~718). Empty only when `displayStories.length === 0`, which shows the existing `EmptyState`.

So the renderer displays exactly what the query returns (capped at the query's own `.limit(4)`); it never silently drops rows by age. Defect 2 as literally stated (a render cap below the query window) does not exist in code. The genuine, still-valid problem is that there are TWO independent recency knobs (a 24h/48h primary and a 7-day fallback) and no single declared ceiling, so "the oldest a story can be shown" is an emergent 7 days that nothing names and the tooltip contradicts. The reconciled design below collapses this to one named ceiling and proves coherence by construction (Self-Critique #1, point A).

Consumers of these values: only the dashboard query. They are module-private to `dashboard/page.tsx`; nothing imports them. So resizing or relocating them has zero blast radius outside the Top Stories fetch. (`preview/page.tsx` has the bug but does NOT reference these constants; it has no recency values at all. See item 3.)

### 3. preview/page.tsx recon

- Same query: yes, byte-for-byte the same unfiltered query as the pre-fix dashboard. `src/app/preview/page.tsx` lines 67 to 72:
  ```tsx
  const { data, error } = await supabase
    .from("articles")
    .select("id, title, source, summary, content, sector, industry_verticals, activity_types, sentiment, published_at, ingested_at, url, companies, relevance_score")
    .order("relevance_score", { ascending: false })
    .order("ingested_at", { ascending: false })
    .limit(4);
  ```
  No `.gte` window. Same render structure (lines 198 to 213): `stories.length === 0` shows `EmptyState`, otherwise `LeadStoryCard` + `slice(1)`. Same lack of any render-side age cap. Its own local `timeAgo` (lines 29 to 36).
- Protected? No. `preview/page.tsx` is not on the protected list (MemoModal.tsx, watchlist-utils.ts, WatchlistAddInput.tsx, trends/page.tsx, briefing/route.ts, /api/memo/route.ts).
- What surface is it? A PUBLIC, LOGGED-OUT surface. `src/proxy.ts` line 29 lists `path === '/preview'` in `isPublicPath`, so an unauthenticated visitor reaches `/preview` with no redirect. The page renders a "Personalize your feed" nudge and a "Sign in free" CTA with a `SignInModal` (lines 216 to 238) and wraps everything in `PreviewContext`/`isPreview`. This is the prospect / demo landing experience, exactly the kind a USC Marshall faculty demo or an inbound prospect would see. A logged-out visitor seeing a 174-day-old article as a "Top Story" is a direct credibility defect on the highest-trust-cost surface we have.
- Tooltip: preview's "Top Stories" heading (lines 180 to 182) has NO InfoTooltip and no "today" copy, so preview needs the query fix only, not a copy change.

Decision input: mechanically identical query, non-protected, and pilot/prospect-facing. Per the plan rule this is the fold-in case, not the defer case.

---

## PHASE 1.5 — PLAN

### Single user-facing recency ceiling

Introduce ONE named ceiling: `TOP_STORIES_MAX_AGE_DAYS` = the oldest a story will ever be shown, enforced on `published_at`. Every tier of the query derives its age bound from this one value, and because there is no separate render cap, the renderer shows exactly the query output. The query therefore cannot return a row the renderer would consider out of range, and the only empty state is a genuine absence of stories within the ceiling, which degrades to the existing `EmptyState`.

Concretely the recency model becomes two constants with two distinct, non-overlapping jobs:
- `TOP_STORIES_MAX_AGE_DAYS = 7` — CONTENT AGE CEILING (published_at floor). The single source of truth for "oldest shown." Applied as the `published_at` guard in BOTH tiers and as the fallback's `ingested_at` window. The republish-killer (a 100-day-old republished item has `published_at < now - 7d` and is excluded) and the render ceiling are one and the same value.
- `TOP_STORIES_PRIMARY_WINDOW_HOURS = 72` — SURFACING WINDOW (ingested_at floor for the primary tier only). Sized from the measurement: above the p95 gap (56.6h) and above the max observed gap (68.4h) so the primary path engages on a normal day and across a normal weekend.

Plus the unchanged gating constants `TOP_STORIES_MIN_RESULTS = 3` and `TOP_STORIES_LIMIT = 4`.

Query tiers (both order `relevance_score` desc, `ingested_at` desc, limit `TOP_STORIES_LIMIT`):
- Primary: `ingested_at >= now - 72h` AND `published_at >= now - 7d`.
- Fallback (only if primary returns `< TOP_STORIES_MIN_RESULTS`): `ingested_at >= now - 7d` AND `published_at >= now - 7d`.

Note the only thing that widens in the fallback is the `ingested_at` floor (72h to 7d); the `published_at` ceiling is `now - 7d` in BOTH tiers, so the content-age ceiling is invariant across tiers. That is what makes the design single-ceiling rather than two-window.

Why keep a two-tier primary/fallback at all rather than one query at the ceiling: on a busy day we still want to PREFER freshly surfaced items. The 72h primary expresses that preference; the 7-day fallback is the safety net for a genuine multi-day drought beyond the worst observed gap. Both are bounded by the same 7-day content ceiling, so neither can surface stale content.

### Tooltip honesty (defect 3)

Replace the dashboard "Top Stories" tooltip copy "The highest-signal articles today, ranked by Signalera's relevance algorithm." with copy that is true under the ceiling and derives from the constant, e.g. "The highest-signal stories from the last 7 days, ranked by Signalera's relevance algorithm." Interpolate `TOP_STORIES_MAX_AGE_DAYS` so the copy and the bound can never drift. No false "today" precision.

### Single source of truth + preview fold-in (defect plus fast-follow)

Because preview must apply the identical corrected pattern and the whole reason it drifted is duplicated query logic, extract the recency logic into one shared module rather than copy it:

- New file `src/lib/top-stories.ts` exporting the constants above, the shared `TOP_STORIES_COLUMNS` select string, a `TopStoryRow` type, and `async function fetchTopStories(supabase: SupabaseClient): Promise<TopStoryRow[]>` that runs the primary then conditional fallback and returns rows (never throws; on query error logs and returns what it has, falling back to `[]`). Constants are exported so the dashboard tooltip can reference `TOP_STORIES_MAX_AGE_DAYS`.
- `src/app/dashboard/page.tsx`: delete the four local constants and the inline primary+fallback block; call `const data = await fetchTopStories(supabase);`. Update the tooltip string to reference the ceiling.
- `src/app/preview/page.tsx`: replace the inline unfiltered query with `const data = await fetchTopStories(supabase);`. No tooltip change (no "today" copy there).

This makes the ceiling and window genuinely single-source: both surfaces import the same constants and the same fetch logic, so they cannot diverge again.

### Files to change

- ADD `src/lib/top-stories.ts` (constants + `fetchTopStories` + types).
- EDIT `src/app/dashboard/page.tsx` (use helper, update tooltip, drop local constants).
- EDIT `src/app/preview/page.tsx` (use helper).

No protected file is touched. `src/proxy.ts` is read for recon only, not modified.

### Edge cases

- Primary populated (normal day): primary returns >= 3 rows, fallback never runs, items are within 72h ingest and 7d publish.
- Ingest gap over the ceiling (drought longer than 7d): both tiers return 0 rows; `data = []`; `stories` is empty; existing `EmptyState` renders on both surfaces. Bounded, no stale content, no crash.
- Thin but non-empty (1 to 2 rows): renderer shows the lead plus however many compact rows exist; no off-by-one (slice handles it).
- Null `published_at`: `.gte("published_at", ...)` excludes nulls, which is correct (ingest always sets `published_at`, and a story with no publish date should not lead). The `ingested_at` (NOT NULL) guard is the backstop.
- Future-dated `published_at`: passes `>= now - 7d`, sorts by relevance as today. Pre-existing, unchanged, not worsened.

### What I am deliberately NOT doing

- NOT adding a render-side age filter. There is no render cap today; adding one would create the very second-knob incoherence this task removes. The query ceiling is the single bound, and the renderer is proven (Self-Critique #1, A) to display exactly the query output.
- NOT changing `.limit(4)`, the relevance+ingested ordering, the EmptyState, or any personalization logic.
- NOT changing the ingest pipeline, schedule, or `relevance_score` computation.
- NOT re-enabling `schedule.yml` cron (out of scope; the fix is robust to the measured cadence regardless).

---

## SELF-CRITIQUE #1

Attacking the plan.

A. Is there ANY remaining state where the query returns rows the renderer drops?
Trace every row from query to DOM. `fetchTopStories` returns rows R (length 0 to 4). Dashboard: `setStories(R.map(...))`; `forYouStories = sortByRelevance(stories, ...)` is a pure sort (no filter, verified at `personalization.ts:111` to 115); `displayStories` is `forYouStories` or `stories`, same length as R; render shows `displayStories[0]` and `slice(1)`, i.e. all of them. Preview: `setStories(R.map(...))`; render shows `stories[0]` and `slice(1)`. In neither surface is there a `.filter`, a length cap below `R.length`, or an age comparison between query and DOM. The only conditional is `length === 0` to `EmptyState`. Therefore every returned row is rendered; there is no drop state. The coherence is structural, not numeric: since no component re-applies a recency bound after the query, there is no second bound to disagree with the first. Confirmed.

B. Does resizing the primary window to 72h reintroduce stale items?
No. Staleness is bounded by `published_at >= now - 7d`, which is applied in the primary tier too, independent of the 72h `ingested_at` floor. Widening the ingest floor only changes how recently an item must have been SURFACED, never how old its content may be. Worst case in the primary is an item ingested 71h ago but published just inside 7 days, which is within the declared ceiling and the honest tooltip. The 100-day republish path stays excluded because its `published_at` is far outside 7 days. Verified by construction: max age shown = ceiling = 7 days in all tiers.

C. Does the single-ceiling refactor change behavior for any other consumer of the (former) render cap or the constants?
There was no render cap, so nothing consumed it. The four constants were module-private to `dashboard/page.tsx` (recon item 2) with no importers, so deleting them affects only that file. The new shared module is additive. The only behavior change to existing surfaces is intended: dashboard now windows correctly and shows honest tooltip copy; preview now windows at all. No third surface imports these. `live-feed`, `evening-wrap`, `morning-brief`, and the backend keep their own separate queries and are untouched.

D. Is 72h / 7d defensible, or arbitrary?
72h is derived: it is above the measured p95 inter-batch gap (56.6h) and above the max observed gap (68.4h), so the primary path engages on a normal day and across a normal weekend. 7d is the content ceiling: it gives roughly four days of headroom beyond the worst observed gap for a genuine outage longer than anything measured, while bounding "Top Stories" to a week, which is a defensible "recent" horizon for market news and matches the prior fallback value so this is a re-labeling, not a loosening. Both are surfaced as named constants for review.

E. Data-layer failure modes.
Nulls, timezones, future dates, and empty windows are enumerated in Edge Cases. The new risk introduced by extraction is a typing mismatch in the shared helper. Mitigation: `getCompleteness` and `getAdjustedScore` (`src/lib/article-signal.tsx:7,17`) already accept `string | null | undefined` and `number | null | undefined`, and `TopStoryRow` types `companies` as `unknown` (both callers `JSON.parse`/guard it), so the typed return is compatible with both call sites. To be verified by `tsc` in Self-Critique #2.

F. Fold-in risk for preview.
Preview is logged-out and reads `articles` with the anon key (same as dashboard), so the windowed query works identically there. The only preview-specific behavior (the sign-in nudge, `PreviewContext`) is outside the stories block and untouched. Risk is low and the upside (no stale stories on the prospect surface) is high. Folding in is the right call.

### Revisions made in response to the critique

- Made explicit (point A) that coherence is structural: the plan adds NO render-side bound, so there is provably no second recency bound to disagree with the query. This is the precise answer to defect 2, which assumed a render cap that does not exist.
- Pinned the `published_at` ceiling to `now - TOP_STORIES_MAX_AGE_DAYS` in BOTH tiers (point B), so resizing the primary `ingested_at` window cannot affect the content-age ceiling. The single ceiling is enforced on `published_at`, and the surfacing window is enforced on `ingested_at`; the two never overlap.
- Locked the tooltip copy to interpolate the constant so copy and bound cannot drift.

The single-ceiling two-tier design survived the critique; the revisions tightened the coherence proof and the tier semantics rather than changing the approach.

---

## SELF-CRITIQUE #2 + VERIFICATION

### Diff re-read vs the revised plan

Changes match the plan:
- ADD `src/lib/top-stories.ts`: the four constants (`TOP_STORIES_MAX_AGE_DAYS = 7`, `TOP_STORIES_PRIMARY_WINDOW_HOURS = 72`, `TOP_STORIES_MIN_RESULTS = 3`, `TOP_STORIES_LIMIT = 4`), `TOP_STORIES_COLUMNS`, the `TopStoryRow` type, and `fetchTopStories(supabase)` running primary then conditional fallback with the `published_at` ceiling pinned in both tiers.
- EDIT `src/app/dashboard/page.tsx`: deleted the four local constants and the inline primary+fallback block; now `const data = await fetchTopStories(supabase);`. Tooltip changed from "...articles today..." to an interpolated "...stories from the last 7 days...". Added the import.
- EDIT `src/app/preview/page.tsx`: replaced the inline unfiltered query with `fetchTopStories(supabase)`. Added the import. No tooltip change (none present).

Drift (all benign, all necessary or behavior-neutral):
- Typing the shared return exposed four latent nullability mismatches that the old untyped `any` rows had hidden: `timeAgo(a.published_at || a.ingested_at)` and `credMap.get(a.source)` on both surfaces. Resolved truthfully: `TopStoryRow.ingested_at` is typed `string` because the column is NOT NULL (`DEFAULT now()`), which makes `published_at || ingested_at` a `string`; and each `credMap.get` site is now `a.source ? credMap.get(a.source) ?? null : null`, identical runtime result (a null source already produced null). These are type-correctness fixes, not behavior changes.
- `if (data)` in both pages is now always true (the helper returns an array, never null). Left as-is for a minimal diff; it is harmless and the empty array still flows to the existing `EmptyState` via `length === 0`.

### Changed files (proof no protected file touched)

```
ADD  src/lib/top-stories.ts
EDIT src/app/dashboard/page.tsx
EDIT src/app/preview/page.tsx
ADD  docs/recon/top-stories-reconcile.md
ADD  docs/recon/reconcile-dashboard.png
ADD  docs/recon/reconcile-preview.png
```

None of MemoModal.tsx, watchlist-utils.ts, WatchlistAddInput.tsx, trends/page.tsx, briefing/route.ts, /api/memo/route.ts. `src/proxy.ts` was read for recon only, not modified.

### Build, typecheck, lint

- Build: `npm run build` -> `BUILD_EXIT=0` (Next 16.2.2 Turbopack). `/dashboard` and `/preview` both compiled.
- Typecheck: `npx tsc --noEmit` -> only the 4 pre-existing `tests/unit/*.ts` import-extension errors remain (identical to the pristine `origin/main` baseline). Zero errors in `top-stories.ts`, `dashboard/page.tsx`, or `preview/page.tsx`. The earlier four nullability errors my typing surfaced were fixed (see Drift).
- Lint: `npx eslint src/lib/top-stories.ts src/app/dashboard/page.tsx src/app/preview/page.tsx` -> 0 errors, 1 warning (the pre-existing `watchlistTickers`/`useMemo` note, unrelated).

### Data-layer before/after (live, anon key)

The OLD unfiltered top 4 at this moment happened to be 0.6 to 6.1 days old (the stale high-score items were not top-ranked right now; the bug is intermittent), so the protective value is shown by the inventory the ceiling now excludes:

```
score>=9 published older than 7 days  (excluded by ceiling): 22673
score>=9 published older than 30 days                      : 10778
score>=9 published older than 100 days                     :  1338
oldest score>=9 published                                  : 8376.7 days
score>=9 ingested <=72h but published >7d (republish path) :   277
```

So at this instant there are 277 freshly ingested, high-score, stale-publish items (the exact RSS-republish landmines) that the OLD query could surface and the `published_at` ceiling excludes, plus a 22,673-item stale high-score backlog reaching back ~23 years. The ceiling excludes all of them.

Primary tier engages (defect 1 fixed):

```
NEW primary (ingested<=72h AND published<=7d): 4 rows  -> >= MIN 3, fallback NOT used
NEW primary oldest item: 6.11 days  (within the 7-day ceiling)
```

### Visual smoke (authenticated dashboard + logged-out preview)

Temporary Playwright spec (not committed) against the local build, asserting non-empty, no application error, and every rendered "Xd ago" within 7 days:

```
DASHBOARD_TS=["6d ago","14h ago","6d ago","18h ago"]   DASHBOARD_MAXDAYS=6
PREVIEW_TS  =["18h ago","6d ago","14h ago","6d ago"]    PREVIEW_MAXDAYS=6
3 passed
```

- Dashboard (authenticated): 4 stories, max age 6 days, no error; the "highest-signal articles today" tooltip text is gone (asserted count 0). Screenshot `docs/recon/reconcile-dashboard.png`.
- Preview (fresh logged-out context, the prospect surface): 4 stories, max age 6 days, no error; screenshot `docs/recon/reconcile-preview.png` shows the "live preview" banner and "Sign in free" CTA with recent Top Stories. The mix of 14h/18h and 6d items confirms the 72h primary tier engages with fresh content while the ceiling bounds the rest.

The pre-existing `InfoTooltip` dev-mode hydration warning still prints; it is unrelated to this change (same component on `origin/main`), and the interpolated tooltip uses only a constant (no `Date.now`/random), so it adds no new hydration mismatch.

### Edge cases, each exercised

- (a) Primary window populated: with the last batch ingested ~9h ago, the 72h primary returned 4 rows (>= 3), so the primary path engaged and the fallback did not run. The 14h/18h items in the smoke confirm fresh primary content. Defect 1 resolved.
- (b) Ingest gap exceeds the ceiling: simulated with an empty (future) window, the query returned 0 rows. With 0 rows `data = []`, `stories` is empty, and both surfaces render the existing `EmptyState`. Bounded, no stale content, no crash.
- (c) No query-returns-rows-renderer-drops state: proven by construction. `fetchTopStories` returns rows R; each surface does `setStories(R.map(...))`, sorts via the pure `sortByRelevance` (no filter), and renders `[0]` plus `slice(1)`, i.e. all of R, with the only branch being `length === 0` to `EmptyState`. No component re-applies a recency bound after the query, so there is no second bound that could drop a returned row. The single `published_at` ceiling is the only recency bound in the whole path.

### Verdict

Defects 1 to 3 resolved and the preview fast-follow folded in. The recency model is now a single named ceiling (`TOP_STORIES_MAX_AGE_DAYS`) enforced on `published_at` in every tier, with a measurement-justified 72h surfacing window so the primary path engages on a normal day. Dashboard and preview share one module, so they cannot diverge again. Build green, no new type or lint issues, both surfaces render recent non-empty stories within the ceiling, and the empty-window case degrades to the existing EmptyState. Ready to update the draft PR.
