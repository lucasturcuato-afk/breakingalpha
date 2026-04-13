# Autonomous Improvement Plan

## Implementation Contract

- **Current phase:** Phase 1 — Complete. All 12 pipeline steps live and writing to Supabase.
- **Current goal:** Phase 1 observation layer is fully operational. Next phase is Phase 2 safe autonomy (config versioning, bounded optimizer, rollback window).
- **In scope now:** Weekly cross-run summary (generate_weekly_digest in summarize.py, standalone cron — not run.py), then Phase 2.
- **Not in scope yet:** Optimizer, rollback, config mutation, persona logic, and engagement optimization.
- **Source of truth:** This document governs autonomous-improvement work.
- **Implementation status:** Phase 1 complete (all 12 steps). Run Recorder (PR #42), Brief Critic (PR #47), Selection Auditor V1 (PR #48), Trend Mapper (PR #51), summarize.py post-run summary all built and live. Steps 9–12 (thesis_grader, pattern_memory, source_credibility, adversarial) built by Lucas and live as of 2026-04-11. Dual-dimension article taxonomy (industry_verticals + activity_types) live as of PR #85 (2026-04-13).

---

## 1. Executive Summary

Breaking Alpha should not become a generic AI news summarizer. Its edge should come from becoming a market-intelligence system that evaluates its own output, learns from misses, improves analysis quality, gets better at trend detection, and carries those gains forward without daily manual tuning.

The right architecture is a **two-layer system**:

1. **Core production pipeline:** ingest, filter, rank, synthesize, publish
2. **Autonomous improvement layer:** record, critique, audit, detect trends, store memory, and later optimize bounded config with rollback protection

This document translates that vision into repo-native guidance for future implementation work.

## 2. Why This Creates the Moat

Most AI finance products stop at summarization. They generate text, but they do not reliably know when they missed the dominant story, used generic reasoning, failed to detect a real trend, or repeated the same weak pattern across runs.

Breaking Alpha's moat comes from building a system that can:

- evaluate the quality of every Morning Review and Evening Wrap
- identify missed dominant stories and weak story selection
- learn from correct and incorrect trend detection
- improve future runs using durable memory
- later update bounded behavior safely and roll back on regression
- transfer quality gains across all future runs, not one-off outputs

The product becomes stronger every day it operates. That is a more durable advantage than adding more content, tabs, or surface-level automation.

## 3. Non-Negotiable Principles

- **Fully automatic:** The system should run daily without manual prompting.
- **Self-improving, but bounded:** Later autonomy may adjust thresholds, weights, caps, and approved prompt variants, but not code, schema, or model choice.
- **Content intelligence first:** Optimize for better analysis and trend detection before engagement or growth metrics.
- **Global learning first:** Improvements should raise product quality for all users, not narrow persona slices.
- **Rollback on sustained regression:** When safe autonomy is introduced, the system must revert if quality worsens over a defined window.
- **Store a lot, prompt a little:** Keep raw memory in Supabase and pass only compact, high-value context into prompts.

## 4. Why This Fits Breaking Alpha Today

Breaking Alpha already has many of the ingredients needed for this system:

- scheduled Morning Review and Evening Wrap runs
- structured articles and briefings in Supabase
- `relevance_score` and `relevance_reason`
- known quality issues already identified by hand, including headline dominance, comp-list echo, weak personalization, and RSS depth limits
- watchlist and preferences infrastructure
- an existing product philosophy focused on decision-support output rather than a generic feed

This means the next step is not inventing a new product category. It is wrapping the existing pipeline in a layer that observes, judges, remembers, and later improves it.

## 5. Phase Status (as of 2026-04-13)

### Live and Complete

All 12 pipeline steps are live, non-blocking, and writing to Supabase on every run:

| Step | Module | Scope | Tables written |
|------|--------|-------|----------------|
| 4 | observe.py | every run | pipeline_runs, run_articles |
| 5 | critique.py | every run | brief_quality_scores |
| 6 | audit.py | every run | selection_audit |
| 7 | trend_mapper.py | every run | trend_clusters |
| 8 | summarize.py | every run | (stdout only — no write) |
| 9 | thesis_grader.py | morning | theses.outcome |
| 10 | pattern_memory.py | morning | pattern_library |
| 11 | source_credibility.py | morning | source_credibility_scores |
| 12 | adversarial.py | Sunday morning | (log only) |

Article taxonomy is dual-dimension: `industry_verticals` (array) + `activity_types` (array), with `sector` as backward-compat primary vertical. Observation layer uses `industry_verticals[0]` with `sector` fallback throughout.

### Deferred / Phase 2

These items were identified but intentionally deferred — do not treat as bugs:

- `synthesize.py` `sector_breakdown` JSONB keys still use free-text sector names produced by Gemini; no migration planned until Phase 2 briefing schema work
- `src/components/brief/sector-signal-card.tsx` `sectorColors` map uses old hardcoded sector names matching `sector_breakdown` keys — deferred with the above
- `summarize.generate_weekly_digest()` is built and tested but needs a dedicated cron trigger (separate from run.py)
- Thesis button sector matching in `feed-row.tsx` uses `industry_verticals[0]` (updated 2026-04-13) but does not yet search across all verticals — improvement deferred

---

## 6. V1 / Phase 1

### Phase marker

**Phase 1 is complete. All observation steps are live.**

### Completed (Phase 1 Observation Layer — all 12 steps live)

- **Run Recorder** (PR #42, merged) — `backend/observe.py` + non-blocking hook in `backend/run.py`; writes one row to `pipeline_runs` and per-article rows to `run_articles` after each pipeline run; selected article provenance is reconstructed/inferred from ingest output. Pool query and selection reconstruction use `industry_verticals[0]` with `sector` fallback to mirror synthesize.py exactly (updated 2026-04-13).
- **Brief Critic** (PR #47, merged) — Heuristic-only quality scorer with deterministic text checks. Non-blocking step 5 in pipeline. Writes one row per run to `brief_quality_scores` table (headline_word_count, banned_phrase_hits, sections_present, top_deals_count, status, soft_flags). observe.py now returns run_id for FK linking. Validated live 2026-04-03.
- **Selection Auditor V1** (PR #48, merged) — Run-level only. `backend/audit.py` + non-blocking step 6 in pipeline. Reads `run_articles` for the given run, computes selection quality metrics (candidate/selected counts, score miss signals, sector concentration flag), and writes one row to `selection_audit`. All rows carry `provenance='reconstructed'`. No per-article claims. No LLM calls. Validated end-to-end live 2026-04-03.
- **Trend Mapper Phase 1** (PR #51, merged & live-validated 2026-04-04) — `backend/trend_mapper.py` clusters related articles into persistent/emerging narratives. Non-blocking step [7/7] in pipeline. Pure-logic clustering, mover ranking, volatility scoring. Live validation: morning run fired [7/7] TREND MAP, wrote 6 clusters to trend_clusters table, 1 underrepresented cluster flagged. First run had lookback=0, all clusters marked "emerging". Supabase schema applied. Article normalization uses `industry_verticals[0]` with `sector` fallback for all cluster key/label/similarity/surfacing logic (updated 2026-04-13).
- **Post-run Summary** (`backend/summarize.py`, step [8/12]) — Non-blocking. Reads pipeline_runs, brief_quality_scores, selection_audit, trend_clusters for the current run_id and prints a consolidated ASCII box digest to the pipeline log (GitHub Actions). No LLM calls, no new schema.
- **Thesis Grader** (`backend/thesis_grader.py`, step [9/12], morning only) — Built by Lucas. Grades theses that have a verifiable signal against market outcomes. Writes outcome back to `theses` table. Feeds `pattern_memory` step.
- **Pattern Memory** (`backend/pattern_memory.py`, step [10/12], morning only) — Built by Lucas. Scans all graded theses, builds aggregate win-rate patterns keyed on `(sector, horizon, dominant_signal)`, upserts to `pattern_library` table. Used by trend_mapper (Phase 6 boost) and summarize.py (weekly digest addendum).
- **Source Credibility** (`backend/source_credibility.py`, step [11/12], morning only) — Built by Lucas. Computes per-source win rates from graded thesis outcomes. Writes to `source_credibility_scores` table. Used by trend_mapper to weight cluster strength by contributing source quality.
- **Adversarial Review** (`backend/adversarial.py`, step [12/12], Sunday morning only) — Built by Lucas. Weekly adversarial stress-test of pipeline outputs. Non-blocking.

### Still pending (Phase 1 summaries)

- Weekly cross-run summary: `generate_weekly_digest()` in `summarize.py` is built and calls Gemini 2.5 Flash, but is invoked from a separate weekly cron — not from run.py. Writes to `weekly_digests` table. **Not yet wired to a scheduled trigger.**

### Current goal

Wire `generate_weekly_digest()` (already built in `summarize.py`) to a scheduled GitHub Actions cron via `workflow_dispatch`, then move to Phase 2.

### What is in scope now

- Morning Review and Evening Wrap only
- automatic post-run evaluation (all 12 steps)
- automatic selection auditing
- automatic trend mapping with pattern and source credibility boosts
- memory writing to Supabase (all tables live)
- weekly digest for operators (built, needs scheduling)

### What is not in scope now

- optimizer behavior
- rollback logic
- config mutation
- persona logic
- engagement optimization
- broader product surface expansion

## 7. Final Version / End-State

The final version should be a persistent intelligence engine layered on top of the core pipeline. It should not merely grade completed text. It should improve Breaking Alpha's ability to identify what matters, explain why it matters, detect second-order read-throughs, and recognize early trend formation.

### End-state capabilities

- permanently running autonomous improvement loop
- multi-run trend memory across sectors, companies, macro, and deal themes
- global analysis-pattern learning that transfers across future runs
- stronger second-order effect detection
- context-aware selection and synthesis behavior by market regime
- experiment history and config lineage
- automatic rollback and risk controls
- optional user-behavior signals later, without turning the product into clickbait optimization

### What the perfect version should do

- observe the full article universe and identify persistent, emerging, and underappreciated trend clusters
- select a more intelligent story set than raw relevance ranking alone
- produce sharper Morning Review and Evening Wrap analysis with clear second-order implications
- know when it missed a dominant theme or chose the wrong headline
- learn which trend patterns were real versus false positives
- safely improve bounded behavior over time
- generate a weekly machine-written strategy memo that informs future product work

## 8. Agent Set

### Phase 1 agents (all live)

1. **Run Recorder** (`observe.py`, step 4)
   Creates the canonical record for each run: config used, article universe, selected set, surfaced output, timing, errors, and model metadata.

2. **Brief Critic** (`critique.py`, step 5)
   Scores output quality across headline dominance, analysis depth, specificity, repetition, second-order insight quality, and usefulness of the what-to-watch framing.

3. **Selection Auditor** (`audit.py`, step 6)
   Compares the candidate corpus with selected and surfaced stories to identify missed major stories, duplicate angles, weak selections, and underrepresented themes.

4. **Trend Mapper** (`trend_mapper.py`, step 7)
   Clusters related articles into persistent or emerging narratives and scores whether those trends should have surfaced. Uses `industry_verticals[0]` (with `sector` fallback) for all sector-based clustering and pattern matching.

5. **Post-run Summarizer** (`summarize.py`, step 8)
   Prints a consolidated operator digest to the pipeline log after every run. No LLM calls, no Supabase writes in post-run mode. Also contains `generate_weekly_digest()` (standalone, not called from run.py) which writes to `weekly_digests`.

6. **Thesis Grader** (`thesis_grader.py`, step 9, morning only)
   Grades theses with verifiable signals against market outcomes. Writes outcome back to `theses` table. Feeds pattern_memory.

7. **Pattern Memory** (`pattern_memory.py`, step 10, morning only)
   Builds win-rate pattern library keyed on `(sector, horizon, dominant_signal)` from graded theses. Upserts to `pattern_library`. Consulted by trend_mapper (Phase 6 boost) and weekly digest.

8. **Source Credibility** (`source_credibility.py`, step 11, morning only)
   Computes per-source win rates from graded thesis outcomes. Writes to `source_credibility_scores`. Used by trend_mapper to weight cluster strength.

9. **Adversarial Review** (`adversarial.py`, step 12, Sunday morning only)
   Weekly adversarial stress-test of pipeline outputs. Non-blocking.

### Later agents (Phase 2+)

10. **Optimizer**
    Reviews recent run quality and later proposes or applies bounded config changes such as selection caps, diversity floors, and trend thresholds.

11. **Rollback Manager**
    Reverts to a prior config when a change worsens quality over the evaluation window.

12. **Weekly Strategist**
    Summarizes what improved, what regressed, what the system keeps missing, and what now deserves manual product work.

## 9. Data Model

**Live tables (Phase 1, all exist in Supabase):**

- **`pipeline_runs`** — one row per production run with run type, timing, config version, models used, counts, status, and notes
- **`run_articles`** — maps each run to candidate, selected, and surfaced articles with score snapshots and selection reasoning
- **`brief_quality_scores`** — structured critic scores and supporting notes (headline_pass, banned_phrase_hits, soft_flags, etc.)
- **`selection_audit`** — run-level selection quality metrics (score miss signals, sector_counts_selected as `industry_verticals[0]`-keyed JSON, sector_concentration_flag)
- **`trend_clusters`** — cluster memory, confidence, persistence, and surfacing judgment; top_sectors field stores primary industry vertical per cluster
- **`pattern_library`** — win-rate patterns keyed on `(sector, horizon, dominant_signal)`, built from graded theses by pattern_memory.py; consulted by trend_mapper and weekly digest
- **`source_credibility_scores`** — per-source win rates computed from graded thesis outcomes by source_credibility.py; used by trend_mapper to weight cluster strength
- **`weekly_digests`** — weekly operator digest rows written by summarize.generate_weekly_digest(); includes gemini_digest narrative and thesis_prompt_addendum for autonomous feedback loop

**Planned but not yet implemented:**

- **`missed_story_candidates`** — stories the system believes should have surfaced but did not (Phase 2+)

**Article taxonomy (live as of PR #85):**

Articles in Supabase now carry two independent arrays instead of a single `sector` string:
- **`industry_verticals`** — 1–3 values from 11 canonical industry categories (Technology, Healthcare & Biotech, Energy & Oil/Gas, Financial Services, Consumer & Retail, Industrials & Manufacturing, Aerospace & Defense, Real Estate, Media & Telecom, Materials & Mining, Agriculture)
- **`activity_types`** — 0–3 values from 11 canonical activity categories (M&A, IPO, Earnings, Fundraising, Macro, Geopolitics, Regulation, Public Markets, VC, PE, Restructuring)
- **`sector`** — backward-compat column, always set to `industry_verticals[0]`; observation layer reads this for legacy compatibility

**Later-phase tables (Phase 2+):**

- **`optimizer_recommendations`** — proposed config changes, rationale, risk, and apply status
- **`config_versions`** — active and historical config versions with lineage
- **`experiment_results`** — before/after deltas, verdicts, and rollback status

## 10. Tooling to Prioritize

The live production loop should run mainly as **Python services + scheduled GitHub Actions + Supabase memory**. Claude Code and related tooling should be used aggressively for development, maintenance, testing, and guardrails, but not as the fragile runtime for every live production decision.

### Best tooling fit

- Claude Code subagents
- Claude Code hooks
- Claude Code skills
- Claude Code plugins
- Claude Agent SDK later, if programmatic Claude tooling becomes necessary
- GitHub Actions with `schedule` and `workflow_dispatch`
- GitHub CLI inside Actions for orchestration and ops

## 11. Claude Skills to Build Later

These are useful later, not required for current implementation:

- `/review-run-quality`
- `/audit-trend-clusters`
- `/propose-config-change`
- `/write-weekly-strategy`
- `/rollback-evaluation`
- `/schema-health-check`

## 12. Usage and Cost Discipline

- store rich raw memory in the database
- retrieve only the slice needed for the task at hand
- use normal code for heuristics, counts, duplicates, balance, and persistence logic
- use LLM calls for judgment, diagnosis, and bounded recommendation generation only

The autonomous-improvement layer should stay materially lighter than the main content-generation pipeline.

## 13. Risks and Controls

- **Silent quality drift** → use config versioning, experiment tracking, and later automatic rollback
- **Overfitting to noise** → evaluate over rolling windows, not single runs
- **Token bloat** → pass compact summaries instead of large histories
- **False trend detection** → require cross-source corroboration and persistence thresholds
- **Over-automation** → keep code, schema, and model changes human-controlled

## 14. Build Sequence

### Phase 1 — Observation (complete ✓, all 12 steps live)

- [x] Create Supabase observation tables (`pipeline_runs`, `run_articles`)
- [x] Build Run Recorder — `backend/observe.py` + hook in `backend/run.py` (PR #42); updated 2026-04-13 to use `industry_verticals[0]` with `sector` fallback
- [x] Build Brief Critic — `backend/critique.py` + hook in `backend/run.py` (PR #47)
- [x] Build Selection Auditor V1 — `backend/audit.py` + hook in `backend/run.py` (PR #48); run-level only, provenance='reconstructed', validated live 2026-04-03
- [x] Build Trend Mapper — `backend/trend_mapper.py` + hook in `backend/run.py` (PR #51); live-validated 2026-04-04; updated 2026-04-13 to use `industry_verticals[0]` with `sector` fallback in `_normalize_article()`
- [x] Post-run operator summary — `backend/summarize.py` + step [8/12] in `backend/run.py`; reads `brief_quality_scores`, `selection_audit`, `trend_clusters` for the current run_id and prints a consolidated digest to the pipeline log (GitHub Actions); no LLM calls, no new schema, non-blocking
- [x] Thesis Grader — `backend/thesis_grader.py` + step [9/12], morning only; built by Lucas; grades theses against market outcomes; writes to `theses.outcome`
- [x] Pattern Memory — `backend/pattern_memory.py` + step [10/12], morning only; built by Lucas; upserts win-rate patterns to `pattern_library`; Phase 6 boost wired into trend_mapper
- [x] Source Credibility — `backend/source_credibility.py` + step [11/12], morning only; built by Lucas; writes per-source win rates to `source_credibility_scores`; Phase 5 boost wired into trend_mapper
- [x] Adversarial Review — `backend/adversarial.py` + step [12/12], Sunday morning only; built by Lucas; weekly stress-test, non-blocking
- [x] Dual-dimension article taxonomy — `industry_verticals` + `activity_types` arrays on all articles, `sector` retained as backward-compat (PR #85, 2026-04-13); observation layer migrated

### Phase 1 — Summaries (in progress)

- [x] Post-run operator summary — complete, runs after every pipeline run (step 8)
- [ ] Weekly cross-run summary — `generate_weekly_digest()` in `summarize.py` built and writing to `weekly_digests`, but not yet wired to a scheduled cron trigger

### Phase 2 — Safe Autonomy

- add `config_versions`, `optimizer_recommendations`, and `experiment_results`
- auto-apply green-zone config changes
- start the three-run rollback window

### Phase 3 — Analysis Transfer

- build analysis-coach logic
- promote reusable analysis patterns across future runs
- improve second-order and read-through analysis

### Phase 4 — Broader Platform Leverage

- tie the improvement layer into structured alerts, shareable cards, and content systems
- only after the intelligence core is strong and stable

## 15. Bottom Line

V1 should make Breaking Alpha self-evaluating, memory-backed, trend-aware, and ready for safe improvement. The end-state system should make Breaking Alpha feel less like a news app and more like a market-intelligence organism that gets sharper every week it operates.

That is the moat: not just AI-generated output, but a system that knows when it was weak, knows what it missed, learns from those misses, and later improves itself safely across every future Morning Review, Evening Wrap, and trend read.
