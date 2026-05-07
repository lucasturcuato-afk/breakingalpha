# Signalera: Learning Substrate Plan

**Author:** Lucas
**Date:** May 4, 2026
**Status:** Phase 1 in flight, debugging Step 3
**Audience:** Hanning

---

## TL;DR

We're building Signalera's structural moat: a learning substrate that grades every AI output against reality and feeds those learnings back into generation. After 90 days of real usage, every memo, brief, chat answer, and contrarian signal will be measurably sharper than it was at beta launch — without a single new feature shipping. That's the thesis.

This doc walks through what's been built (Phase 1, mostly done), what's actively being debugged (Step 3 wiring gaps), and what's queued (Steps 4–20 across four phases). Skim the phase summaries first, then the granular table at the end.

---

## Why this architecture, not "more sources"

Coverage is not a moat. Bloomberg has more articles than we ever will. Perplexity has more. Google has more. If "comprehensive ingest" is the bet, we lose to anyone with more capital in 18 months.

The actual defensible moat lives in the intersection of three things:

1. **Coverage that's good enough** (~85–90% of what TIS-tier users would ever want — primary sources, wires, top financial press, curated FinTwit/newsletters, transcripts). Past 90% costs more than it returns.

2. **Personalization per user.** Every interaction (scroll, click, dwell, save, generate, dismiss) is signal. After 60 days, Lucas's brief is meaningfully different from Noah's. A competitor launching tomorrow with 10x our content has zero personalization data — they cannot manufacture user-interaction history.

3. **Outcome-graded intelligence.** Every memo, brief, chat answer, contrarian signal gets retrospectively graded against reality. Did the thesis play out? Was the cluster matter? Was the bear case right? Other AI products are judged on plausibility ("does this sound smart"). We get judged on accuracy ("was this right"). That's an entirely different epistemic category, and a competitor cannot fake it without months of graded history.

The substrate work below is what makes (2) and (3) physically possible. Everything else (more sources, mobile, alerting, monetization) is incremental on top of this foundation.

---

## Roadmap at a glance

| Phase | Steps | Status | What it does |
|-------|-------|--------|--------------|
| **Phase 1: Learning Substrate** | 1–6 | In progress (debugging Step 3) | Infrastructure for capturing, grading, learning from every output |
| **Phase 2: Coverage Expansion** | 7–12 | Queued | EDGAR, wires, transcripts, expert voices, Google News, international |
| **Phase 3: Personalization** | 13–16 | Queued | Per-user embeddings, ranking, cross-user pattern emergence |
| **Phase 4: Make the Moat Visible** | 17–20 | Queued | Public accuracy dashboard, mention-velocity alerts, cross-reference graph |

Phases 2–4 are sequenced after Phase 1 deliberately. Without the substrate in place, every new source just adds noise. With it, every new source improves the system.

---

## Phase 1: Learning Substrate

### The architecture

Three nightly loops on top of a shared `outputs` table:

1. **Generation → outputs row.** Every AI output (memo, brief, brief_section, chat answer, thesis, contrarian signal, deal extraction, user addendum) writes a row to `outputs` with full generation context (model, prompt version, input article IDs, user profile snapshot).

2. **Frontend → output_user_feedback.** Every user interaction with a rendered output (viewport entry, dwell time, scroll depth, click, save, share, export, thumbs, text feedback) flows into a per-user feedback table.

3. **Outcome evaluator (nightly cron).** For every output older than 7/30/60/90 days, run an LLM evaluator against it: "this output predicted/claimed X. Here's what actually happened. Score from -1 to +1 with evidence." Writes back to `outputs.outcome_score`.

4. **Learning extractor (nightly cron).** Reads graded outputs, extracts patterns: "memos with prompt v3 on inputs from {tech, biotech} sectors score 0.34 higher on 60-day windows." Writes findings to `signalera_learnings`.

5. **Generation reads learnings.** Every generation function reads from `signalera_learnings` before generating. Picks best-performing prompt versions, weights inputs based on what historically correlated with good outcomes, calibrates confidence empirically.

