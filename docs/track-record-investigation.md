# Track Record Investigation — Continuous In-Flight Grading

**Author:** Wave 1 / w1/track-record-live-grading
**Date:** 2026-04-30
**Branch:** w1/track-record-live-grading

---

## 1. Symptom

The Track Record page (`src/app/track-record/page.tsx`) renders 0% across every
sector and shows the "Building track record — check back after more theses are
graded" copy on multiple surfaces. Header reports `12 theses tracked` but the
"Confirmed" stat card shows `1`.

7 of the 12 graded theses sit at **Inconclusive** because the grader rubric
defaults to `verdict = "inconclusive"` whenever:

- Gemini parse fails (soft-fail), OR
- The Gemini system prompt's strict rules trigger:
  > "Default to 'inconclusive' with confidence <= 0.4 when evidence is thin or
  > contradictory."
  > "Use 'confirmed' only when the verifiable_signal has materialised AND
  > contradicting signals are weak."
  > "Use 'invalidated' only when the verifiable_signal has clearly moved the
  > wrong way."

Net: the rubric rewards no movement with "Inconclusive" rather than surfacing
the in-flight direction. A thesis at +15% with a bullish stance ought to show as
"Tracking confirmed" even before the rubric calls it terminal.

## 2. Why theses are stuck at "Inconclusive"

| Cause | Evidence |
|---|---|
| Strict Gemini rubric | `backend/thesis_grader.py` `_VERDICT_SYSTEM` system prompt biases toward `inconclusive` |
| Conviction maps to `0.0` | `backend/grading/features.py` `_weighted_sentiment_alignment` only honours conviction `BULLISH` / `BEARISH`. Today's theses use `HIGH` / `MEDIUM` / `WATCH` from `thesis_generator.py`, so directional sentiment alignment is always zero |
| Soft-fail returns `inconclusive` | Any Gemini parse error / API failure → `_soft_fail_verdict("...")` → `verdict="inconclusive"` |
| No interim verdict | `thesis_grader.main()` only re-grades theses past `check_after`, so theses inside their horizon never refresh; the page only reads `theses.outcome` mirror |
| Page UI is binary | `src/app/track-record/page.tsx` `OutcomeBadge` only knows confirmed/invalidated/inconclusive — no "tracking" state |

## 3. Track Record header vs stat card mismatch

`page.tsx`:

- Header: `trackedCount` = distinct theses with **any** entry in `thesis_verdicts`
- Stat card "Total Theses": `totalCount` = `count(*) from theses` (12)
- Stat card "Confirmed": only theses whose latest verdict is `confirmed` (1)

So the "12" and "1" are both correct individually but render as a single
contradictory surface. We unify: **all stat cards derive from the same source
of truth** (the live_score-derived universe).

## 4. The 12 theses — current state snapshot (2026-04-30)

The page reads from `theses` + `thesis_verdicts` (latest verdict per
`thesis_id`). Per the symptom above, 12 rows in `theses`, 12 latest verdicts in
`thesis_verdicts`, distribution roughly:

| Verdict | Count |
|---|---|
| confirmed | 1 |
| invalidated | ~4 |
| inconclusive | 7 |

Each thesis carries: `id, title, sector, ticker, conviction, generated_at,
check_after, verifiable_signal, supporting_articles, signal_breakdown,
adversarial_score`. `signal_breakdown` (jsonb) holds the latest Finnhub bundle:
`price_change_pct`, `options_flow`, `earnings_surprise`, `news_velocity`,
`analyst_consensus`. The latest `thesis_verdicts` row also has
`weighted_sentiment_alignment`, `tag_overlap_count`,
`supporting_vs_contradicting_ratio`, `time_elapsed_days`, `confidence`.

This is enough to compute a continuous `live_score` without changing
`backend/synthesize.py` or `backend/ingest.py`.

## 5. Design — `live_score` (-100 to +100)

`live_score` is a signed integer. Positive = thesis is tracking confirmed,
negative = tracking invalidated, zero = neutral.

### Components (sum, then clamp to [-100, +100])

| Component | Range | Source |
|---|---|---|
| Price alignment | -50 .. +50 | `signal_breakdown.price_change_pct` × stance direction |
| Sentiment alignment | -25 .. +25 | latest `thesis_verdicts.weighted_sentiment_alignment` × 25 |
| Supporting / contradicting ratio | -15 .. +15 | clamped log of `supporting_vs_contradicting_ratio`, signed by stance |
| Confidence boost | 0 .. +10 | `thesis_verdicts.confidence` × 10, only applied when verdict is `confirmed` (and negated for `invalidated`) |
| Time decay | 0 .. -10 | linear: `min(time_elapsed_days / horizon_days, 1.0) × 10`, only when no terminal verdict has fired (older theses without movement get pulled toward zero) |

### Stance direction

`conviction` is a string in `{"HIGH","MEDIUM","WATCH","BULLISH","BEARISH"}`.

