# Weekend news-ingest gap: diagnosis

Branch: `diag/weekend-ingest-gap` (off `origin/main` @ c093dc96). Diagnosis only, no code change.

## Classification: EXTERNAL (trigger did not fire on weekends)

The weekend gap is caused by the external trigger (cron-job.org) not firing on Sundays at all, and firing only the evening run on Saturdays. The in-repo pipeline runs ingest unconditionally whenever it is invoked, and when it runs on a weekend day it does write articles (Saturday proves this). So this is not an in-repo no-op and not source scarcity. Per the decision gate this is EXTERNAL: no code change is warranted; the fix lives in the cron-job.org schedule. Recommendation and cost are at the end.

---

## PHASE 1 findings

### 1. The job that writes `ingested_at` to `articles`

- Writer: `backend/ingest.py`, line 1493, `supabase.table("articles").insert(...)`. A repo-wide grep for `table("articles").insert|upsert` returns only `backend/ingest.py`, so this is the sole writer. (`ingested_at` is `DEFAULT now()`, set server-side on insert.)
- Orchestrator: `backend/run.py`, step `[1/16] INGEST` calls `run_ingestion()` (alias `run_ingest`). It runs UNCONDITIONALLY on every invocation; there is no weekday/weekend guard around ingest (the only day-gated step is `[12/16] ADVERSARIAL`, gated to Sunday morning; some steps are morning-only). Verified by grep: the only weekday logic in `run.py`/`ingest.py` is `_is_sunday_morning` at `run.py:50`.
- Workflow: `.github/workflows/schedule.yml` ("BreakingAlpha Pipeline"), which runs `python run.py <mode>` in `backend/`.
- Trigger mechanism: `workflow_dispatch` ONLY. `schedule.yml` has no `schedule:` block. (The "Determine run mode" step references `github.event.schedule == "0 14 * * 1-5"`, but that branch is vestigial since no schedule trigger exists.) The dispatch is fired externally by cron-job.org, confirmed below: 80 of 80 recent runs have `event = workflow_dispatch` and 0 have `event = schedule`.

### 2. Source of truth: did the trigger fire (GitHub Actions run history, last 30 days)

`gh run list --workflow schedule.yml`. All runs fire at ~03:00 UTC and ~13:00 UTC. Tabulated by day-of-week (UTC), last 5 full weekends:

| Weekend (UTC) | Sat 03:00 | Sat 13:00 | Sun 03:00 | Sun 13:00 |
| --- | --- | --- | --- | --- |
| 05-09 / 05-10 | ran | none | none | none |
| 05-16 / 05-17 | ran | none | none | none |
| 05-23 / 05-24 | ran | none | none | none |
| 05-30 / 05-31 | ran | none | none | none |
| 06-06 / 06-07 | ran | none | none | none |

Weekday slots for comparison: both 03:00 and 13:00 fire Mon to Fri (with a few isolated failures, e.g. 06-01 13:00 and 06-02 03:00 failed, which lengthen individual gaps).

Inferred cron-job.org schedule (UTC), consistent across all 30 days:
- morning (mode=morning): `0 13 * * 1-5` (Mon to Fri at 13:00 UTC)
- evening (mode=evening): `0 3 * * 2-6` (Tue to Sat at 03:00 UTC)

