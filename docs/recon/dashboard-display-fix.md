# Dashboard display fixes: recon (B1 Signal decouple, A1 republish staleness)

Branch base: `origin/main` (fee84bb3). Two independent draft PRs, two worktrees,
no shared edit file. Read-only recon; line numbers verified on origin/main.

## B1: uniform Signal 5.0 + headline-only on every card

### Mechanism (confirmed)
- `src/lib/article-signal.tsx:17` `getAdjustedScore(relevanceScore, completeness)`
  returned `relevance_score * weight`, with weights `{full:1.0, summary:0.8,
  headline:0.5}`.
- Top Stories sort is `relevance_score DESC` (`src/lib/top-stories.ts` query), so
  the rendered tier saturates at relevance 10, and nearly every high-relevance
  item is a content-NULL Google News snippet that `getCompleteness` maps to
  `headline`. Result: `10 * 0.5 = 5.0` on every card, flat.

### Consumers of getAdjustedScore (all keep working, the badge already renders separately)
- Pages compute it and pass `adjustedScore`: `dashboard/page.tsx:248`,
  `evening-wrap/page.tsx:346`, `live-feed/page.tsx:215`, `morning-brief/page.tsx:469`,
  `preview/page.tsx:90`, `components/company/ArticlesRow.tsx:123`.
- Rendered by `SignalScore` (`article-signal.tsx:54`, shows `Signal: {score.toFixed(1)}`)
  in `story-card.tsx:180,410`, `feed-row.tsx:137`, `dc-story-row.tsx:211`.
- `CompletenessBadge` (`article-signal.tsx:31`, label "Headline only" / "Summary" /
  "Full text") is ALREADY rendered separately in every one of those components
  (`story-card.tsx:179,409`, `feed-row.tsx:136`, `dc-story-row.tsx:215`,
  `ArticlesRow.tsx:171`). So completeness is already a standalone badge; the only
  coupling to remove is the score math.

### Display scale to preserve
`SignalScore` renders `score.toFixed(1)` in `text-gold`, no `/N` denominator and
no color thresholds. relevance_score is the native 0-10 integer scale, so Signal
now reads `10.0 / 9.0 / 8.0 ...`. No color bands to preserve.

### Fix (PR1, fix/signal-score-decouple) -- simplified to native relevance
`getAdjustedScore` returns the native `relevance_score` unchanged (null guard
preserved); the completeness weight is dropped entirely. Completeness stays the
separate `CompletenessBadge`, and the card gains a source link. The helpers stay
in `article-signal.tsx` (where they live on main), so `@/lib/article-signal` and
all call sites are unchanged. NOTE/FORK: the second arg of `getAdjustedScore` is
now vestigial (kept to avoid touching 6 call sites); remove in a later sweep.

An earlier revision of this branch ("Option A") blended an age penalty, headline
magnitude bonus, and completeness bonus into a non-saturating composite used for
both sort and display (`computeSignalRaw` / `getSignalDisplay` / `sortBySignal`).
That blend was DROPPED: now that the backend grader is de-saturated (mode=new) the
relevance score is earned and is shown natively, no client-side re-scoring.

## A1: stale republish dated today, pinned to top

### Mechanism (confirmed)
- `src/app/dashboard/page.tsx:260` renders `timestamp: timeAgo(a.published_at || a.ingested_at)`,
  so the survivor's `published_at` drives displayed recency.
- `collapseSameEvent` (`top-stories.ts:154`) clusters by parsed feed ticker + subject
  (`primary_company`) + `withinSameEventWindow` (48h) + title Jaccard >= 0.5. A 6-day-late
  republish of an old event is > 48h from the original, so it does NOT cluster and
  surfaces as its own row.
- Query order is `relevance_score DESC, ingested_at DESC, published_at DESC`. The
  republish is freshly ingested at relevance 10, so it pins to the top and shows
  "today" off its fresh feed `published_at`.

### Fix (PR2, fix/republish-staleness-rank), three scoped changes in top-stories.ts
1. `SAME_EVENT_WINDOW_HOURS` 48 -> `TOP_STORIES_MAX_AGE_DAYS*24` (168). The 0.5
   Jaccard gate is the real same-event discriminator (distinct same-ticker stories
   score < 0.3 per docs/recon/top-stories-dedup.md), so widening only lets a true
   republish rejoin its event; distinct events still cannot merge. FORK: slightly
   larger false-merge exposure window, reversible by restoring 48.
2. `collapseSameEvent` stamps the survivor with the cluster's EARLIEST
   `published_at` (true event age), so the card reads the event date, not the
   republish date. Singletons unchanged.
3. New `rankByFreshness`: `relevance_score - 0.5/day * eventAgeDays`, applied after
   collapse in both tiers, stable sort. A stale event cannot pin the top tier and
   the top is no longer a flat block of relevance-10. FORK: the 0.5/day penalty is
   a first cut, tune against a live top set.

### Shared-file check
B1 touches only `article-signal.tsx` (helpers) plus the card source link in
`story-card.tsx`. A1 touches only `top-stories.ts`. No overlap. The dashboard page
consumes both but is edited by neither.

## Verification posture
Unit fixtures under `tests/unit` (run via `node --test`) are the deterministic
proof for both pure-logic changes; per the repo preflight rules a rendered-fixture
proof substitutes for e2e on non-interactive logic. A live dev-server screenshot
needs Supabase creds + auth + seeded rows, not run unsupervised overnight; a
deterministic before/after render is saved under docs/recon/smoke/ instead. See
each PR body.
