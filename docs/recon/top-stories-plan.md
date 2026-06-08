# Top Stories Recency: Phase 1.5 Plan

Branch: `fix/top-stories-recency`
Companion docs: `top-stories-recency.md` (recon), `top-stories-verification.md` (verification, written in Phase 2).

---

## Chosen approach

Option (c): keep the existing composite sort and wrap it in a recency window guardrail, with a widen-on-thin-results fallback.

Concretely: order by `relevance_score` desc with `ingested_at` desc as tiebreaker (UNCHANGED), but only over articles inside a recency window defined on BOTH `ingested_at` and `published_at`. If the primary window returns too few rows, run one widened fallback query bounded at 7 days. Never query unbounded.

### Why this option, not the others

- Why not (a) a single hard `published_at` window only: a `published_at`-only filter misses the "ingested long ago, high score" path, and an `ingested_at`-only filter misses the RSS-republish path (fresh `ingested_at`, stale `published_at`). The recon (section 6) and `backend/synthesize.py` lines 1070 to 1074 both show the republish path is the documented real-world failure. A guard on both columns is required to actually kill "hundreds of days old."
- Why not (b) recency-weighted score / time decay: there is NO frontend precedent for a decay half-life. Decay exists only in the backend (`_freshness_rerank`, `effective = relevance - age_hours/8` at `backend/synthesize.py` lines 462 to 466), applied AFTER a window filter, not instead of it. Introducing a decay constant in the dashboard would be a novel one-off pattern, harder to reason about, and would still need a window guard underneath to be safe. The task explicitly asks for consistency with existing convention.
- Why (c): it is exactly the established convention. `src/app/evening-wrap/page.tsx` (lines 287 to 308) and `src/app/morning-brief/page.tsx` (lines 337 to 357) already do "relevance ordering inside a 24h window, widen to 48h on thin results." `backend/synthesize.py` (lines 1069 to 1098) already does the dual-column `ingested_at` + `published_at` guard with a widen-to-7-days fallback. This plan composes those two existing precedents: the frontend thin-results fallback shape, plus the backend dual-column guard. Zero novel patterns.

### The composite-sort precedent is preserved

The recon asked whether `relevance_score` desc with a date tiebreaker already exists: yes, it is the dashboard's own current ordering (lines 228 to 229) and is also how evening-wrap and morning-brief order within their windows. This plan keeps that ordering verbatim and only adds the surrounding window. So the change is additive, not a re-sort.

## Tunables (surfaced for review)

Defined as named module-level constants in `src/app/dashboard/page.tsx`, next to the existing `SPARK_DAYS` constant (line 72). Adjust in review:

| Constant | Value | Meaning |
| --- | --- | --- |
| `TOP_STORIES_INGESTED_WINDOW_HOURS` | 24 | Primary window on `ingested_at`. "Surfaced in the last day." |
| `TOP_STORIES_PUBLISHED_WINDOW_HOURS` | 48 | Primary window on `published_at`. Wider than the ingest window so genuinely late-breaking items (published up to 2 days ago, ingested today) still qualify. Mirrors `synthesize.py` line 1075. |
| `TOP_STORIES_FALLBACK_WINDOW_HOURS` | 168 | Widened window (7 days), applied to BOTH columns, used only when the primary window is thin. Bounds the worst case at one week. Never unbounded. |
| `TOP_STORIES_MIN_RESULTS` | 3 | If the primary query returns fewer than this, run the widened fallback. Matches the `< 3` threshold in evening-wrap (line 298) and morning-brief (line 349). |

The headline value for review is the 24h / 48h primary pair. If mornings feel too sparse, raise `TOP_STORIES_INGESTED_WINDOW_HOURS`; the fallback already cushions thin windows.

## Exact files to change

Only one file: `src/app/dashboard/page.tsx`.