So every Sunday has ZERO runs, and every Saturday has exactly ONE run (the 03:00 UTC evening run, which is Friday's evening brief). Event type for all 80 sampled runs: `workflow_dispatch` (0 scheduled), confirming the trigger is entirely external.

Longest no-ingest window on a clean week: Saturday 03:00 UTC to Monday 13:00 UTC = 58 hours. When a bracketing weekday run fails (e.g. the 06-01 / 06-02 failures), it stretches to the ~68h max measured in the recency work.

### 3. Source of truth: did it write (read-only SELECT, `ingested_at` by day-of-week, 30 days)

```
DOW   articles  active_days  avg_per_active_day
Mon     5668        5            1134
Tue    20464        5            4093   (gnews fan-out batch days)
Wed     4292        4            1073
Thu     4279        4            1070
Fri     4038        4            1010
Sat     2091        4             523
Sun        0        0               0
```

Sunday (dow=0) is absent from the result entirely: zero articles ingested on any Sunday in 30 days. Saturday runs at roughly half a weekday's volume (one run vs two). This matches the run history one-to-one: zero Sunday runs to zero Sunday rows, one Saturday run to about half-volume Saturdays.

### 4. Three-way fork

- TRIGGER DID NOT FIRE on weekends: CONFIRMED. Run history shows 0 runs on all 5 Sundays and exactly 1 (evening) run on Saturdays. DB shows 0 Sunday inserts. The trigger is external (`workflow_dispatch` only, 80/80 runs), so the gap is an external cron-job.org schedule that omits Sunday entirely and omits the Saturday morning slot.
- RAN BUT WROTE NOTHING: RULED OUT. There is no weekend guard, filter, or source toggle around ingest in `run.py` or `ingest.py`; `[1/16] INGEST` runs on every invocation. On the days it ran it succeeded and wrote (Saturday writes ~523 articles per run). Sunday has no write because there is no Sunday run, not because a run produced nothing.
- SOURCE SCARCITY: RULED OUT as the cause. Saturday is a weekend day, markets are closed, yet the single Saturday run still ingests ~523 articles per run (2091 over 4 Saturdays). So the feeds (RSS plus Google News per-ticker plus wires) do yield hundreds of weekend articles when polled. Weekend volume is lower than weekdays, but it is not near-zero. A Sunday run would write hundreds too; the Sunday zero is purely the missing trigger.

Evidence weight: the run history and the DB agree exactly (0 Sunday runs and 0 Sunday rows; 1 Saturday run and half-volume Saturdays), and Saturday's non-trivial write volume directly refutes scarcity. The diagnosis is unambiguous.

### 5. Where a fix would live

In the cron-job.org schedule (external), not in the repo. The repo trigger is `workflow_dispatch`-only by design and must stay that way; the missing weekend executions are missing cron-job.org dispatch entries. No in-repo file (`schedule.yml`, `run.py`, `ingest.py`) should change to add a weekend schedule.

### Side finding (corroborates the Sunday gap)

`run.py` step `[12/16] ADVERSARIAL` is gated to `_is_sunday_morning` (morning mode AND `weekday() == 6`). Because the external schedule never fires a Sunday run, and the only Saturday run is `mode=evening`, this Sunday-morning-only step has never actually executed under the current cron. The code presupposes a Sunday morning run that the external schedule does not provide. This is consistent with the conclusion that the schedule, not the code, omits Sunday.

---

## Recommendation (cron-job.org only; do not change the repo)

Goal: keep Monday-morning Top Stories fresh for weekend users by adding weekend dispatches. Two tiers; pick based on how much weekend coverage you want.

Current weekend coverage: Saturday 03:00 UTC (1 run), Sunday (0 runs). Longest gap 58h (Sat 03:00 to Mon 13:00), up to ~68h when a weekday run fails.

Recommended (balanced): extend the MORNING dispatch to fire every day.
- Change the morning cron-job.org job from `0 13 * * 1-5` to `0 13 * * *` (every day at 13:00 UTC).
- Net new dispatches: Saturday 13:00 and Sunday 13:00 (the morning mode). That is +2 runs per week.
- Effect: Saturday becomes 2 runs, Sunday becomes 1 run. Longest weekend gap drops from 58h to 24h (Sun 13:00 to Mon 13:00). Monday-morning content is then at most ~24h old instead of up to ~58h, well inside the recency window.
- Bonus: a Sunday morning run also re-enables the dormant Sunday-morning adversarial step.

Full parity (optional): also extend the EVENING dispatch to every day.
- Change the evening cron-job.org job from `0 3 * * 2-6` to `0 3 * * *` (every day at 03:00 UTC).
- Net new dispatches over the balanced option: Sunday 03:00 and Monday 03:00. That is +2 more runs per week (+4 total vs today).
- Effect: 2 ingests per day, 7 days a week; longest gap about 10 to 12h, the same as weekdays.

Do NOT do: add a `schedule:` cron to `schedule.yml`. That fights the intentional dispatch-only architecture. All scheduling stays in cron-job.org.

### Rate and cost note

- GitHub Actions: each run is one ubuntu-latest job lasting about 18 to 23 minutes (measured: e.g. 06-09 13:00:05 to 13:18:54 = 19 min; 06-06 03:00:04 to 03:23:13 = 23 min). The balanced option adds ~2 runs/week (~8 to 9 per month, ~3 hours of Actions time/month). Full parity adds ~4 runs/week (~17 per month, ~6 hours/month). Check this against the account's Actions minutes budget; both are modest but not free.
- LLM cost: each run scores newly ingested candidates with Gemini at ingest and then runs synthesize plus downstream steps. Weekend ingest volume is ~500 articles per run (Saturday baseline), so the incremental scoring cost per weekend run is roughly half a weekday run. Modest.
- Product side effect to decide: the existing pipeline always runs the FULL brief (synthesize, personalization, etc.), so each added weekend dispatch also generates a weekend morning or evening brief. If you want weekend INGEST freshness WITHOUT publishing weekend briefs, that would require a new ingest-only mode in `run.py` (an in-repo change, out of scope for this external-trigger fix). Flagging so the choice is explicit; the recency goal itself is met by ingest alone, which runs first in every dispatch.

## Verification limitation

I cannot prove weekend firing here without either firing a production `workflow_dispatch` (off limits) or waiting for an actual weekend (also not available). Everything above is observed history and read-only data. Final confirmation is yours after the cron-job.org change: watch the next weekend's `gh run list --workflow schedule.yml` for Saturday 13:00 UTC and Sunday runs, and re-run the day-of-week `ingested_at` query to confirm Sunday is no longer zero.
