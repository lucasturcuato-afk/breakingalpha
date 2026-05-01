# AUDIT: Track Record evidence chain (W2-I scoping)

**Author:** Wave 2 / w2/track-record-evidence-audit
**Date:** 2026-04-30
**Branch:** w2/track-record-evidence-audit
**Status:** READ ONLY. No code changes. No live Supabase access in this worktree (no `.env.local`); all tabular shapes below come from code, not from production rows. Sections explicitly labeled `[FROM CODE]` vs `[WOULD NEED LIVE QUERY]` so Noah knows what is verified vs hypothesized.

---

## TL;DR

The grader **already writes** per-thesis evidence and rationale on every grading run, but the Track Record page never surfaces it. Two columns on `thesis_verdicts` get the data for free today:

- `thesis_verdicts.notes` - Gemini's 2-3 sentence verdict rationale
- `thesis_verdicts.key_evidence_ids` - uuid array of supporting article ids the model actually weighted

There is also a `theses.evidence_chain` jsonb column already populated by `/api/thesis-detail` for the Thesis Board, with `{article_index, label, type: "support"|"context"|"risk", bridge}` items.

**The W2-I product decision is mostly about display + freshness, not new ingestion.** The schema, sourcing, and voice tradeoffs reduce to:

1. Do we trust the existing `thesis_verdicts.notes` (one-shot Gemini, written nightly) for the live-grading "why", or do we want a separate evidence pass that maps directly onto the five `live_score` components (price/sentiment/ratio/confidence/time-decay)?
2. If the latter, do we persist or compute on the fly?
3. Editorial: structured chips, prose blurb, or both?

Recommendations are **not** included - Noah's call. This doc frames the data.

---

## 1. Current per-thesis data inventory `[FROM CODE]`

What is already stored per thesis today, with file:line for each field. No live SELECTs were possible in this worktree (no `.env.local`), so per-row examples are not pulled - shapes come from schema and mapper definitions.

### `theses` table (live schema, 26 columns per HANDOFF.md L390)

Source: `backend/thesis_grader.py` writes (L680-693), `src/lib/thesis-mapper.ts` reads (L20-47), `sql/grader_upgrade.sql`, `sql/live_score_columns.sql`.

| Column | Type | Written by | Surfaced where |
|---|---|---|---|
| `id` | uuid | `/api/theses` POST | everywhere |
| `title` | text | thesis generator | track record card, thesis board |
| `conviction` | text (HIGH/MEDIUM/WATCH/BULLISH/BEARISH) | thesis generator | conviction ring; stance for live_score |
| `sector` | text | thesis generator | sector pill, sector grouping |
| `ticker` | text | thesis generator (or SECTOR_ETF_MAP fallback) | grader feeds Finnhub |
| `rationale` | text (3-4 sentences) | thesis generator | thesis-board memo |
| `catalyst` | text (1-2 sentences) | thesis generator | thesis-board catalyst card |
| `catalyst_note` | text | `/api/thesis-detail` POST | thesis-board catalyst card |
| `evidence_chain` | jsonb (array of `{article_index,label,type,bridge}`) | `/api/thesis-detail` POST | `ThesisList.tsx:127` (boolean check only), `thesis-table.tsx:136` (count only) |
| `supporting_articles` | text[] (uuid strings) | `/api/theses` POST | `WhyThisThesis.tsx` "Sourced From" |
| `verifiable_signal` | text (one falsifiable sentence) | thesis generator | grader prompt |
| `horizon` | text ("7d"/"30d"/"90d") | thesis generator | grader, live_score time decay |
| `check_after` | timestamptz (generated_at + horizon) | `/api/theses` POST | grader gate, "overdue" count |
| `generated_at` | timestamptz | `/api/theses` POST | sort order, age in live_score |
| `outcome` | text ("confirmed"/"invalidated"/"inconclusive"/null) | grader (mirror of latest verdict) | track record terminal verdict |
| `outcome_notes` | text | grader (mirror of latest verdict.notes) | **NOT surfaced anywhere I found** |
| `outcome_checked_at` | timestamptz | grader | not surfaced |
| `signal_breakdown` | jsonb `{price_change_pct, options_flow, earnings_surprise, news_velocity, analyst_consensus}` | grader | **only `price_change_pct` is read** (live_score price component) |
| `confidence` | numeric 0-1 | grader | live_score confidence component |
| `bear_case` | text | adversarial pass | `WhyThisThesis.tsx` "Adversarial Check" |
| `adversarial_score` | numeric | adversarial pass | `WhyThisThesis.tsx` "Adversarial Check" |
| `passed_adversarial` | boolean | adversarial pass | `WhyThisThesis.tsx` "Adversarial Check" |
| `locked_at` | timestamptz | grader | grading gate |
| `expired` | boolean | grader | grading gate |
| `live_score` | int -100..+100 | `backend/grading/live_score.py` | track record stat cards, sector table, "What's Working" |
| `live_verdict` | text ("Confirmed"/"Invalidated"/"Tracking confirmed"/"Tracking invalidated"/"Tracking neutral"/"Inconclusive after Nd") | live_score.py | track record chip |
| `live_score_updated_at` | timestamptz | live_score.py | not surfaced (HANDOFF L494) |