1. Add the four named constants near `SPARK_DAYS` (around line 72 to 87).
2. Replace the "Get top 4 stories" block (lines 224 to 230) with:
   - compute `ingestedCutoff`, `publishedCutoff` (primary) and `fallbackCutoff` (7 days) as UTC ISO strings, using the same `new Date(Date.now() - hours * 3600 * 1000).toISOString()` form already used in evening-wrap line 287;
   - primary query: add `.gte("ingested_at", ingestedCutoff).gte("published_at", publishedCutoff)` to the existing select and ordering, keep `.limit(4)`;
   - if `data` has fewer than `TOP_STORIES_MIN_RESULTS` rows, run one fallback query: `.gte("ingested_at", fallbackCutoff).gte("published_at", fallbackCutoff)`, same ordering and limit, and use its rows instead.
3. One short comment above the window explaining why both columns are filtered (the republish path), since that is the non-obvious part.

Everything downstream (the `data.map(...)` transform at lines 237 to 285, `forYouStories`, `displayStories`, the render) is untouched and works on whatever rows the query returns.

## Edge cases

- Null `published_at`: a `.gte("published_at", cutoff)` filter drops rows where `published_at` is NULL (in Postgres `NULL >= x` is not true). In practice ingest always sets `published_at` (defaults to `now()` when the feed lacks one, recon section 6), so this should drop nothing real. And if a row did have a null `published_at`, excluding it from "Top Stories" is the correct call: a story with no publish date is exactly the kind of low-quality row we do not want leading the dashboard. The `ingested_at` (NOT NULL) filter is the backstop either way.
- Future-dated `published_at`: a future date passes `>= cutoff` and sorts normally by relevance. This is unchanged from today's behavior (no future guard exists at ingest) and is not a regression introduced here. Out of scope; noted so it is not a surprise.
- Thin result set / window too tight: handled by the fallback tier, which widens both columns to 7 days. If even 7 days is empty (pipeline genuinely down), the query returns zero rows and the EXISTING `displayStories.length === 0` branch renders the `EmptyState` "No stories yet" card (dashboard line 698 to 703). So an empty module is already a graceful, intended state, not a crash or a blank.
- Timezones: all `articles` date columns are `timestamptz` (UTC). The cutoff strings are `Date.now()` based UTC ISO, identical to the evening-wrap convention. No local-time skew.

## Blast radius and containment

- Single file, single query block. The dashboard query is not shared (recon section 7), so no other surface can regress.
- The `count` / `bullish` / `bearish` / sparkline / briefing-headline queries earlier in the same `useEffect` (lines 169 to 222) are independent and untouched.
- `forYouStories` (personalization re-sort) operates on the fetched rows and is agnostic to how many or which rows arrive, so it is unaffected.
- No backend, no migration, no shared lib, no API route. No Lucas-protected file is in this path (none of MemoModal.tsx, watchlist-utils.ts, WatchlistAddInput.tsx, trends/page.tsx, briefing/route.ts, /api/memo/route.ts).

## What I am deliberately NOT doing

- NOT fixing `src/app/preview/page.tsx`, which has the byte-for-byte identical unfiltered query (recon section 7). It is a separate route outside the stated mission ("the dashboard"), and the constraint asks for a minimal, surgical diff. Documented here and in the PR as a recommended follow-up so it is not lost.
- NOT adding time-decay scoring on the frontend (no precedent; would be a one-off).
- NOT changing how `relevance_score` is computed, or adding decay at ingest (backend, much larger blast radius, out of scope).
- NOT relabeling the "Top Stories" heading or editing the tooltip copy. Evening-wrap relabels because its label literally says "Today's"; the dashboard heading is just "Top Stories" with a tab bar, so a silent window widen on the fallback is honest. The tooltip's "today" wording is a minor copy nuance flagged for sign-off, not changed here.
- NOT changing the `.limit(4)` or the For You / All tab behavior.

---

## Critique (Self-Critique #1)

Attacking the plan above as a skeptical reviewer.

