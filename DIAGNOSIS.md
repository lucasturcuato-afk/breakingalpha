# Run #98 Pipeline Timeout: Diagnosis and Fix

**Run:** GitHub Actions ID 25497315694 (job 74820420144)
**Trigger:** workflow_dispatch by noahhanning at commit dd72878 on main
**Started:** 2026-05-07T13:00:05Z (06:00 PT)
**Killed:** 2026-05-07T19:05:19Z (12:05 PT), 6h 5m 14s, GitHub's 6h0m0s ceiling
**Result:** Job force-cancelled. No Thursday May 7 morning brief landed.

---

## 1. Root cause hypothesis (most likely first)

### Hypothesis A: HIGH confidence. External API hang inside `run_ingestion()` Step [1/12], compounded by total absence of per-call timeouts on `feedparser.parse()` and `gemini_client.models.generate_content()`.

Run #98 wrote ZERO rows to *any* pipeline table during its 13:00 UTC window. The hang occurred BEFORE the first DB write, i.e. inside Step 1 INGEST, before or during one of:
- `fetch_all_articles()`: RSS pulls via `feedparser.parse(url)` at `backend/ingest.py:479` with **no timeout**.
- `filter_articles_batch()`: single Gemini call at `backend/ingest.py:590` with **no timeout** and `max_output_tokens=65536`.

Either call can hang indefinitely:
- `feedparser.parse()` blocks on the underlying urllib socket; if any RSS endpoint holds the response, the pipeline waits forever.
- `google-genai` SDK uses httpx with no explicit `request_timeout`; a hung Gemini stream or stuck HTTP/2 connection produces the same effect.

The Run pipeline step's stdout was lost because GitHub force-killed the job at 6h0m0s and the in-progress step's log blob was never flushed (`gh api .../jobs/.../logs` returns 404 BlobNotFound). So we cannot point at the precise function. But the DB-side evidence (no writes anywhere) localizes the hang to Step 1.

### Hypothesis B: LOW confidence. Article volume cross `max_output_tokens=65536` payload exceeded Gemini's effective response budget.
Run #97 (10h earlier, 365 articles) succeeded. If May 7 morning ingested even more, the batch filter call could have stalled mid-stream. Same fix surface as A.

### Hypothesis C: REJECTED. Memo `maxOutputTokens` bump (commit `1f3a4b3`).
**This was the user's a-priori suspicion. It is wrong.** Verified:
- Diff for `1f3a4b3` is 2 LOC and touches only `src/app/api/memo/route.ts` (Next.js API route).
- The Python pipeline in `backend/` does not call `/api/memo`. It uses `google-genai` directly. None of the pipeline-side `max_output_tokens` constants were modified by the commit (`backend/ingest.py:595` shows 65536; `backend/synthesize.py:634` shows 4096; etc, all pre-date the commit).
- `output_log_v0_stub` has exactly one memo row at 19:29:20 UTC May 7 (12:29 PT, *after* the cancellation): `latency_ms=3757`, normal. Token bump is not slow.

### Hypothesis D: REJECTED. PR #201 / #209 retry chain in finnhub_helper.
PRs #201 and #209 are on feature branches `noah/patch-j-matcher-fixes` and were **never merged into `origin/main`**. `git log 14694a1 -- backend/finnhub_helper.py` shows only `37f700e` (PR #198), the simple 40-line version with a 5s timeout. No retry chain exists in main's pipeline code path.

---

## 2. Last successful pipeline run duration vs run #98

**Source: `pipeline_runs.duration_s` and GitHub Actions `gh run list`.**