- `BEARISH` → -1
- `BULLISH` / `HIGH` / `MEDIUM` → +1 (HIGH and MEDIUM are conviction strength
  flags emitted by the new thesis_generator and read as "directionally
  positive" — the bull/bear signed direction is implicit in the thesis text and
  should be backfilled in Wave 2; for now `WATCH` → 0)
- `WATCH` / unknown / null → 0

### Derived `live_verdict`

| live_score | terminal verdict | live_verdict label |
|---|---|---|
| n/a | `confirmed` | "Confirmed" |
| n/a | `invalidated` | "Invalidated" |
| ≥ +35 | else | "Tracking confirmed" |
| ≤ -35 | else | "Tracking invalidated" |
| -10 .. +10 (and time_elapsed ≥ horizon) | `inconclusive` | "Inconclusive after Nd" |
| else | else | "Tracking neutral" |

Tracking labels render with **lighter chip styling and italic text** to keep
them visually distinct from terminal verdicts.

### Two candidate alternatives (PR description will mention)

- **Formula B (multiplicative)**: `live_score = stance_dir × (price_pct × 5 + sentiment × 25 + ratio_score × 10) + confidence_term + time_term`. Easier to interpret per signal but more sensitive to one extreme component.
- **Formula C (logistic)**: feed weighted sum through `tanh(x / 50) × 100`. Smoother distribution but compresses small movements into invisibility.

Going with **Formula A (additive + clamp)** as the default — it's transparent,
easy to debug field-by-field on the page, and matches how the existing
`thesis_verdicts.signals_weighted` jsonb is already structured.

## 6. Cadence

**Daily.** The grader already runs daily at 8:10 PM PT via
`.github/workflows/grading.yml`. `live_score` rides the same pulse:

1. `daily_grading.py` runs `thesis_grader.main()` (existing).
2. Then runs the new `backend.grading.live_score.update_all_live_scores()`
   which loops all non-locked theses, recomputes `live_score` /
   `live_verdict` / `live_score_updated_at`, and writes them to a new
   `theses.live_score`, `theses.live_verdict`, `theses.live_score_updated_at`
   columns (DDL: `sql/live_score_columns.sql`).

Hourly was rejected because:

- `signal_breakdown.price_change_pct` is `dp` from `/quote` — already a
  daily-resolution metric (percent change from previous close).
- `thesis_verdicts` only refreshes when `thesis_grader` runs, so hourly
  recomputes would pull stale alignment numbers between grader runs.
- The page also computes `live_score` client-side from the same fields, so
  intra-day staleness is bridged for free without burning grader budget.

## 7. Frontend strategy — non-blocking on backend deploy

The page computes `live_score` **on the fly in the browser** from the existing
columns it already reads (`theses.signal_breakdown`, latest
`thesis_verdicts.{weighted_sentiment_alignment, supporting_vs_contradicting_ratio,
confidence, time_elapsed_days}`, `theses.conviction`, `theses.generated_at`,
`theses.horizon`, latest `verdict`). If the new `theses.live_score` column
exists (DDL applied), it's preferred. If not, the client computation is
authoritative.

Net: the Track Record page renders meaningful in-flight data the moment the PR
deploys, without waiting for the migration or the next grader run.

## 8. Files touched

- **NEW** `backend/grading/live_score.py` — pure compute + persistence
- **NEW** `sql/live_score_columns.sql` — DDL for `theses.live_score` columns
- **NEW** `src/lib/track-record-live-score.ts` — shared client compute (mirror)
- `backend/cron/daily_grading.py` — wire `update_all_live_scores()` in
- `backend/grading/features.py` — fix SPCE → SpaceX comment (no behavior
  change to the existing TICKER_TO_COMPANIES dict — see §9)
- `src/app/track-record/page.tsx` — header reconciliation, live_score stats,
  "Tracking" chip styling, remove "check back" copy, SpaceX (private) display
- `src/components/track-record/verdict-evolution.tsx` — replace
  per-thesis sparkline with avg live_score sparkline over last 30 days

**ZERO** edits to `backend/synthesize.py` or `backend/ingest.py`.

## 9. SPCE → SpaceX bonus mapping

`backend/grading/features.py` has `"SPCE": "Virgin Galactic"` — that's
**correct** (SPCE actually IS Virgin Galactic's ticker). The bug is upstream
in `thesis_generator._resolve_ticker` which assigns `SPCE` to SpaceX-themed
theses (presumably because SpaceX is private and the resolver falls back to a
sector ETF). That fix lives in `backend/thesis_generator.py` (entity
resolution → deferred to Wave 2 per constraints).

What we can ship today: the **track-record page** detects when a thesis title
contains "SpaceX" (case-insensitive) and renders "SpaceX (private)" with no
ticker chip, regardless of what `thesis.ticker` says. Pure cosmetic, scoped to
`src/app/track-record/page.tsx`.
