# Top Stories freshness tiebreak: recon

Branch: `feat/top-stories-freshness-sort` off `origin/main` (a408ea4e, includes
#341/#345/#347/#348). Read-only SELECT for measurement only; no migrations, no
DDL, no writes, draft PR only, no em-dashes. `src/lib/top-stories.ts` confirmed
NOT on the propose-only list.

Goal as briefed: ship a cheap interim so the saturated top relevance band
surfaces the freshest items deterministically instead of arbitrary order, without
recalibrating relevance_score (separate sprint).

## PHASE 1, item 1: re-confirm the saturation premise (measured today)

Read-only SELECT over the primary window the code actually uses (ingested within
72h AND published within 7 days):

| metric | value |
|--------|-------|
| pool_total | 6,186 |
| max relevance_score | 10 |
| rows tied at max (10) | 1,731 (28% of the pool) |
| distinct ingested_at among those 1,731 | 17 |
| distinct published_at among those 1,731 | 1,527 |
| NULL published_at in pool | 0 |
| future-dated published_at in pool | 0 |

Saturation HOLDS, hard. 1,731 rows tie at the ceiling score of 10. The rendered
top 4 is a draw from this block, so de-arbitration is worthwhile. The fix is NOT
unnecessary.

## PHASE 1, item 2: the current ordering, and a correction to the premise

The brief says ties are broken by "physical order" today. That is not accurate
on current main. `fetchTopStories` (both tiers) already orders:

```
.order("relevance_score", { ascending: false })
.order("ingested_at",     { ascending: false })
.limit(TOP_STORIES_CANDIDATE_LIMIT)   // 24
```

So tied relevance is already broken by ingested_at desc (the code comment at
:199-200 states this intent). BUT the measurement exposes why that tiebreak is
weak: Postgres `now()` is the TRANSACTION timestamp, so every row inserted in one
ingest batch shares an identical ingested_at. Among the 1,731 tied rows there are
only 17 distinct ingested_at values. ingested_at desc therefore collapses the
block into ~17 buckets of ~100 rows each, and WITHIN a bucket the order is
arbitrary physical order. The top 4 are drawn from the single freshest bucket,
but which 4 of its ~100 rows is arbitrary. So the brief's "arbitrary order"
symptom is real; the mechanism is within-batch collision, not a missing
tiebreak.

Where the sort applies in the pipeline: the `.order()` runs at the DB query that
produces the 24-row over-fetch, BEFORE `collapseSameEvent` and BEFORE the
`.slice(0, LIMIT)`. So the ordering decides which rows survive the dedup slice.
Changing the tiebreak changes which freshest rows enter the candidate set and in
what order, which is exactly the lever we want.

## PHASE 1, item 3: published_at reliability as a tiebreak

- NULL: the query already filters `.gte("published_at", ceiling)`. A NULL
  published_at fails `>= ceiling`, so NULLs are excluded from the result set.
  Measured NULL published_at in the pool: 0. A published_at sort therefore never
  meets a NULL in practice; for belt-and-suspenders the sort should still pin
  `nullsFirst: false` so a NULL could never float to the top.
- Future-dated: measured 0 in the pool today. Risk is non-zero in principle (RSS
  mis-dates), and published_at desc would float a future-dated row to the very
  top of the tie. This argues for NOT making published_at the FIRST tiebreak (see
  the plan): keeping ingested_at desc first contains a future-dated row to a
  reorder within its own ingest batch instead of the whole list.

## PHASE 1, item 4: composition with the dedup keep-which rule

`collapseSameEvent` sets a cluster's POSITION at its best-placed member's rank
(min input idx) and picks its DISPLAYED survivor via `keepWhichReplaces`, which
prefers highest score, then longer cleaned title, then EARLIEST published, then
lowest id. A published_at-desc ORDER prefers LATEST published. These point
opposite ways but govern different things (candidate position vs cluster
representative) and only interact inside a same-event cluster (same ticker AND
subject, within 48h, Jaccard >= 0.5), where the two published times are within 48h
of each other anyway. The interaction is bounded and not a fight. Crucially, the
recommended plan keeps ingested_at desc as the FIRST tiebreak, so the candidate
ordering that feeds the collapse is identical to today except inside a batch;
dedup composition is therefore essentially unchanged from current behavior.

## Live before/after illustration (top 6 at score 10, measured today)

- A, current (`rel desc, ingested desc`): all 6 from the freshest ingest bucket
  but published_at scattered across Jun 8, 9, 10, 11 in arbitrary order. The
  within-batch arbitrariness, visible.
- B, the brief's literal plan (`rel desc, published desc, id`): all 6 are SEC
  EDGAR form filings ("8-K ...", "10-Q ...") sharing an IDENTICAL published_at
  (13:00:32.674484), broken by id. Publication-first surfaces a homogeneous wall
  of filing boilerplate, because SEC filings carry the most-recent published_at
  globally and also batch-collide on it. This is WORSE than today.
- C, refined (`rel desc, ingested desc, published desc, id`): freshest ingest
  bucket, ordered by publication freshness within it: SSNC 12:58, Eightco 12:41,
  KKR $10B AI infra 12:30, Nvidia robot play 12:29, PepsiCo freight 12:16. Fresh,
  substantive, fully deterministic.

This is the load-bearing result: making published_at the FIRST tiebreak (B)
regresses the list to SEC-filing noise. Using published_at only WITHIN the
existing ingested_at bucket (C) gets the freshness win with a strictly smaller,
safer change.

## PHASE 1.5: PLAN (recommended: Option C)

Add two ordering keys after the existing ones, in BOTH tiers (primary and
fallback), changing nothing else (window, candidate limit, collapse, slice all
untouched):

```
.order("relevance_score", { ascending: false })
.order("ingested_at",     { ascending: false })
.order("published_at",    { ascending: false, nullsFirst: false })   // NEW
.order("id",              { ascending: true })                       // NEW
```

- `published_at desc` resolves the within-batch arbitrariness (1,527 distinct
  values vs 17 ingested_at buckets) so the freshest-published rows in a batch
  surface first.
- `id asc` is a unique, non-null, stable total-order final key, so the result is
  fully deterministic and identical across repeated runs.
- `nullsFirst: false` is defensive only (the ceiling filter already excludes
  NULLs).

Rejected: the brief's literal `published_at desc, id` WITHOUT keeping
`ingested_at desc` first (Option B). The measurement shows it regresses the
visible top to a homogeneous SEC-filing block and enlarges the behavioral change
(it reorders cross-batch, not just within-batch). Option C is the minimal,
safer, better-performing form of the same idea.

## SELF-CRITIQUE

- Does C change selection for any NON-tied case? No. relevance_score desc is
  unchanged and first, so any row not tied at the same relevance keeps its exact
  position. Among rows tied on relevance, ingested_at desc is also preserved, so
  cross-batch order is identical to today. The new keys engage ONLY where
  relevance AND ingested_at both tie, i.e. inside one ingest batch, which is
  precisely the arbitrary case we are fixing. Targeted and minimal.
- Null/future published_at? NULL excluded by the existing ceiling filter (0
  measured) and pinned last via nullsFirst:false. Future-dated (0 measured)
  cannot hijack the list because ingested_at desc dominates first, so a
  future-dated row only reorders within its own batch.
- Stable across runs? Yes. id asc is a unique total order, so no arbitrary
  physical-order residue remains; repeated runs return byte-identical order.
- Composes with dedup? Yes. The candidate ordering feeding collapse is unchanged
  except within a batch; keep-which still governs the cluster representative. The
  earliest-vs-latest published tension is bounded to 48h same-event clusters and
  is not introduced by this change (keep-which already used published_at).
- Revision applied in place: the plan moved from the brief's "published_at first"
  to "published_at within the existing ingested_at bucket, id final" on the
  strength of the SEC-filing measurement.

## STATUS: approved (Option C) and implemented.

## PHASE 2: implementation

`src/lib/top-stories.ts` only. Both tiers (primary and fallback) gain two
ordering keys after the existing `relevance_score desc, ingested_at desc`:

```
.order("published_at", { ascending: false, nullsFirst: false })
.order("id", { ascending: true })
```

The tier doc-comment was updated to explain the within-batch collision and the
two new keys. Window, candidate limit, `collapseSameEvent`, and the slice are
untouched.

## SELF-CRITIQUE 2 + VERIFICATION (deterministic, no prod e2e)

### Hard gates

- tsc: `rm -rf .next && npx tsc --noEmit` -> 0 errors.
- lint: `npm run lint` -> 0 errors, 48 warnings (all pre-existing; none in
  top-stories.ts).
- build: `npm run build` -> success.

### Data-layer before/after on the live pool (single consistent snapshot)

Top 4 at score 10:

- OLD (`rel desc, ingested desc`): published_at = Jun 9 21:00, Jun 11 22:59,
  Jun 11 12:00, Jun 11 06:28. The rank-1 item is two days staler than items
  ranked below it. Arbitrary within-batch order.
- NEW (`rel desc, ingested desc, published desc, id asc`): published_at = Jun 12
  02:24, 02:01, 01:52, 01:16. Strictly publication-descending; the four
  freshest-published items in the tied block, deterministically.

### Determinism / stability proof (snapshot-independent)

Over the 24-row candidate set:

| key | distinct values | meaning |
|-----|-----------------|---------|
| OLD (relevance_score, ingested_at) | 1 | all 24 candidates tie; top 4 was a 100% arbitrary draw |
| + published_at | 24 | published_at alone fully discriminates the set today |
| NEW (+ id) | 24 | unique total order; result identical across repeated runs |

`distinct_old_sort = 1` is the strongest confirmation of the premise: the entire
24-row over-fetch shared one `(relevance_score, ingested_at)` key, so the visible
list was fully arbitrary. The NEW key yields 24 distinct values, i.e. a single
deterministic order with no physical-order residue. Because `id` is unique and
non-null, the new sort is a total order: given the same pool it returns a
byte-identical sequence on every run.

### e2e

This changes a user-facing module, so a supervised e2e run is the final
confirmation. e2e is advisory and was NOT auto-run; the mutating suite was not
run against the prod ref. The change is a pure ordering refinement at the data
layer (no schema, no component, no API surface), so e2e regression risk is low.

### Constraints honored

No migrations, no DDL, no writes (read-only SELECT for measurement only). No
protected files. No merge. em-dashes in diff and doc: 0.