| date (PT)        | mode    | duration | source        |
|------------------|---------|----------|---------------|
| 2026-04-28 morn  | morning | 27.0 min | pipeline_runs |
| 2026-04-29 evng  | evening | 27.0 min | pipeline_runs |
| 2026-04-29 morn  | morning | 28.7 min | pipeline_runs |
| 2026-04-30 morn  | morning | 33.7 min | gh CLI        |
| 2026-04-30 evng  | evening | 50.0 min | pipeline_runs |
| 2026-05-04 morn  | morning | 70.3 min | pipeline_runs |
| 2026-05-05 morn  | morning | 68.9 min | pipeline_runs |
| 2026-05-06 morn  | morning | 75.1 min | pipeline_runs |
| 2026-05-06 evng  | evening | 67.7 min | pipeline_runs |
| **05-07 evng (run #97)** | evening | **76.0 min** | pipeline_runs |
| **05-07 morn (run #98)** | morning | **>365 min, killed** | gh CLI        |

**Two effects, not one:**
- **Creep** Apr 28 to May 6 (around 2.7x over 8 days). Begins right after PR #189 (May 4) wired `register_entity` into ingest. Each ingested company name now does an extra `aliases` lookup plus ticker-population Finnhub call. Not the cause of run #98, but a real second-order issue.
- **Sudden break** at run #98. Run #97 finished in 76 min the same UTC day (10h earlier). Run #98 hit the 6h ceiling. Step-function jump means a single hung external call, not a creeping cost.

---

## 3. Specific step where run #98 hung

**Step [1/12] INGEST, inside `run_ingestion()` (`backend/ingest.py:727`), before or during the first article-store loop.**

Cannot be more specific from logs (cancelled-step log blob was never persisted). DB-side evidence is decisive:

| table             | last write timestamp           | run that wrote it |
|-------------------|--------------------------------|-------------------|
| articles          | 2026-05-07 04:14:45 UTC        | #97 (evening)     |
| run_articles      | 2026-05-07 04:16:27 UTC        | #97               |
| briefings         | 2026-05-07 04:16:27 UTC        | #97               |
| pipeline_runs     | 2026-05-07 04:16:27 UTC (completed) | #97          |
| company_mentions  | 2026-05-07 04:14:43 UTC        | #97               |
| aliases           | 2026-05-07 04:14:17 UTC        | #97               |
| resolution_log    | 2026-05-07 04:14:27 UTC        | #97               |
| deal_flow         | 2026-05-07 04:15:55 UTC        | #97               |
| trend_clusters    | 2026-05-07 04:16:29 UTC        | #97               |

Run #98 (started 13:00:05 UTC) wrote NOTHING anywhere. The hang was BEFORE `articles.insert()` on the very first article. So the hang was earlier: in `fetch_all_articles()` (most likely `feedparser.parse()`) or `filter_articles_batch()` (Gemini call).

**No log line number available.** The Run pipeline step is in the `gh` API as `started_at=2026-05-07T13:00:36Z, completed_at=null`, force-killed at 6h.

---

## 4. Schema discovery (per-table columns relevant to time-window queries)

| table                | timestamp column(s)                     |
|----------------------|-----------------------------------------|
| `articles`           | `published_at`, `ingested_at`           |
| `run_articles`       | `created_at` (plus `run_id`, `article_id`) |
| `briefings`          | `created_at`, `briefing_date` (date)    |
| `pipeline_runs`      | `started_at`, `completed_at`, `created_at`, `duration_s`, `status`, `brief_type` |
| `company_mentions`   | `created_at`                            |
| `aliases`            | `created_at` (plus `last_seen_at`)         |
| `resolution_log`     | `created_at`                            |
| `deal_flow`          | `created_at`, `updated_at`              |
| `trend_clusters`     | `created_at`, `run_id`                  |
| `output_log_v0_stub` | `generated_at`, `latency_ms`, `metadata` |
| `outputs`            | `created_at`, `updated_at`              |

`briefings` does NOT have a `mode` or `status` or `body` column. It has `briefing_type`, `briefing_date`, `headline`, `summary`, plus jsonb sections, no in-progress sentinel.

---

## 5. Hourly write counts per table for last 48h

Hours shown in UTC. Run #97 = 03:00 UTC May 7, ended 04:16 UTC. Run #98 = 13:00 UTC May 7, cancelled at 19:05 UTC. **No 13:00-19:00 UTC writes anywhere.**

```
hour (UTC)            articles  run_articles  aliases  resolution  company_mentions  briefings
2026-05-07 04:00         365         60         10         19          171              1   (run #97 ok)
2026-05-06 14:00         170         60         10         16          108              1
2026-05-06 04:00         306         60         10         18          179              1
2026-05-05 14:00         170         60          5         10           86              1
2026-05-05 04:00         144         60          7          7           75              1
2026-05-07 13:00-19:00     0          0          0          0            0              0   (run #98 fail)
```

(`aliases` had a 2882-row spike at 2026-05-05 06:00, the one-time backfill from PR #200, not pipeline traffic.)

---

## 6. Step where writes stopped: confirmed

**Run #98 stopped writes BEFORE Step 1 INGEST produced its first article-row.**

`run_ingestion()` runs four sub-phases: fetch, pre-filter, Gemini batch, store. The store phase begins inserting into `articles` and `company_mentions` per article. Zero rows in either means the pipeline never reached the first iteration of the store loop, OR the very first store hung before the first `INSERT` returned. Given supabase-py uses PostgREST over httpx (which DOES default-timeout at 5s), a Supabase hang would surface as an exception not a 6h block. So the hang is upstream of store: in `fetch_all_articles()` or `filter_articles_batch()`.

---

## 7. Latency analysis from `output_log_v0_stub`

Only one row in the table. Irrelevant to the pipeline hang and only confirms the memo route works:

```
output_type=memo  source_id=unknown  generated_at=2026-05-07 19:29:20 UTC
latency_ms=3757   metadata.model=gemini-2.5-flash  metadata.max_output_tokens=2400
```

That call was **after** the cancellation (a manual /api/memo invocation, likely by the user investigating). Latency 3.8s, fine. The 600 to 2400 bump is not slowing the memo route.

---

## 8. Phase A: narrow the hang to a specific call (HALTED)

### Active probe: live RSS feed responsiveness today

Probed all 21 feeds with a 15s socket timeout from this machine at 2026-05-08 ~02:00 UTC. Results:

```
name              parse_secs  n_entries  bozo  bozo_exc                 http_status
NYT Technology    0.38s       20         False                          200
NYT Business      0.21s       50         False                          200
NYT World         0.12s       56         False                          200
MarketWatch Top   0.19s       10         False                          200
TechCrunch        2.12s       20         False                          200
Reuters Tech      0.04s        0         True   URLError                ?     <- DEAD
Reuters Business  0.01s        0         True   URLError                ?     <- DEAD
Reuters World     0.01s        0         True   URLError                ?     <- DEAD
FT Tech           0.53s       25         False                          200
Axios             1.03s      100         False                          301
Bloomberg Tech    6.42s       30         False                          200
Pitchbook         0.81s        0         1      SAXParseException       404   <- BROKEN
Crunchbase News   0.25s       10         False                          200
PE Hub            3.00s       10         False                          200
Defense News      0.40s       25         False                          200
Breaking Defense  0.31s       15         False                          200
C4ISRNET          0.32s       25         False                          200
SEC 8-K           0.13s        0         1      SAXParseException       403   <- needs UA
SEC 10-Q          0.12s        0         1      SAXParseException       403   <- needs UA
Federal Reserve   0.27s       20         True   CharacterEncodingOverride  200
PR Newswire       0.29s       20         False                          200
```

### Findings:
1. **No feed currently hangs.** All feeds respond in under 7 seconds. Bloomberg is the slowest at 6.42s.
2. **6 of 21 feeds return errors but fail FAST:**
   - Reuters x3: URLError (`feeds.reuters.com` is dead). feedparser returns immediately; existing try/except catches.
   - Pitchbook: 404. `pitchbook.com/news/rss` is broken.
   - SEC 8-K and SEC 10-Q: 403. SEC now blocks unauthenticated requests; works with `User-Agent` header (verified 200 in 0.38s using `User-Agent: BreakingAlpha pipeline noahhanning03@gmail.com`).
3. **Yesterday's hang was transient.** Whatever feed (or Gemini call) hung run #98 is no longer hanging. Reproducing-from-input is no longer possible.

### HALT signal acknowledged

User instruction: "HALT if Phase A doesn't narrow to a specific suspect within 30 min, that's a sign we need different evidence (not more time on same evidence)."

We have no log evidence (cancelled-step blob unrecoverable), no in-flight DB heartbeat, and active probing today does not reproduce the hang. Both `feedparser.parse()` and `filter_articles_batch()` are unbounded; either could have been the culprit. Cannot narrow further from this evidence.

**Pivoting to Phase B/C/D:** the actual root cause that demands a fix is the architectural absence of timeouts and observability. The transient external failure is the trigger; the architectural fragility is the cause. Without the architectural fragility, the transient would have been a 30-second blip not a 6-hour hang.

---

## 9. Phase B: WHY it hangs

### Architectural root cause: unbounded external calls in Step 1

Two unbounded call sites in `backend/ingest.py` Step 1:

**Site 1 (HIGH suspicion): `feedparser.parse(url)` at line 479.**
- No `timeout` parameter. feedparser sets none by default; it falls back to whatever `socket.getdefaulttimeout()` returns (usually `None`, meaning infinite).
- Single bad feed in the per-feed loop blocks the rest of the pipeline.
- Live probe confirms 6 of 21 feeds are broken right now. The pipeline has been tolerating their failure-fast behavior, but a single switch from "fail-fast" to "respond slowly" on any one of these 21 feeds will hang forever.

**Site 2 (MEDIUM-HIGH suspicion): `gemini_client.models.generate_content()` at line 590 (`filter_articles_batch`).**
- Single Gemini call for the ENTIRE batch of articles (no chunking).
- `max_output_tokens=65536`. This is excessive for the actual schema. Output is ~10 short fields per article in JSON. At 200 articles times ~150 tokens per article, the realistic output is around 30K tokens. 65536 leaves ample budget, but signals "spend as long as needed", and Gemini's latency scales with the budget when the response is large.
- google-genai SDK uses httpx underneath. Default httpx timeout is 5 seconds for connection but no read-stream timeout when streaming. A hung HTTP/2 connection produces a silent infinite wait.

### Per-call fix

Both call sites need bounded timeouts. Option (d) from DIAGNOSIS section 9 of the original document covers this.

### Verified prompt-injection theory: not applicable

Per the prompt template at `backend/ingest.py:155-204`, the model is asked to return a structured JSON array. A prompt injection that successfully derailed the output schema would surface as a JSON parse error, which the existing fallback at line 627-629 catches (`return [filter_article(a) for a in articles]`). So the failure mode "hung in batch" is more likely a transport-layer issue than a prompt-injection-induced model loop.

---

## 10. Phase C: duration creep root cause

### PR #189 diff analysis

PR #189 (commit `ca503e5`, May 4) is 2 LOC in `backend/ingest.py`:
- `+from entity_resolver import register_entity`
- `cid = register_entity(company, supabase, themes=..., sentiment=...)` (replacing `upsert_company`)

Same call site, but the function body is fundamentally different.

### Old `upsert_company` per-company query count
```
SELECT companies WHERE name=...           # 1
UPDATE companies SET ...                   # 1   (existing)
or INSERT companies                        # 1   (new)
                                          ----
                                  TOTAL    2 queries
```

### New `register_entity` per-company query count

Hit-one path (most common, since aliases is well-populated):
```
SELECT aliases WHERE lookup_key=...        # 1
SELECT companies WHERE id=...              # 1
UPDATE companies SET mention_count, ...    # 1
UPDATE aliases SET mention_count, ...      # 1
                                          ----
                                  TOTAL    4 queries (2x baseline)
```

Miss path (new entity):
```
SELECT aliases                              # 1
INSERT companies                            # 1
HTTP GET finnhub.io/api/v1/search          # 1 HTTP call (5s timeout, ~300-500ms p50)
UPDATE companies SET ticker                 # 1
INSERT aliases                              # 1
INSERT resolution_log                       # 1
                                          ----
                                  TOTAL    5 queries + 1 HTTP call
```

### Volume math

Per-run: roughly 170 articles times average 2-3 unique companies per article = around 400 register_entity calls per run.

Hit-one (90 percent of calls, since aliases table has 2937 entries):
- Old: 400 calls times 2 queries = 800 queries
- New: 400 times 0.9 times 4 queries = 1440 queries
- Delta: +640 queries per run

Miss path (10 percent of calls, ~40 new entities per run):
- Old: 400 times 2 queries = 800 queries (handled in same column above)
- New: 40 times (5 queries + 1 HTTP) = 200 queries + 40 HTTP
- Of the 40 HTTP: at ~400ms each = 16 seconds added per run

Estimated overhead: ~640 extra Supabase queries per run plus 16 seconds of Finnhub HTTP latency. At ~150ms per Supabase query on the network round trip, that's around 96 additional seconds, plus 16 from Finnhub, equals around 110 seconds per run. That's 1.8 minutes, which does NOT explain a 27 to 76 minute jump.

### Observation: creep is larger than register_entity overhead alone

The simple math of register_entity queries does not explain the full duration creep. Other factors at play:
1. Article ingest volume increased: April runs averaged 50-70 articles, May runs average 170-365. More articles per run => more downstream work in EVERY step (synthesize, observe, etc.).
2. New steps were added between April and May (Step 1c user signals, Step 13 watchlist, Step 14 embedding_job, Step 16 thesis_generator). Each adds time.
3. Gemini latency on `filter_articles_batch` scales with batch size and `max_output_tokens=65536`. Larger batches mean longer model time.

### Phase C verdict

Duration creep is real but multi-factorial. PR #189's register_entity adds ~1-2 minutes; the bulk of the creep comes from increased article volume cross unbounded batch sizes and additional pipeline steps. Fixing register_entity alone will not bring duration back to 27 minutes; it would shave a couple minutes.

The **largest single lever** to bring duration down is reducing `max_output_tokens` on `filter_articles_batch` from 65536 to something realistic (~16384). This was already flagged in DIAGNOSIS section 8 appendix.

---

## 11. Final root-cause hypothesis with confidence level

> **Pipeline run #98 hung in Step [1/12] INGEST, in either `fetch_all_articles()` (feedparser.parse with no timeout, `backend/ingest.py:479`) or `filter_articles_batch()` (google-genai `generate_content` with no timeout and `max_output_tokens=65536`, `backend/ingest.py:590`), because an upstream RSS host or the Gemini API stalled the response and neither call has a per-request timeout to break out. Confidence: HIGH that the hang is in Step 1 (DB writes are zero); MEDIUM that it is specifically `feedparser.parse` (most common silent-hang vector in this codebase, no other code path has the necessary "no timeout plus first thing run" combination, and live probe confirms multiple feeds are flaky right now).**

The user's stated token-bump theory (commit `1f3a4b3`, 600 to 2400) is **falsified**: that commit only touched `src/app/api/memo/route.ts`, never reaches the pipeline, and the one observed memo call since the bump completed in 3.8s.

The retry-chain theory (PR #201 / #209) is **falsified**: those PRs are on feature branches and not in `origin/main`'s history of `backend/finnhub_helper.py`.

---

## 12. Phase D: fixes shipped on this branch

Branch: `noah/diagnose-pipeline-timeout`. Files modified:

### D.1 Fix the broken/dead feeds (true root cause cleanup)
- `backend/ingest.py`: remove 3 dead Reuters feeds and Pitchbook (currently 404). These contribute zero articles and add per-run failure noise.
- Add `User-Agent` header for SEC 8-K, SEC 10-Q, and Federal Reserve feeds. Without UA, SEC returns 403; with UA they return 200 and feed entries.

### D.2 Add bounded timeouts (architectural root cause fix; defense)
- `backend/ingest.py`: replace `feedparser.parse(url)` with a guarded fetch via `urllib.request.urlopen(req, timeout=20)` then `feedparser.parse(bytes)`. This caps any single feed at 20 seconds.
- `backend/ingest.py`: wrap the Gemini batch filter call in a `concurrent.futures` watchdog with a 180-second timeout. On timeout, fall through to per-article fallback (already present).
- `backend/ingest.py`: add `socket.setdefaulttimeout(30)` at module load as a process-wide safety net for any other library that might have an unbounded socket call.

### D.3 Reduce `max_output_tokens` on filter_articles_batch (right-sized budget)
- `backend/ingest.py`: 65536 to 16384. The actual JSON schema output is ~150 tokens per article times ~200 articles = 30K tokens worst case. 16384 covers ~100 articles per batch comfortably; the existing per-article fallback handles overflow.

### D.4 Add per-step timing observability
- `backend/run.py`: each `print("[N/16] STEPNAME")` followed by an elapsed-time log on completion. Format: `[1/16] INGEST done in 12.3s`. So if a future hang occurs we know which step.
- `backend/ingest.py`: per-feed and per-phase timing inside `fetch_all_articles()` and `run_ingestion()`.

### D.5 Workflow-level timeout (belt and suspenders)
- `.github/workflows/schedule.yml`: add `timeout-minutes: 90` to the Run pipeline step. Last successful run was 76 min; 90 min gives 18 percent headroom. If the pipeline hangs again, GitHub kills it after 90 min instead of 6 hours.

### Not done (deferred)
- Batched register_entity writes: scope is too large for tonight's hotfix. Phase C math shows register_entity contributes ~2 min of the creep, not the dominant factor. Defer to a follow-up.
- Per-step timeouts inside individual steps (synthesize, observe, etc.): out of scope.
- Replace dead Reuters with alternative feeds: file as W2-D backlog item (no compatible replacement reachable in this PR).

---

## 13. Smoke test plan

1. Push `noah/diagnose-pipeline-timeout` to GitHub.
2. Trigger workflow_dispatch with `mode=morning` from gh CLI.
3. Watch run live via `gh run watch`.
4. Confirm:
   - Total duration is under 60 minutes (target 30-45 min, matching pre-creep baseline).
   - Brief is generated for current date with mode=morning (one row in `briefings` with `briefing_date=today`).
   - Companies covered (count comparable to recent successful runs, ~14-15 selected per the `pipeline_runs.selected_count` history).
   - No timeout warnings beyond expected dead-feed handling.

If smoke passes: open PR to main with this DIAGNOSIS as PR body.

If smoke fails: append failure mode to this file, do not merge.

---

## Appendix: secondary issues surfaced

- **Duration creep:** Apr 28 27 min to May 6 75 min. Multi-factorial as analyzed in section 10.
- **`gh api .../jobs/.../logs` returns 404** when a job is force-killed. GitHub Actions limitation. Section D.4's per-step timing is the primary mitigation.
- **`pipeline_runs` row only created at Step 4 OBSERVE**, not at job start. So a hang in Step 1-3 leaves no row anywhere. A future improvement would be to insert a `started` row at job start and update on completion. Filed as part of the W2-D observability backlog.