**DDL state:** Per HANDOFF.md L4 and L494, `sql/live_score_columns.sql` has not yet been applied to prod. Frontend renders correctly via TS fallback (`src/lib/track-record-live-score.ts:165-215` `computeLiveScore()`). Backend `_persist_score` soft-fails with a warning (`backend/grading/live_score.py:344-353`).

### `thesis_verdicts` table - append-only history `[FROM CODE]`

Source: `sql/grader_upgrade.sql:2-25`, `backend/thesis_grader.py:587-618` (`_build_verdict_row`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `thesis_id` | uuid FK theses(id) ON DELETE CASCADE | indexed `(thesis_id, graded_at DESC)` |
| `verdict` | text ("confirmed"/"invalidated"/"inconclusive") | indexed |
| `confidence` | numeric 0-1 | |
| `notes` | text (truncated 2000 chars in grader) | **Gemini's 2-3 sentence rationale** |
| `key_evidence_ids` | uuid[] | **The article ids Gemini actually weighted** (subset of `theses.supporting_articles`) |
| `signals_weighted` | jsonb (per-signal 0-1 weights) | structure from `SignalsWeighted` pydantic, `backend/thesis_grader.py:339-348` |
| `contradicting_evidence_considered` | bool | only true if contradicting set was non-empty AND model factored it |
| `tag_overlap_count` | numeric | features.py |
| `new_article_count` | numeric | features.py - how many supporting articles published after thesis was created |
| `weighted_sentiment_alignment` | numeric -1..+1 | features.py - drives live_score sentiment component |
| `source_diversity_score` | numeric | features.py |
| `time_elapsed_days` | numeric | features.py |
| `supporting_vs_contradicting_ratio` | numeric (capped 10) | features.py - drives live_score ratio component |
| `model_version` | text | provenance |
| `prompt_version` | text | provenance |
| `cost_estimate` | numeric | provenance |
| `graded_at` | timestamptz | |

### Articles linked per thesis: three separate sources `[FROM CODE]`

| Source | Where | Granularity |
|---|---|---|
| `theses.supporting_articles` (text[]) | written at thesis creation, `src/app/api/theses/route.ts:556-558` | author-declared, frozen at generation |
| `theses.evidence_chain` (jsonb) | written by `/api/thesis-detail` POST (manual enrichment), `src/app/api/thesis-detail/route.ts:84-95` | per-article `{label, type, bridge}` enrichment |
| `thesis_verdicts.key_evidence_ids` (uuid[]) | written by grader on every grading run | per-grading-cycle, what model actually weighted |

`articles` table has a `sentiment` column ("bullish"/"bearish"/"neutral") populated at ingest time (`backend/ingest.py:148, 200`), which `features.py:_weighted_sentiment_alignment` reduces to the signed `weighted_sentiment_alignment` number. So Supports/Contradicts/Neutral exists per article but only as the numeric aggregate gets surfaced - the per-article sentiment is on the row itself.

### Five representative theses - what we would query if live `[WOULD NEED LIVE QUERY]`

Without prod access this is a query template, not a result set. To pull a representative sample (mix of Tracking confirmed / invalidated / neutral), Noah or a follow-up agent with `.env.local` could run:

```sql
WITH per_verdict AS (
  SELECT live_verdict,
         id, title, ticker, sector, conviction, horizon, generated_at,
         live_score, live_score_updated_at,
         outcome, outcome_notes, confidence,
         signal_breakdown,
         supporting_articles, evidence_chain
  FROM theses
  WHERE expired = false
)
SELECT * FROM per_verdict
WHERE live_verdict IN ('Tracking confirmed', 'Tracking invalidated', 'Tracking neutral', 'Confirmed', 'Invalidated')
ORDER BY live_verdict, abs(live_score) DESC
LIMIT 15;

-- per-thesis grading history
SELECT thesis_id, graded_at, verdict, confidence, notes, key_evidence_ids,
       weighted_sentiment_alignment, supporting_vs_contradicting_ratio
FROM thesis_verdicts
WHERE thesis_id = ANY('{...}'::uuid[])
ORDER BY thesis_id, graded_at DESC;

-- the actual article rows the grader weighted
SELECT id, title, source, sentiment, sector, companies, published_at, summary
FROM articles
WHERE id = ANY('{...key_evidence_ids...}'::uuid[]);
```

Per HANDOFF.md the page typically has on the order of 12 tracked theses with 1 confirmed and 7 inconclusive, so the sample is small enough to read each one by hand.

---

## 2. Evidence sourcing inventory: how the live_score is computed today `[FROM CODE]`

**Formula** (mirrored exactly in Python and TS, same constants and signs):

| Component | Band | Source field | Where |
|---|---|---|---|
| Price alignment | -50..+50 | `theses.signal_breakdown.price_change_pct` × stance, saturates at \|10%\| | `live_score.py:137-145`, `track-record-live-score.ts:94-100` |
| Sentiment alignment | -25..+25 | latest `thesis_verdicts.weighted_sentiment_alignment` × 25 | `live_score.py:148-158`, `track-record-live-score.ts:102-106` |
| Support/contradict ratio | -15..+15 | log10(latest `thesis_verdicts.supporting_vs_contradicting_ratio`) × stance | `live_score.py:161-175`, `track-record-live-score.ts:108-118` |
| Confidence boost | -10..+10 | latest `thesis_verdicts.confidence` × ±10, only on terminal verdicts | `live_score.py:178-189`, `track-record-live-score.ts:120-130` |
| Time decay | -10..0 | -(age_days/horizon_days) × 10, only when no terminal verdict | `live_score.py:192-209`, `track-record-live-score.ts:132-147` |

Stance is derived from `theses.conviction`: BEARISH → -1, BULLISH/HIGH/MEDIUM → +1, WATCH/null → 0 (`live_score.py:88-95`, `track-record-live-score.ts:82-87`).

**Article matches are linked, not recomputed at score time.** The grader does the heavy lifting once per night:

1. `fetch_supporting_articles(thesis, supabase)` reads `theses.supporting_articles` ids and pulls article rows (`backend/grading/evidence.py:73-89`).
2. `fetch_contradicting_candidates` runs a layered company → sector search excluding supporting ids, capped at 25 (`evidence.py:92-147`).
3. `extract_rule_features` produces the six numeric features that get persisted on `thesis_verdicts` (`backend/grading/features.py:123-137`).
4. `grade_with_gemini` returns a `GeminiVerdict` including `notes` (the rationale) and `key_evidence_ids` (the article uuids).
5. The grader writes one append-only `thesis_verdicts` row, then mirrors `outcome`, `outcome_notes`, `confidence`, `signal_breakdown` onto the parent `theses` row (`thesis_grader.py:671-697`).
6. `live_score.update_all_live_scores` runs immediately after, reads the latest `thesis_verdicts` row + `theses.signal_breakdown`, computes the score, persists `live_score`/`live_verdict`/`live_score_updated_at` (`live_score.py:356-408`).

**Cost of recomputing vs persisting the score itself.** The TS mirror in `src/lib/track-record-live-score.ts` already runs in the browser on every Track Record page load - the math is pure arithmetic over already-fetched rows, so the cost is negligible (microseconds per thesis, no network). `live_score.py` exists mostly so backend rankings (e.g. cross-page widgets, future API endpoints) can sort without reimplementing the formula.

**Cost of recomputing evidence on the fly.** That is materially more expensive because it is what the grader already does once nightly: pull supporting article rows, pull a contradicting candidate set (one or two PostgREST queries), optionally pass through Gemini. Doing it on every page load would mean 12-25 article fetches per thesis × N theses × every visit. Not free, even before the LLM call.

**What this implies for W2-I.** The five components of `live_score` already correspond to five concrete pieces of evidence (a price move, an aggregate sentiment number, a ratio, a confidence, an age). The narrative "why" hook for the user can be built directly from `thesis_verdicts.notes` (Gemini's prose), `thesis_verdicts.key_evidence_ids` (the article subset Gemini actually weighted), and `theses.signal_breakdown.price_change_pct` (the price move) - no new LLM call required for a structured display.

---

## 3. Schema options

### Option A: new columns on `theses`

```
ALTER TABLE theses ADD COLUMN IF NOT EXISTS live_score_rationale         text;
ALTER TABLE theses ADD COLUMN IF NOT EXISTS live_score_evidence_article_ids text[];
ALTER TABLE theses ADD COLUMN IF NOT EXISTS live_score_components        jsonb;
```

| Dimension | Tradeoff |
|---|---|
| Storage cost | Tiny. ~1KB per thesis × O(100) theses. |
| Query cost | Free - already in the row the page fetches. Zero extra round trip. |
| Historical accuracy | None. Each cron overwrites. "Why was this thesis graded -47 three weeks ago?" returns today's reasons, not that day's. |
| W2-A interaction | Same write surface as `live_score` itself. Add columns to the same `_persist_score` UPDATE in `live_score.py:334-353`. Same DDL gate, same soft-fail. |
| Hidden cost | Mirrors the existing live_score persistence pattern, so this is the lowest-friction option. But it locks Track Record into "today's view" - no sparkline of evidence drift. |

### Option B: new table `thesis_evidence`

```
CREATE TABLE thesis_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id       uuid NOT NULL REFERENCES theses(id) ON DELETE CASCADE,
  graded_at       timestamptz NOT NULL,
  evidence_kind   text NOT NULL,    -- 'price' | 'sentiment' | 'ratio' | 'confidence' | 'time_decay' | 'article'
  article_id      uuid REFERENCES articles(id),  -- nullable, only set for 'article' rows
  weight          numeric,          -- the contribution to live_score
  detail          jsonb,            -- {direction, pct, sentiment_label, source, ...}
  rationale       text              -- one-sentence prose
);
CREATE INDEX thesis_evidence_thesis_graded_idx ON thesis_evidence (thesis_id, graded_at DESC);
```

| Dimension | Tradeoff |
|---|---|
| Storage cost | Modest. ~5-10 rows per thesis per grading cycle. ~50KB/day across all theses (rough order). |
| Query cost | One extra PostgREST select per page load (or per thesis click), parallel to the existing `thesis_verdicts` fetch. The Track Record page already does two parallel queries (`page.tsx:132-144`); this becomes three. |
| Historical accuracy | Full. Same pattern as `thesis_verdicts` itself - append-only, time-series, queryable for "show me what evidence drove this thesis on April 15". |
| W2-A interaction | New table → new schema → new write path in `live_score.py` + new read path in frontend. Larger surface area to test. |
| Hidden cost | Only worth it if Noah wants the time-series view (sparkline of evidence drift, "the price call held until April 22 then collapsed"). For a static "why" panel, this is overkill. |

### Option C: computed on the fly from existing data

No new column. On Track Record page load, for each thesis pull:

- `theses.signal_breakdown.price_change_pct` (already fetched)
- latest `thesis_verdicts` row including `notes`, `key_evidence_ids`, `weighted_sentiment_alignment`, `supporting_vs_contradicting_ratio`, `confidence` (already fetched, see `page.tsx:132-144`)
- the article rows referenced by `key_evidence_ids` (one new `articles.in("id", [...])` query per thesis click, or a single batched query for all visible theses)

| Dimension | Tradeoff |
|---|---|
| Storage cost | Zero. |
| Query cost | One additional batched `articles.select(...).in("id", allKeyEvidenceIds)` per page load. Modest. |
| Historical accuracy | Partial. The `thesis_verdicts` history is already time-series; we can already render "what Gemini said on April 15" by ordering by `graded_at`. But the article rows the grader saw on April 15 may have been deleted or re-classified since (rare in practice - `articles` is append-only with no automated deletion in code I read). |
| W2-A interaction | None. No new schema. Frontend-only. |
| Hidden cost | Per-page-load article fetch becomes a soft dependency - if Supabase is slow, the "why" appears late. Solvable with skeleton state. |

### Schema option summary

| | Storage | Query | Time-series | Schema risk | Coupling to W2-A |
|---|---|---|---|---|---|
| A: theses cols | tiny | free | no | low (DDL) | tight |
| B: thesis_evidence table | modest | +1 query | yes | medium (new table + RLS + indexes) | moderate |
| C: compute on fly | zero | +1 batched query | yes (via thesis_verdicts) | none | none |

Option C is essentially "use what we already write," which is the smallest possible move. Option B is the right move if Noah expects users to drill into "why was this score -47 on April 15" historically. Option A is a half-measure with the worst historical-accuracy story.

---

## 4. Sourcing options

### Option A: structured evidence list only

Display per-thesis:

- chip row: "Price: -3.2% (against)" / "Sentiment: 0.4 supporting" / "Articles: 4 support, 1 contradict"
- list of 2-4 article links with title, source, sentiment label

| Dimension | Value |
|---|---|
| Unit cost per thesis per cycle | $0. Zero LLM. |
| Latency | Sub-100ms. Existing query shapes. |
| Tone risk | None - values are facts pulled from existing rows. |
| Fail-safe | Trivial. Each chip is independent; missing data shows "-". |
| Coverage | Surfaces the *what*, not the *why*. User has to infer "this thesis is invalidated because price dropped 3% and sentiment turned bearish." |

### Option B: LLM rationalization pass

Gemini reads supporting + contradicting articles + price history and writes a 1-2 sentence rationale per thesis per grading cycle.

| Dimension | Value |
|---|---|
| Unit cost per thesis per cycle | Same order as the existing grader call (`thesis_grader.grade_with_gemini` is the Gemini 2.5 Flash call that already produces `notes` for `thesis_verdicts`). For the live-score case Noah could either reuse that same `notes` field (zero new cost) or run a smaller call (cheaper than the grader because no adversarial set, no signals_weighted required). Order: ~$0.001-$0.005 per thesis per cycle. |
| Latency | Adds ~2-5s per thesis to the cron run if done sequentially; trivial if batched. Since this runs in the nightly cron (not on page load), latency is invisible to the user. |
| Tone risk | Real. Gemini may write filler ("This thesis is currently tracking neutral as the market awaits further developments") - the existing brief synthesis prompts spend a lot of words banning exactly this kind of language (see §5). Banned-phrase guardrails would need to be ported. |
| Fail-safe | Soft. If Gemini fails, fall back to Option A's structured chips. The grader already uses `_soft_fail_verdict` (`thesis_grader.py:362-371`) for the same reason. |
| Coverage | Surfaces both what and why. Reads like Stratechery, not a database dump. |

**Cheapest variant of B: don't run a new call at all.** `thesis_verdicts.notes` is already populated nightly with Gemini's 2-3 sentence rationale, and the system prompt at `thesis_grader.py:323-336` explicitly asks for "how you weighed supporting vs contradicting evidence and the key market signal." Surfacing `notes` directly is Option B with zero net new LLM spend. Caveat: that rationale was written for the terminal verdict, not the live_score; it may not say "the price moved 3% against you," it may say "the verifiable_signal has not yet materialised." Worth reading 5-10 actual `notes` values from prod before deciding.

### Option C: hybrid (structured chips + one-sentence summary)

The chip row from Option A plus one Gemini-generated sentence underneath. Common pattern in financial UIs (Bloomberg's "Why" callouts, Koyfin's analyst summaries).

| Dimension | Value |
|---|---|
| Unit cost per thesis per cycle | Same as Option B if a new call is made; $0 if reusing `thesis_verdicts.notes`. |
| Latency | Same as B. |
| Tone risk | Lower than B alone, because the chips carry the literal facts and the prose just frames them. |
| Fail-safe | Strong. If the LLM call fails, hide the prose, keep the chips. |
| Coverage | Best of both. Skimmer reads chips; reader reads the sentence. |

### Sourcing option summary

| | Cost | Latency | Tone risk | Fail-safe | Reads as |
|---|---|---|---|---|---|
| A: structured | $0 | nil | none | trivial | data dump |
| B: LLM only | $0 to $0.005/thesis | nightly cron | real | soft | prose blurb |
| C: hybrid | $0 to $0.005/thesis | nightly cron | low | strong | analyst summary |

---

## 5. Editorial voice considerations `[FROM CODE]`

The codebase already takes strong editorial positions for the brief synthesis prose. References below are file:line, content not quoted at length:

- `backend/synthesize.py:38` - banned-phrase block: "does not directly impact", "investors should monitor", "broadly supportive", "ongoing uncertainty", "highlight", "limited direct impact". Tone: clinical/analyst, allergic to filler hedges.
- `backend/synthesize.py:42-67` - additional banned constructions: "signals [vague trend]", "amid", "as", "while", "alongside" when joining unrelated topics. With BAD/GOOD examples.
- `backend/synthesize.py:138, 284` - Market Pulse `narrative` field rule: "Read it like a Stratechery opener, not a bank research note." Multiplicity rule: if sentiment_word implies tension, body must name three distinct stories.
- `backend/synthesize.py:147` - `what_to_watch` rule: "Each sentence must name a specific company, ticker, Fed speaker, or scheduled data release, state the exact expected catalyst, and commit to the binary outcome that matters."
- `src/lib/company-intel.ts:737-762` - Company Intel memo prompt - the most developed editorial spec in the repo. Mandates: market-condition opener (not company name), proper noun first word, two-sentence discipline per development (fact then non-obvious implication), binary directional verdict in Cross-Signals (no "mixed", "presents", "both", "while"), "If [trigger]: [action]. If [opposite]: [why thesis weakens]" structure for What To Do With This.

**Tone choices, framed for W2-I:**

- **Clinical / analyst** (matches Company Intel): "Price moved -3.2% against the bullish stance over 14 days; sentiment alignment fell to -0.18; supporting/contradicting ratio collapsed from 4:1 to 1:2. Tracking invalidated."
- **Editorial** (matches Market Pulse): "The bullish call has stopped working. NVDA is down 3.2% since the thesis went up, and the article flow has flipped - what looked like four supports against one contradiction is now a wash."
- **Minimal / structured** (matches WhyThisThesis chips, `src/components/thesis/WhyThisThesis.tsx:280-330`): chip rows only, no prose at all. Terse, scannable, no tone risk.

The repo's existing voice gravitates editorial-with-banned-phrase-guards, but the existing **"Why this thesis"** panel on the Thesis Board (`src/components/thesis/WhyThisThesis.tsx`) is **minimal/structured** - labeled sections (Sourced From, Cluster Signal, Source Reliability, Pattern Match, Adversarial Check, System Context) with terse data, no LLM prose. So there is precedent for both voices in different surfaces.

The choice frame: does the Track Record "why" sit closer to Company Intel (editorial, prose-led) or Thesis Board "Why this thesis" (structured chips)? They serve different reader modes - drill-down vs at-a-glance.

---

## 6. Frontend impact `[FROM CODE]`

Track Record page is `src/app/track-record/page.tsx` (824 lines). Existing surfaces:

| Section | Lines | What it shows | W2-I evidence fit |
|---|---|---|---|
| Header | 329-377 | Counts + last-graded timestamp + next-run | Could surface "X theses with new evidence today" |
| Summary stats (4 cards) | 391-413 | Total / Tracking Confirmed / Tracking Invalidated / Confirmation Rate | No fit - these are aggregates |
| Sector Performance table | 416-482 | One row per sector with win rate + avg score + bar | No fit - sector-level, not per-thesis |
| Verdict Evolution sparkline | 484-486 | 30-day avg live_score sparkline | Tangential - could add evidence-event markers, but not the natural place |
| What's Been Working (top 3) | 488-498 | `ThesisRankCard` with sector + score + verdict | **Strong fit.** Each card could show 1-2 line evidence summary on hover or below the chip |
| What's Not (bottom 3) | 500-511 | `ThesisRankCard` | **Strong fit.** Same as above |
| Most Reliable Sources | 513-549 | Source credibility rows | No fit |
| Recent Theses (top 10) | 552-595 | Per-thesis row with sector pill + verdict chip + score badge + date | **Strong fit.** Currently each row links to `/thesis-board?thesis=<id>`. Could expand inline OR show evidence chips inline OR keep the link and surface evidence on the thesis-board side. |

### Three placement patterns to choose from

**Pattern 1: inline chips on the existing Recent Theses cards** - minimal disruption; the row already has a sector pill and a verdict chip; adding 2-3 evidence chips on a second line keeps the page scannable. Best for Option 4-A (structured) or 4-C (hybrid).

**Pattern 2: expandable detail per card** - click the row to expand inline, show structured chips + (optional) prose blurb + article links. Mirrors the WhyThisThesis pattern from Thesis Board (`src/components/thesis/WhyThisThesis.tsx:252-330`). Best for any of A/B/C.

**Pattern 3: side panel on row click** - like a slideover. Heavier UI lift but matches how Bloomberg Terminal handles drill-downs. Probably overkill for this audience.

### Patterns to reuse

- `WhyThisThesis` component (`src/components/thesis/WhyThisThesis.tsx`) is already shipped on Thesis Board. It already does parallel `Promise.allSettled` legs for Sourced From, Cluster Signal, Source Reliability, Pattern Match, Adversarial Check, System Context (`WhyThisThesis.tsx:96-217`). It does NOT yet read `thesis_verdicts.notes` or `key_evidence_ids` - those are the lowest-friction additions.
- The `LiveVerdictBadge` and `ScoreBadge` components on the page (`page.tsx:661-693`) already use the chip palette from `track-record-live-score.ts:227-234`. New evidence chips could follow the same `bg-signal-up/15 text-signal-up` token system for consistency.
- `EmptyInflightState` (`page.tsx:755-770`) is the established empty-state pattern for "data is on its way at 8:10 PM PT." Same component would work for "evidence is in flight."

---

## 7. Lucas coordination flag

W2-I implementation as scoped in this audit does **NOT** require edits to `backend/synthesize.py` or `backend/ingest.py`. Specifically:

- All evidence data already exists in `thesis_verdicts` and `theses` tables, written by `backend/thesis_grader.py` and `backend/grading/live_score.py` - both files Noah owns.
- A new "evidence" surface (column, table, or computed) writes to or reads from those same tables.
- The frontend changes live entirely in `src/app/track-record/page.tsx` and (optionally) extending `src/components/thesis/WhyThisThesis.tsx`.

If Sourcing Option B (LLM rationalization) is chosen and Noah wants the rationale generated *during synthesis* (e.g. as part of the morning brief synthesis pass for that day's theses), then `synthesize.py` would need a new prompt block - that would be a Lucas coordination point. But the simpler version (rationale written by the grader cron, persisted on `thesis_verdicts.notes` which already exists) avoids `synthesize.py` entirely.

`backend/ingest.py` is not implicated under any of the options.

---

## 8. Cross-references

- Agent 3 (entity resolution audit, `docs/entity-resolution-audit.md`) - relevant if W2-I wants to attribute evidence to companies/tickers and the resolution layer is shaky. The SpaceX → SPCE mis-resolution noted at `track-record/page.tsx:88-90` is a concrete example: an "evidence" panel that says "SPCE down 5%, supports your bearish thesis" would be wrong if the thesis is actually about SpaceX (private, not the SPCE ticker).
- Agent 5 (Company Intel current state, `docs/company-intel-current-state.md`) - relevant for editorial voice. Company Intel has the most refined prose-and-conviction prompt in the repo (`src/lib/company-intel.ts:737-762`); whatever editorial voice W2-I lands on should be consistent with or deliberately distinct from it.
- `docs/track-record-investigation.md` - the W1-C investigation that produced live_score. Section 5-6 covers the formula and cadence rationale.
- `sql/live_score_columns.sql` - the unapplied DDL Noah needs to run for backend persistence to start writing. Live grading already works without it via TS fallback.

---

## 9. Open questions for Noah

1. **Voice:** chips, prose, or both? (See §4 + §5.) Reading 5-10 actual `thesis_verdicts.notes` from prod would inform this.
2. **Schema:** A (cols on theses), B (new table), or C (compute on fly)? Pivots on whether you want historical "why was this -47 on April 15" queries.
3. **LLM:** reuse existing `thesis_verdicts.notes` (free) or run a new dedicated rationale pass (cheap but extra surface area)?
4. **Placement:** inline chips on Recent Theses cards, expandable detail, or side panel?
5. **Scope:** does W2-I touch What's Been Working / What's Not as well, or only the Recent Theses list?

These are the five decisions that gate implementation. None require code; all five can be made from this doc plus 10 minutes reading 5-10 representative `thesis_verdicts` rows from prod.