The compounding loop closes at Step 6. After that, every output Signalera produces feeds back into making the next output sharper.

### Step-by-step

#### Step 1 — `outputs` table ✅ Done

Created the universal table that captures every AI-generated output across the product. Schema includes:
- `output_type` enum (memo, brief, brief_section, brief_cluster, chat_answer, thesis, thesis_grade, contrarian_signal, deal_extraction, user_addendum, mention_alert, cross_reference)
- `source_table` + `source_id` soft references to feature tables (theses, briefings, deal_flow, etc.) — polymorphic by design, not real FKs
- `content` JSONB for primary storage of ephemeral outputs (memos, chat) and minimal redundant content for outputs already persisted in feature tables
- `generation_context` JSONB for model/prompt/input metadata
- Feedback fields (later moved to `output_user_feedback` per-user table — see Step 3)
- Outcome fields: `outcome_score`, `outcome_window_days`, `outcome_evidence`, `outcome_checked_at`, `outcome_grader_version`
- 5 partial indices for hot paths: user+type+created, type+created, source lookup, ungraded, graded-by-type
- RLS: users read/update their own outputs; backend service role bypasses for writes

#### Step 2 — Wire all generators to `outputs` ✅ Done

Retrofit every generator across backend Python and Next.js API routes to write to `outputs` after generating. Plus shared helpers (`record_output()` in Python, `recordOutput()` in TS) and prompt version constants.

7 of 9 generator paths wired:
- `backend/synthesize.py` → brief
- `backend/adversarial.py` → contrarian_signal
- `backend/thesis_generator.py` → thesis (backend)
- `backend/thesis_grader.py` → thesis_grade
- `backend/deal_extractor.py` → deal_extraction
- `backend/user_synthesis.py` → user_addendum
- `src/app/api/memo/route.ts` → memo (NEW persistence — was previously ephemeral)
- `src/app/api/intelligence/route.ts` → chat_answer (NEW persistence — also previously ephemeral)
- `src/app/api/theses/route.ts` → thesis (frontend)

Two deferrals, both honest:
- **Inline thesis inserts** in `morning-brief/page.tsx`, `evening-wrap/page.tsx`, `dc-analyst-section.tsx` — these create theses directly from client components and can't write outputs without a service role client. Fix is to refactor all thesis creation through `/api/theses`. Deferred to a separate focused PR.
- **Brief clusters** — original spec assumed `briefings.sections` was a structured cluster array. Investigation revealed it's a `{section_name: text_narrative}` dict from Gemini. Real clusters live in `trend_clusters`. Pivoted to Step 2.5 (brief sections instead).

`/api/memo` and `/api/intelligence` now return `output_id` in their JSON responses so the frontend can attach feedback later.

#### Step 2.5 — Wire brief sections ✅ Done

After Claude Code's investigation revealed the cluster premise was wrong, we pivoted: track the LLM-generated narrative sections (deals_and_ma, public_markets, macro_and_rates, geopolitics, sector_spotlight/tomorrow_setup, what_to_watch) instead of the trend_clusters.

For each non-empty section in a generated brief, write one `brief_section` outputs row containing:
- `section_key` (stable across runs, for cross-run analytics)
- `section_render_id` (UUID per render, for per-render addressability)
- Section text excerpt + length
- Source linkage to parent `briefings.id`

Required a one-liner enum migration:
```sql
ALTER TYPE output_type_enum ADD VALUE IF NOT EXISTS 'brief_section';
```

`brief_cluster` enum value stays reserved for future trend_clusters wiring (Phase 4 cross-reference graph work).

#### Step 2 follow-up: inline thesis insert refactor ⏸️ Deferred

When users hit "Create Thesis" inline on the morning-brief or evening-wrap pages, the insert happens client-side directly to `theses`, bypassing `/api/theses`. Without a service role client, we can't `recordOutput()` from these paths.

Fix: route all thesis creation through `/api/theses` POST endpoint. Touches:
- `src/app/morning-brief/page.tsx`
- `src/app/evening-wrap/page.tsx`
- `src/components/brief/dc-analyst-section.tsx`

