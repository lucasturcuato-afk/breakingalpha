# Autonomous Improvement Plan

## Implementation Contract

- **Current phase:** Phase 1 — Observation complete; moving to Phase 1 summaries
- **Current goal:** Record every run, critique every run, audit selection quality, and map trend clusters. ✓ Complete. Next: daily and weekly operator summaries.
- **In scope now:** Scheduled automatic post-run jobs, daily and weekly summaries for operators.
- **Not in scope yet:** Optimizer, rollback, config mutation, persona logic, and engagement optimization.
- **Source of truth:** This document governs autonomous-improvement work.
- **Implementation status:** Phase 1 observation layer complete. Run Recorder (PR #42), Brief Critic (PR #47), Selection Auditor V1 (PR #48), and Trend Mapper (PR #51) all built, merged, and live-validated. Next: scheduled summaries.

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

## 5. V1 / Phase 1

### Phase marker

**We are currently in Phase 1 — Observation only.**

### Completed (Phase 1 Observation Layer)

- **Run Recorder** (PR #42, merged) — `backend/observe.py` + non-blocking hook in `backend/run.py`; writes one row to `pipeline_runs` and per-article rows to `run_articles` after each pipeline run; selected article provenance is reconstructed/inferred from ingest output
- **Brief Critic** (PR #47, merged) — Heuristic-only quality scorer with deterministic text checks. Non-blocking step 5 in pipeline. Writes one row per run to `brief_quality_scores` table (headline_word_count, banned_phrase_hits, sections_present, top_deals_count, status, soft_flags). observe.py now returns run_id for FK linking. Validated live 2026-04-03.
- **Selection Auditor V1** (PR #48, merged) — Run-level only. `backend/audit.py` + non-blocking step 6 in pipeline. Reads `run_articles` for the given run, computes selection quality metrics (candidate/selected counts, score miss signals, sector concentration flag), and writes one row to `selection_audit`. All rows carry `provenance='reconstructed'`. No per-article claims. No LLM calls. Validated end-to-end live 2026-04-03.
- **Trend Mapper Phase 1** (PR #51, merged & live-validated 2026-04-04) — `backend/trend_mapper.py` clusters related articles into persistent/emerging narratives. Non-blocking step [7/7] in pipeline. Pure-logic clustering, mover ranking, volatility scoring. Live validation: morning run fired [7/7] TREND MAP, wrote 6 clusters to trend_clusters table, 1 underrepresented cluster flagged. First run had lookback=0, all clusters marked "emerging". Supabase schema applied.

### Still pending (Phase 1 summaries)

- scheduled automatic post-run jobs
- daily and weekly summaries for operators

### Current goal

Complete Phase 1 summary automation:

- scheduled daily summary (top trends, sector momentum, key misses, quality metrics)
- scheduled weekly summary (week-over-week trend progression, missed narratives, operator alerts)

### What is in scope now

- Morning Review and Evening Wrap only
- automatic post-run evaluation
- automatic selection auditing
- automatic trend mapping
- memory writing to Supabase
- daily and weekly summaries for operators

### What is not in scope now

- optimizer behavior
- rollback logic
- config mutation
- persona logic
- engagement optimization
- broader product surface expansion

### Practical constraint for implementation

Avoid `backend/synthesize.py` if possible during Phase 1 because of open PR overlap. Prefer additive observation-layer work that minimizes conflict with active synthesis changes.

## 6. Final Version / End-State

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

## 7. Agent Set

### Phase 1 agents

1. **Run Recorder**  
   Creates the canonical record for each run: config used, article universe, selected set, surfaced output, timing, errors, and model metadata.

2. **Brief Critic**  
   Scores output quality across headline dominance, analysis depth, specificity, repetition, second-order insight quality, and usefulness of the what-to-watch framing.

3. **Selection Auditor**  
   Compares the candidate corpus with selected and surfaced stories to identify missed major stories, duplicate angles, weak selections, and underrepresented themes.

4. **Trend Mapper**  
   Clusters related articles into persistent or emerging narratives and scores whether those trends should have surfaced.

### Later agents

5. **Optimizer**  
   Reviews recent run quality and later proposes or applies bounded config changes such as selection caps, diversity floors, and trend thresholds.

6. **Rollback Manager**  
   Reverts to a prior config when a change worsens quality over the evaluation window.

7. **Weekly Strategist**  
   Summarizes what improved, what regressed, what the system keeps missing, and what now deserves manual product work.

## 8. Data Model

Recommended tables:

- **`pipeline_runs`** — one row per production run with run type, timing, config version, models used, counts, status, and notes
- **`run_articles`** — maps each run to candidate, selected, and surfaced articles with score snapshots and selection reasoning
- **`brief_quality_scores`** — structured critic scores and supporting notes
- **`missed_story_candidates`** — stories the system believes should have surfaced but did not
- **`trend_clusters`** — cluster memory, confidence, persistence, and surfacing judgment

Later-phase tables:

- **`optimizer_recommendations`** — proposed config changes, rationale, risk, and apply status
- **`config_versions`** — active and historical config versions with lineage
- **`experiment_results`** — before/after deltas, verdicts, and rollback status

## 9. Tooling to Prioritize

The live production loop should run mainly as **Python services + scheduled GitHub Actions + Supabase memory**. Claude Code and related tooling should be used aggressively for development, maintenance, testing, and guardrails, but not as the fragile runtime for every live production decision.

### Best tooling fit

- Claude Code subagents
- Claude Code hooks
- Claude Code skills
- Claude Code plugins
- Claude Agent SDK later, if programmatic Claude tooling becomes necessary
- GitHub Actions with `schedule` and `workflow_dispatch`
- GitHub CLI inside Actions for orchestration and ops

## 10. Claude Skills to Build Later

These are useful later, not required for current implementation:

- `/review-run-quality`
- `/audit-trend-clusters`
- `/propose-config-change`
- `/write-weekly-strategy`
- `/rollback-evaluation`
- `/schema-health-check`

## 11. Usage and Cost Discipline

- store rich raw memory in the database
- retrieve only the slice needed for the task at hand
- use normal code for heuristics, counts, duplicates, balance, and persistence logic
- use LLM calls for judgment, diagnosis, and bounded recommendation generation only

The autonomous-improvement layer should stay materially lighter than the main content-generation pipeline.

## 12. Risks and Controls

- **Silent quality drift** → use config versioning, experiment tracking, and later automatic rollback
- **Overfitting to noise** → evaluate over rolling windows, not single runs
- **Token bloat** → pass compact summaries instead of large histories
- **False trend detection** → require cross-source corroboration and persistence thresholds
- **Over-automation** → keep code, schema, and model changes human-controlled

## 13. Build Sequence

### Phase 1 — Observation (complete ✓)

- [x] Create Supabase observation tables (`pipeline_runs`, `run_articles`)
- [x] Build Run Recorder — `backend/observe.py` + hook in `backend/run.py` (PR #42)
- [x] Build Brief Critic — `backend/critique.py` + hook in `backend/run.py` (PR #47)
- [x] Build Selection Auditor V1 — `backend/audit.py` + hook in `backend/run.py` (PR #48); run-level only, provenance='reconstructed', validated live 2026-04-03
- [x] Build Trend Mapper — `backend/trend_mapper.py` + hook in `backend/run.py` (PR #51); live-validated 2026-04-04 with real pipeline run

### Phase 1 — Summaries (in progress)

- [ ] Schedule automatic post-run jobs
- [ ] Write daily and weekly summaries

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

## 14. Bottom Line

V1 should make Breaking Alpha self-evaluating, memory-backed, trend-aware, and ready for safe improvement. The end-state system should make Breaking Alpha feel less like a news app and more like a market-intelligence organism that gets sharper every week it operates.

That is the moat: not just AI-generated output, but a system that knows when it was weak, knows what it missed, learns from those misses, and later improves itself safely across every future Morning Review, Evening Wrap, and trend read.