1. Does this fix the root cause or mask the symptom?
   Fixes the cause. The root cause (recon) is "no recency window at all; relevance_score is a static signal." The plan adds the missing window on both date columns, which is precisely the absent guard. It does not paper over a still-stale score. Counter-risk: it does NOT make `relevance_score` itself time-aware, so within the window a 47h-old score-10 can still edge a 2h-old score-8. That is acceptable and intended: inside a 24 to 48h window "more important" beating "slightly newer" is the correct product behavior (it is exactly what evening-wrap and the backend do), and the `ingested_at` desc tiebreaker still favors fresher items at equal score. The pathology we are killing is months-old, not hours-old. Verdict: addresses the cause, with a deliberately bounded scope.

2. Will it regress any other consumer?
   No other consumer exists for this query (recon section 7); it is inlined in the dashboard. The earlier count/sparkline queries are independent. So regression surface is limited to the dashboard's own Top Stories list. The one real regression vector is "the window empties the module" which is handled by the fallback plus the pre-existing EmptyState. Verdict: contained.

3. Is the recency model defensible to a finance-literate user, or arbitrary?
   Defensible. "Top Stories = the highest-relevance items from roughly the last day, widened to a week only if today is quiet" is a clear, explainable rule and matches what the product already does in the morning brief and evening wrap. The 24h / 48h asymmetry has a stated reason (late-breaking items published up to 2 days ago but surfaced today). It is not a black-box decay constant. The one weakness: the exact numbers (24/48/168/3) are conventional, not derived from data; mitigated by surfacing them as labeled tunables for review.

4. Does it honor conventions or introduce a one-off?
   Honors them. It reuses two existing precedents verbatim in shape: the evening-wrap thin-results fallback and the synthesize.py dual-column guard. The only minor divergence is NOT relabeling the heading on fallback, which is justified because the dashboard heading is not date-scoped the way evening-wrap's "Today's" label is. No new pattern is introduced.

5. Failure mode at the data layer (nulls, timezones, empty windows)?
   - Nulls: covered above; `.gte` on `published_at` drops nulls, which is both practically a no-op (ingest always sets it) and the desired behavior, with the NOT-NULL `ingested_at` filter as backstop.
   - Timezones: all UTC `timestamptz`, cutoffs are UTC ISO, consistent with existing code. No skew.
   - Empty windows: fallback widens to 7 days; if still empty, existing EmptyState. No crash, no unbounded query.
   - One more I missed initially: what if the FALLBACK also returns 1 or 2 rows (very quiet week)? Then the module shows 1 or 2 cards. That is fine; `displayStories[0]` exists so `LeadStoryCard` renders, and `.slice(1)` is empty or short. The only guard needed is `displayStories.length === 0`, which already exists. No off-by-one. Confirmed safe.

### Revisions made in response to the critique

- Point 1 / Point 5: I am keeping `ingested_at` desc as the explicit secondary `.order(...)` in BOTH the primary and fallback queries (not dropping it as evening-wrap does), so that at equal `relevance_score` the fresher item always wins. This directly answers the "47h score-10 vs 2h score-8" concern by at least making same-score ties favor recency, and it preserves the dashboard's current tiebreaker exactly. The plan's "Exact files to change" step 2 already specifies keeping the existing ordering; this makes that explicit and intentional rather than incidental.
- Point 3: elevate the 24h / 48h primary pair as THE review knob (done in the Tunables section note) so the arbitrariness is owned and adjustable rather than buried.
- Point 5 (thin fallback returning 1 to 2 rows): confirmed the existing `length === 0` EmptyState is the only guard needed; no code change required, but it is now explicitly verified in the edge-case list and will be exercised in the Phase 2 edge-case test.

No structural change to the approach survived the critique. The dual-column window plus widen-on-thin fallback remains the plan; the critique tightened the tiebreaker rationale and the empty-state reasoning rather than overturning the design.