Not blocking the substrate work. Will land as its own PR after Step 6.

#### Step 3 — Frontend feedback collector 🔧 Debugging

Three layers:
1. `/api/outputs/feedback` POST endpoint — receives batched events, scoped to authenticated user, upserts to `output_user_feedback` keyed on (output_id, user_id)
2. `useOutputFeedback` React hook — IntersectionObserver for viewport entry/exit + dwell, scroll depth tracker, action functions for click/save/share/export/thumbs/text feedback
3. Component wiring across MemoModal, IntelligenceChat, BriefSection, DCAnalystSection, ThesisCard

Architecture decisions:
- New `output_user_feedback` table (not `outputs.user_*` columns) so shared outputs (briefs, theses, brief_sections) can have per-user feedback. Originally over-indexed on aggregate feedback at the output level which would have lost personalization signal.
- Module-level batched flush queue, 3-second flush interval, sendBeacon on unload to survive page exits
- Hook silently no-ops when `output_id` is null (defensive)
- ThumbsControl is additive UI that doesn't conflict with existing thesis approve/dismiss flows

**Current debugging:** Lucas reported missing ThumbsControl UI on memos and chat answers despite the wiring report claiming completion. Diagnostic revealed:
- `output_user_feedback` table exists, has 0 rows
- `outputs` table has 1 row total (a memo from today)
- Memo's `output_id` was returned successfully — the API write path works end-to-end
- But ThumbsControl is gated on `memoOutputId` being truthy and isn't rendering

Root cause likely a prop name mismatch between API response and component expectation. Surgical fix prompt being written.

The bigger issue surfaced by the diagnostic: **Step 2's backend pipeline wiring has never actually run.** Last evening pipeline run was April 30 (freshness-fix verification), before any of this code merged. Fix: trigger a manual evening run on the feature branch, watch logs for `[outputs] Recorded N brief_section outputs` lines, verify rows appear in `outputs` for brief / brief_section / contrarian / etc.

#### Step 4 — Outcome evaluator (nightly cron) ⏳ Queued

Backend Python job, runs nightly. For each row in `outputs` where `outcome_checked_at IS NULL` AND `created_at` is older than the relevant window (7/30/60/90 days):
- Build a window-appropriate outcome prompt for the output type (memos check thesis validity against subsequent news + price action; briefs check whether clusters mattered by being referenced again; chat answers check factual accuracy; contrarian signals check whether bear cases materialized)
- Call LLM evaluator with the original output + its `generation_context` + relevant subsequent data
- Score from -1 (completely wrong) to +1 (completely right)
- Write `outcome_score`, `outcome_evidence`, `outcome_checked_at`, `outcome_grader_version` back to the row

Will need:
- New module `backend/outcome_evaluator.py`
- Per-output-type prompt templates
- Integration with existing GitHub Actions cron infrastructure
- Cost tracking — this is the most expensive nightly job, will run on every output that ages into a window

The single most important thing about Step 4: it's the only feature where Signalera has a ground-truth signal. Everything else in the substrate is data collection. This is where data becomes truth.

#### Step 5 — Learning extractor (nightly cron) ⏳ Queued

Reads graded outputs, extracts patterns, writes findings to a new `signalera_learnings` table.

For each output type, compute:
- Which prompt versions correlate with high outcome scores
- Which input contexts (article counts, source mix, ticker types, sectors) correlate with high outcome scores
- Which user-engagement patterns correlate with output quality
- Which generation contexts (time of day, market regime, user profile shape) correlate with high outcome scores

`signalera_learnings` schema:
```
id UUID PK
output_type TEXT
pattern_type TEXT  -- 'prompt_version' | 'input_context' | 'engagement' | 'regime'
pattern_key TEXT
pattern_value JSONB
sample_size INT
avg_outcome_score NUMERIC
confidence_interval NUMERIC
updated_at TIMESTAMPTZ
```

Statistical pattern detection job. SQL-heavy, requires careful sample-size thresholds before patterns get acted on (rule of thumb: 30+ samples before a learning is "live").

#### Step 6 — Wire learnings back into generation ⏳ Queued

