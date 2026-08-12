# `pipeline_runs` loses whole runs when the pipeline dies before step 4

**Status:** observation only. NOT fixed. Separate PR, **after the ingest.py branches land**.
**Found:** 2026-08-12, while confirming what `pipeline_runs.ingest_count` counts for the dashboard sparkline (PR #593).
**Evidence:** production data, 12-day window, cross-checked against an exact count of `articles`.

## The observation

On **2026-08-03, 534 articles were really stored and no `pipeline_runs` row records it.**

Per-day sum of `ingest_count` against an exact count of `articles` by `ingested_at`:

```
day          sum(ingest_count)   exact articles   delta
2026-08-01              1464             1464         0
2026-08-02                 0                0         0
2026-08-03                 0              534      +534   <-- no run row at all
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

11 of 12 days agree **to the row**, which is what makes the 12th trustworthy as a real gap rather than a definitional mismatch. 2026-08-03 had 10 `pipeline_runs` rows, all of them `edgar_ingestion` and friends; **no `morning` or `evening` row exists for that day**. No run in the window recorded `ingest_count = 0`, so this is the missing-row path, not the guarded-failure path.

## Mechanism (VERIFIED by reading `backend/run.py`)

**Correction to an earlier claim.** I previously wrote that `record_run()` fires "at the end of all 16 pipeline steps". **That is wrong**, and the difference decides where the fix goes and which failures are actually affected.

The real ordering:

| step | line | guarded? |
|---|---|---|
| `[1/16] INGEST` | 136 | yes, `_run_ingest_guarded` |
| `[1b/16] CONTENT BACKFILL` | 140 | yes |
| `[1c/16] USER SIGNAL AGGREGATION` | 150 | yes |
| `[1d/16] SECTOR BACKFILL` | 159 | yes |
| `[2/16] DEAL EXTRACTION` | 171 | yes |
| `[3/16] SYNTHESIZE` | 187 | **NO — `run_synthesize()` at line 189 is unguarded** |
| `[STORY RAIL] SELECTION` | 211 | yes |
| **`[4/16] OBSERVE` → `record_run()`** | **230-234** | yes (see below) |
| `[5/16]` … `[16/16]` | 246-357 | yes, each individually |

So the exposed window is **step 1 to step 4**, and there are three ways to lose the row:

1. **`run_synthesize()` raises (run.py:189).** This is the only unguarded statement between ingest and observe. The exception propagates out of the `__main__` block and the process dies at step 3. Articles from step 1 are already committed. **Most likely cause of 2026-08-03.**
   - Note the *stub* path at line 198 is deliberately guarded (`raise` immediately caught, `_mark_degraded`, continue). A genuine exception from inside `run_synthesize` is not.
2. **`record_run()` itself throws.** It is wrapped in its own try/except (run.py:233-245) that calls `_mark_degraded` and continues. A failed INSERT therefore silently produces no row while the pipeline carries on.
3. **Hard process death before step 4** — OOM, job timeout, CI cancellation. No exception handler helps.

## What this means for run history

**Run history under-reports exactly on the runs that failed EARLY — between ingest and observe — not on downstream failures.**

This is narrower than "days the pipeline failed downstream", and the difference is worth keeping straight: a failure in steps 5-16 happens **after** the row is already written and is individually soft-guarded, so the row exists and carries its `ingest_count`. Those runs are recorded fine. It is specifically a **step-3 synthesize failure** (or a hard kill in that window) that vanishes.

## Consumers affected (VERIFIED by grep, whole repo)

Everything that reads `ingest_count` or counts `pipeline_runs` rows inherits this blind spot.

| consumer | what breaks |
|---|---|
| `backend/summarize.py:400` — `total_ingested = sum(...)` → `pipeline_health["total_articles_ingested"]` in the **weekly digest** | Under-reports total articles ingested for the week. Same failure as the sparkline. |
| `backend/summarize.py:396-398` — `total_runs = len(runs)`, `success_rate = success_runs / total_runs` | **Worse than under-reporting.** A run that dies before step 4 is absent from the table, so it is excluded from BOTH the numerator and the denominator. `success_rate` is computed only over runs that survived to step 4 — a synthesize crash is invisible to the health metric that exists to catch it. The metric flatters itself precisely when it should not. |
| `src/app/dashboard/page.tsx` — sparkline | Plots 0 for an affected day. Documented in place. |
| `src/app/api/debug/brief-status/route.ts:63` — last 5 runs | A crashed run simply is not in the list, so "last run" is the last one that reached step 4. Debug route, low blast radius. |
| `backend/summarize.py:248` — single run by `id` | Honest: renders `"?"` when `ingest_count` is None. Not affected. |

`src/app/api/briefing/route.ts` and `src/app/api/system-intelligence/route.ts` read `pipeline_runs` but not `ingest_count`; they read status/timing for staleness display. They share the "a crashed run is not in the table" blind spot but make no volume claims.

## The fix (NOT done here)

Two independent changes, both backend:

1. **Record the ingest count when ingest finishes, not at step 4.** Either write the `pipeline_runs` row immediately after step 1 and UPDATE it at step 4, or have ingest write its own count. This is the one that closes the data gap.
2. **Guard `run_synthesize()` at run.py:189** like every other step, so a synthesize exception marks the run degraded instead of killing the process before it is recorded. Note this changes failure semantics — the job currently exits non-zero via an uncaught exception — so it needs deciding, not just patching.

Fixing (2) alone still loses the row on a hard kill. Fixing (1) alone is enough for the data, and is the smaller change.

**Do not fix `success_rate` by filtering.** The denominator problem is caused by the missing rows; fix (1) and the metric corrects itself.

## Related

- `scratch/DASHBOARD_STORIES_SLOW.md` — where this was found, and the per-day verification.
- PR #593 — the sparkline that surfaced it. Documents the gap in place; does not fix it.
- `scratch/INGEST_RECON.md` — pipeline stage-by-stage account.
