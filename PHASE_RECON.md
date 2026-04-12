# Phase 0 Recon — findings before Phases 2–6

**Date:** 2026-04-10
**Branch:** `main`
**Recon script:** `scripts/_recon_theses.py` (run against live Supabase via `.env.local` NEXT_PUBLIC_* vars)

## 1. Actual `theses` schema (from live query)

The live row on 2026-04-10 has exactly these columns:

| column                  | type          | notes                                        |
|-------------------------|---------------|----------------------------------------------|
| `id`                    | uuid          | primary key                                  |
| `title`                 | text          | ≤8 words, actionable                         |
| `conviction`            | text          | string label — `HIGH` / `MEDIUM` / `WATCH` / `BULLISH` / `BEARISH` |
| `rationale`             | text          | 3–4 sentence analyst paragraph               |
| `sector`                | text          |                                              |
| `catalyst`              | text          | 1–2 sentences                                |
| `catalyst_note`         | text          | extra context                                |
| `evidence_chain`        | jsonb         | array of `{type,label,bridge}` objects       |
| `supporting_articles`   | text[] / jsonb | **list of article ids** (NOT `supporting_article_ids`) |
| `status`                | text          | e.g. `new-signal`                            |
| `generated_at`          | timestamptz   | ← use this for ordering, NOT `created_at`    |
| `source`                | text          | e.g. `ai-generated`                          |

## 2. Drift from the prompt's assumed schema

The Phase 0 brief listed the expected columns as
`id, title, summary, rationale, sector, catalyst, confidence_score, supporting_article_ids, source, created_at`.
Differences:

| prompt assumed          | actual                    | adaptation                                              |
|-------------------------|---------------------------|---------------------------------------------------------|
| `summary`               | — (not present)           | Use `rationale` where the prompt implies thesis prose.  |
| `confidence_score` (numeric) | `conviction` (text)  | Ignore for grading math; keep as categorical metadata.  |
| `supporting_article_ids`| `supporting_articles`     | Use `supporting_articles` in every join/read.           |
| `created_at`            | `generated_at`            | Use `generated_at` in every `order()`/`gte()` filter.   |

## 3. Where theses are actually generated — CRITICAL

Thesis generation is **in the frontend**, not in `backend/synthesize.py`:

- `backend/synthesize.py` writes to the `briefings` table (morning/evening briefing). It does **not** touch `theses`.
- `backend/theses.py` and `backend/theses_schema.sql` are **stale** (old `company/thesis_text/bull_bear` schema from a pre-V2 CRUD prototype). They are not imported by any other backend module and the live table no longer matches them.
- The actual AI generation is **`src/app/api/theses/route.ts`** (TypeScript Next.js route). It:
  1. Pulls the latest `run_id` from `trend_clusters` (last 48h)
  2. Fetches up to 10 clusters, up to 3 articles per cluster
  3. Reads the most recent `weekly_digests.thesis_prompt_addendum` for that `brief_type` and injects it into the prompt
  4. Calls Gemini 2.5 Flash with `thinkingBudget: 0` and `responseMimeType: "application/json"`
  5. Inserts rows into `theses` with fields `title, conviction, rationale, sector, catalyst, catalyst_note, evidence_chain, supporting_articles, status, generated_at, source`
- The frontend route is the **only** place that populates `theses.source = 'ai-generated'`.

## 4. Assumptions I am making for Phases 2–6

Because the user said "Do not stop to ask questions — make reasonable assumptions and note them in PHASE_RECON.md", I am taking these adaptations:

1. **Every new module is Python** in `backend/` per the global conventions, even though the thesis *generation* step is TypeScript. The new backend modules operate on the `theses` table post-insert.
2. **Phase 2B** (extract `ticker`, `horizon`, `verifiable_signal`): I will modify `src/app/api/theses/route.ts` (not `backend/synthesize.py`) because that is where the Gemini thesis prompt actually lives. The three new fields get stored on the new theses columns added by `thesis_grader.py`'s DDL.
3. **Phase 4C** ("hook adversarial into thesis generation in `synthesize.py`"): Since thesis generation is TS and runs on-demand via POST, I implement `backend/adversarial.py` as a **batch step** in `run.py` that processes any `theses` rows where `passed_adversarial IS NULL`. This preserves the user's requirement ("insert all theses regardless, but only those with `passed_adversarial=true` are surfaced downstream") without needing a round-trip Python call from the TS route. Downstream consumers read `passed_adversarial` on subsequent views.
4. **Phase 6B** (inject relevant patterns into thesis prompt): I will add a direct Supabase read of the `pattern_library` table into `src/app/api/theses/route.ts` (analogous to how it already reads `weekly_digests.thesis_prompt_addendum`). No Python round-trip.
5. **Phase 5B** join: uses `supporting_articles` (not `supporting_article_ids`).
6. **Grading filter**: "where `outcome IS NULL AND check_after < now()`" uses the new `check_after` column added by `thesis_grader.py`'s DDL. The backfill job for existing rows (which have no `check_after`) can be handled by a NULLS-first heuristic: if `check_after IS NULL AND generated_at < now() - interval '30 days'`, treat it as overdue with default horizon `30d`. Logged.
7. **Ticker extraction for historical theses**: Rows inserted before Phase 2B will have `ticker IS NULL`. The grader skips any thesis without a ticker and logs it.
8. **Finnhub free-tier limits**: Per the rules of engagement, I catch 403/429 and store `null` for that signal. Rate-limiting back-off is a short `time.sleep(0.5)` between calls inside the grader loop.
9. **The stale `backend/theses.py` and `backend/theses_schema.sql`** will be **left alone** (rule: do not remove existing functions, only extend). The `run.py` orchestrator never imports `theses.py`, so its staleness is a documentation problem, not a runtime one.

## 5. Phase 0 checklist

- [x] `git status` clean, `git pull --rebase origin main` up to date
- [x] Read `backend/run.py`, `backend/synthesize.py`, `backend/summarize.py`, `backend/trend_mapper.py`, `backend/theses.py`
- [x] Read `src/app/api/theses/route.ts`
- [x] Wrote `scripts/_recon_theses.py` and ran it against live Supabase
- [x] Confirmed the drift above
- [x] Wrote this document

Proceeding directly to Phase 2 with the adaptations above.