Every generation function reads from `signalera_learnings` before generating, and applies what's been learned:
- **Prompt selection.** Pick the highest-scoring prompt version for this output type given the input context.
- **Context weighting.** Weight inputs based on what historically correlated with good outcomes for similar contexts.
- **Confidence calibration.** Adjust confidence scores based on empirical accuracy of similar past outputs.
- **Refusal logic.** If the input pattern correlates with historically bad outputs (e.g., trying to grade a thesis on a ticker we've never been right about), generate with lower confidence or skip entirely.

This is the riskiest single PR in the whole substrate. If Step 5's pattern extraction has a subtle bug, Step 6 silently applies bad learnings to every output. Critical to ship Steps 4 and 5 first, run them for a week, manually inspect what `signalera_learnings` contains, and only then wire Step 6.

**After Step 6 ships, Signalera is structurally a learning system.** Every output produced feeds back into making the next output sharper. The compounding loop is closed.

---

## Phase 2: Coverage Expansion

Sequenced after the learning substrate is locked in, so every new source improves the system rather than just adding volume.

#### Step 7 — SEC EDGAR ingestion ⏳ Queued

Primary source layer: 8-K, 10-Q, 10-K, 13F, S-1, Form 4. Direct ingest from EDGAR's JSON API. Each filing flows through synthesize → generates outputs → gets graded → contributes to learnings.

This is the highest-leverage single coverage addition. SEC filings are primary-source material company news with no editorialization, no paywall, ~5 minute latency from event to public availability. Most "AI news" startups don't ingest filings because they're harder to parse than RSS — that's the moat opportunity.

Watch for: ticker-to-CIK mapping (we have 52 unresolved watchlist entries today per Noah's audit, this overlaps with the entity resolution work).

#### Step 8 — Press wires ⏳ Queued

Business Wire, PR Newswire, GlobeNewswire, Accesswire. All have RSS feeds with free APIs. Direct ingestion = we're 15–60 min ahead of financial media coverage.

Latency edge, not coverage edge. Worth doing because it's cheap and primary-source.

#### Step 9 — Earnings transcripts ⏳ Queued

Whisper-based pipeline on call audio. Becomes a new input type for memo generation and brief synthesis. Audio sourcing is the risky part — likely paths are AlphaSense API (paid, possible USC library access), or scraping calendar + audio directly.

When this ships, we have a content layer no other AI news startup has. Differentiator-tier feature.

#### Step 10 — Curated expert voices ⏳ Queued

~30 newsletters via Substack RSS, ~200 FinTwit accounts via X Basic API ($200/mo), ~5 high-signal Reddit subs (r/investing, r/SecurityAnalysis, r/wallstreetbets) via Reddit API. Tagged as "expert opinion" tier so synthesis weights them differently from wire copy.

The list selection itself is product work — bad accounts poison output for every user. Need a curation pass before code.

#### Step 11 — Google News meta-feed ⏳ Queued

Per-company RSS query against Google News indexes effectively all financial publishers. Single change takes coverage from ~20 RSS feeds to ~75,000 publishers.

**Scheduled last on purpose.** Google News floods the system with low-quality, high-volume, heavily-redundant content. By the time we get here, dedup, source ranking, and learning systems are mature enough to handle the noise. Done first, it would have poisoned everything.

#### Step 12 — International expansion ⏳ Queued

Nikkei Asia, SCMP, Reuters Asia, Reuters Europe. Lowest priority for current US-focused TIS users, but expands surface area for any user researching foreign-listed names (TSMC, ASML, etc.).

---

## Phase 3: Personalization

Now that we have user interaction data + outcome data, real personalization becomes possible.

#### Step 13 — Per-user preference embedding ⏳ Queued

For each user, compute a vector embedding from their interaction history (which outputs they engaged with, dwelled on, generated memos from, thumbed up). Updated nightly. Stored on `user_profiles` or in a new `user_preference_embeddings` table.

#### Step 14 — Personalized output ranking ⏳ Queued

When generating a brief for a specific user, rank candidate sections/clusters/stories by similarity to their preference embedding. The brief is now structurally different per user — same shared underlying content, personalized presentation order and weighting.

Important: this is presentation personalization, not generation personalization. The brief itself is still shared (same clusters, same wording, same `briefings` row), just rendered differently per user. Per-user generation would be 75x inference cost for marginal benefit and would lose the shared-context property that makes a brief discussable across users.

#### Step 15 — Personalized confidence calibration ⏳ Queued

Outcome grading is now per-user. Does this user's engagement pattern predict their satisfaction with this kind of output? Confidence scores get adjusted by user. "Lucas tends to engage with high-conviction macro takes; Noah prefers granular sector-specific theses" becomes empirical, not anecdotal.

#### Step 16 — Cross-user pattern emergence ⏳ Queued

Cluster users by preference embedding similarity. New users get warm-started by being matched to existing clusters. "Users like you found this useful" becomes a real signal, not a guess. This is the network effect — every new user makes the system smarter for the next user.

---

## Phase 4: Make the Moat Visible

The infrastructure built in Phases 1–3 is invisible to users. Phase 4 is when it becomes felt.

#### Step 17 — Public accuracy dashboard ⏳ Queued

On the marketing site and in-product: "Signalera memos with confidence >0.7 hit their thesis 64% of the time over 60 days. Average analyst hit rate: 47%." Computed live from `outputs` outcome scores.

This is our single best marketing asset. It's also impossible for a competitor to fake — they'd need months of graded history.

#### Step 18 — User-facing personalization receipts ⏳ Queued

In-product: "This brief weighted semis 2.3x higher than baseline because of your engagement pattern over 30 days." Makes the moat felt, not just real. Increases stickiness — users stop being able to imagine using a non-personalized alternative.

#### Step 19 — Mention-velocity alerting ⏳ Queued

Now that we have months of baseline data per ticker per source, anomaly detection is sharp. Push alerts when watchlist tickers spike significantly above baseline.

This is the feature that makes Signalera live in a user's pocket during market hours, not just at 6 AM and 5 PM. Daily active usage approximately doubles.

#### Step 20 — Cross-reference graph surface ⏳ Queued

The entity-event-source-user graph that's been densifying since Phase 1 now has enough density to surface non-obvious connections: "This 13F filing + this Substack post + this earnings transcript paragraph all point at the same emerging thesis."

This is the highest-end output and the one no competitor can replicate. By the time we ship it, it requires 6+ months of accumulated graph data to function.

---

## Granular status table

| # | Step | Phase | Status | Notes |
|---|------|-------|--------|-------|
| 1 | Outputs table | 1 | ✅ Done | 5 indices, RLS, trigger all clean |
| 2 | Wire all generators | 1 | ✅ Done | 7 of 9 paths wired, 1 deferred (inline theses), 1 pivoted (clusters → sections) |
| 2.5 | Wire brief sections | 1 | ✅ Done | section_key + render UUID, ALTER TYPE migration applied |
| — | Inline thesis refactor | 1 | ⏸️ Deferred | Separate PR after Step 6 |
| 3 | Frontend feedback collector | 1 | 🔧 Debugging | Wiring complete per Claude Code, but ThumbsControl gating + missing pipeline run = 0 feedback rows. Fix in progress. |
| 4 | Outcome evaluator (nightly cron) | 1 | ⏳ Queued | Most expensive job. Critical because it's the only ground-truth signal in the whole system. |
| 5 | Learning extractor (nightly cron) | 1 | ⏳ Queued | Statistical pattern detection. Run for a week before wiring Step 6. |
| 6 | Wire learnings into generation | 1 | ⏳ Queued | Riskiest single PR. Closes the compounding loop. |
| 7 | SEC EDGAR ingestion | 2 | ⏳ Queued | Highest-leverage coverage step. Overlaps with entity resolution. |
| 8 | Press wires | 2 | ⏳ Queued | Latency edge, low engineering cost. |
| 9 | Earnings transcripts | 2 | ⏳ Queued | Differentiator-tier. Audio sourcing is the risky path. |
| 10 | Curated expert voices | 2 | ⏳ Queued | Curation work before code. |
| 11 | Google News meta-feed | 2 | ⏳ Queued | Last on purpose. Learning systems must be mature first. |
| 12 | International expansion | 2 | ⏳ Queued | Lowest coverage priority for current user base. |
| 13 | Per-user preference embedding | 3 | ⏳ Queued | Foundational for Phase 3. |
| 14 | Personalized output ranking | 3 | ⏳ Queued | Presentation personalization, not generation. |
| 15 | Personalized confidence calibration | 3 | ⏳ Queued | Per-user empirical accuracy. |
| 16 | Cross-user pattern emergence | 3 | ⏳ Queued | Network effect kicks in here. |
| 17 | Public accuracy dashboard | 4 | ⏳ Queued | Best marketing asset we'll ever have. |
| 18 | User-facing personalization receipts | 4 | ⏳ Queued | Stickiness driver. |
| 19 | Mention-velocity alerting | 4 | ⏳ Queued | Doubles DAU. |
| 20 | Cross-reference graph surface | 4 | ⏳ Queued | The "no one else does this" feature. |

---

## What's adjacent but not in this plan

Things being worked on in parallel that are not part of the substrate but interact with it:

- **Entity resolution (W2-A through W2-H, Noah's lane).** Alias table + canonical_id FK swap on `companies` table to fix the NVIDIA-fragmented-3-ways problem and the 52 unresolved watchlist entries. Ingest writes pass through this. Locked in via async earlier — Strategy A approved with four pinned implementation details (Wikidata flip in same PR, unicode normalization at alias insert, ambiguity fallback rule explicit in design doc, watchlist backfill scoped same week).

- **Domain migration to signalera.ai.** Currently in flight, DNS configured at Porkbun (A → 216.150.1.1, www CNAME → cname.vercel-dns.com), Vercel awaiting propagation. Need to update `NEXT_PUBLIC_SITE_URL` env + Supabase auth redirect URLs once live.

- **Onboarding tour.** Driver.js-based interactive tour, auto-trigger first time + persistent `?` button, 8 steps covering all 6 features. Uses `tour_completed_v1` flag on `user_profiles`. Ready to ship as a separate PR.

- **PR #175 (brief email polish).** Sitting as draft pending Resend API key on Signalera org. Noah setting up.

---

## Open questions / things to gut-check

1. **Step 4 cost.** Outcome evaluator is the most expensive nightly job we'll have. Need to model cost per output type per window. Likely path: cheap model (Gemini Flash) for first-pass scoring, expensive model only for ambiguous cases. Worth Hanning's read on the cost-tier strategy.

2. **Sample size thresholds for Step 5.** What's the minimum N before a learning is "live" and actually applied in Step 6? Statistically 30 is the rule of thumb but for high-stakes outputs (memos with confidence calibration) we may want 100+. Want Hanning's input on calibration discipline.

3. **Should Step 6 ship behind a feature flag?** First version applies learnings to all generation. If a bad pattern slips through Step 5, it silently degrades every output. Argument for a flag: safer rollout. Argument against: flagged code that runs differently from production is its own bug surface. Leaning toward shipping unflagged but with tight monitoring on first week's outcome scores.

4. **When does Phase 2 start.** Don't want to start coverage expansion until Phase 1 is fully closed-loop (through Step 6). But don't want to delay Phase 2 indefinitely either. Realistic gate: Step 6 ships clean + 2 weeks of observation showing learnings are stable and outputs aren't regressing.

---

## What I want from you

- **Phase 1 architecture sign-off.** Any structural concerns about the substrate design before we go deeper than Step 4.
- **Step 4 cost-tier strategy input.** Cheap-first or expensive-throughout?
- **Phase 2 sequencing input.** Does the order (EDGAR → wires → transcripts → expert voices → Google News → international) match your priors, or do you want to reorder?
- **Whether you want to take any of the Phase 2/3/4 steps as primary lead.** Some of these (especially transcripts in Step 9 and the cross-reference graph in Step 20) are isolated enough to be owned independently.

No rush. Read when you have time and ping when you want to walk through any of it.
