# Overview Subject Modes v2 — PHASE 0 ONLY (backtest + persistence prerequisite)

Branch: `feat/overview-modes-v2` (off post-#431 origin/main, HEAD b8f2adef).
Scope: PHASE 0 ONLY. Phase 1 (T1-T5 gate thresholds) and Phase 2 (harness
changes) are NOT implemented. The Phase 0 stop-gate (P0.1) triggered: the
gen-time tape is not persisted, so Gate 1 cannot be backtested from our records.

## The model being backtested
Market-wide is the FLOOR. A single story escapes the floor only if removing it
would make the day's market move inexplicable. Three modes:
- MODE A: market-wide, no lead driver (flat / divided tape).
- MODE B: market-wide written AROUND one dominant driver (tape moved AND one
  story is the cause). ~95% of days that move.
- MODE C: centered on one event that IS the market (crash / Fed shock). Rare.

Two sequential gates:
- Gate 1: did the market move (index %s + VIX only).
- Gate 2: is THIS story the reason (cluster dominance over other clusters +
  sector/name match + direction match + scope rule).

## P0.1 DATA PREREQUISITE — VERDICT

### Headline finding: the gen-time index/VIX tape is NOT persisted.
Gate 1 ("did the market move") reads index percent moves and VIX. Those numbers
ARE computed at generation time but are thrown away, so Gate 1 is NOT
backtestable from our own records.

Evidence (read-only, confirmed in code + DB):
1. The tape IS computed per run. `synthesize.py:2324`
   (`_maybe_inject_tape_directive`) calls `market_tape.fetch_tape()`, which
   returns `{"quotes": {sym: {price, prev, pct}}, "regime": str, "vix_level":
   float}` (`market_tape.py:260-289`). This is exactly the Gate-1 tape.
2. The tape is used ONLY to build a PROMPT DIRECTIVE. The returned `tape_obj`
   never reaches the persisted row.
3. The persisted briefings row (`synthesize.py:3022-3068`) is:
   `{briefing_type, headline, summary, market_tone, sections, top_deals,
   sector_breakdown, created_at}` plus optional extras
   `{market_pulse, lead_paragraph, supporting_context, what_to_watch,
   primary_story_id}`. No index/VIX/pct fields.
4. `market_pulse` (a TEXT column holding the model's narrative JSON) only gets
   `market_closed / holiday_name / last_trading_session` stamped on closed days
   (`synthesize.py:3006-3010`). It carries NO structured tape numbers. A SELECT
   over the recent briefs confirms `market_pulse` holds no queryable
   index/VIX/pct fields; a few EVENING narratives (06-13, 06-17, 06-20) mention
   index/VIX numbers inside the prose, but that is free-text the model wrote,
   not a structured, reliable, every-day field, and most days have none.
5. `backend/market_tape.py` is read-only (Yahoo fetch, no writes).
   `observe.py` / `pipeline_runs` store only a headline snapshot, no tape.

Conclusion: persisting the gen-time tape snapshot per run is a PREREQUISITE that
Gate 1 depends on. Until it exists, Gate-1 thresholds cannot be tuned or
validated against our own history.

### Second half of P0.1: per-day candidate POOLS ARE reconstructable. CONFIRMED.
The pool is fully reconstructable from `articles` using the EXACT live window
from `impact_ranking.fetch_coverage_pool` (`impact_ranking.py:404-420`):

```
ingested_at  >= now - interval '24 hours'  AND ingested_at  < now
AND published_at >= now - interval '48 hours' AND published_at < now
ORDER BY ingested_at DESC LIMIT 1000
```

where `now` = the brief's `created_at` (the live path sets
`_now = datetime.now(timezone.utc)` at `synthesize.py:2108` then calls
`fetch_coverage_pool(supabase, _now)` at `:2109`). Replaying the PURE primitives
`impact_ranking.cluster_key` / `score_clusters` / `recent_tier1_events` over that
reconstructed pool reproduces the cluster signals offline with NO DB writes and
NO Gemini, exactly as `backend/tests/test_lead_overview_offline.py` already does
for the committed 06-24 fixture. Verified by reconstructing and replaying 35 real
brief days (see P0.2).

## P0.2 SIGNALS TABLE
Fixture: `backend/tests/fixtures/modes_v2_signals.json`
Worksheet: `backend/tests/fixtures/modes_v2_worksheet.csv`

Days: 35 real brief surfaces (morning + evening) from 2026-06-03 to 2026-06-27.
Only briefs with a real headline are included; "Market Intelligence Unavailable"
placeholder rows and the early-June duplicate runs are excluded. Each pool was
reconstructed via the window above (capped at 1000 rows, matching the live LIMIT;
pools larger than 1000 are capped exactly as the live path caps them).

Per-day columns computed by the PURE replay:
- date, created_at, brief_type, pool_size
- top_cluster_key, top_breadth_sources (distinct sources), top_article_count,
  top_score
- second_cluster_key, second_breadth_sources, second_score
- top_2nd_score_ratio, top_2nd_breadth_ratio (the Gate-2 dominance signals)
- distinct_sectors_top5, distinct_verticals_top5 (the broad-vs-concentrated
  sector-scope signal: distinct sectors / industry_verticals across the top-5
  clusters)
- winning_cluster_name, is_tier1_top, is_recent_top
- brief_headline, brief_market_tone (for mode inference)
- tape_sp500_pct / tape_nasdaq_pct / tape_vix = "NOT_PERSISTED" (Gate-1 columns;
  see P0.1)

### Gate-1 (tape) columns: BLANK, marked "NOT_PERSISTED".
They are not in our records. I did NOT enrich them with a Yahoo historical proxy:
that would be an external proxy, NOT the gen-time snapshot the live gate reads
(intraday vs close mismatch, prior-close baseline differences), and labelling a
proxy as if it were our tape would corrupt the worksheet Noah uses to set
thresholds. They are left blank and clearly marked. A clean Yahoo close proxy can
be added later as a SEPARATE, clearly-labelled column once Noah wants it.

## P0.3 PROVISIONAL LABELS + THRESHOLDS (PROVISIONAL — AGENT labels, NOT ground truth)

Provisional A/B/C is assigned by the "removing the story makes the day
inexplicable" heuristic using ONLY the reconstructable cluster signals plus the
brief's own headline/tone (NOT the gen-time tape, which we do not have):
- C (one event IS the market): brief tone RISK-OFF AND the top cluster is a
  tier-1 / recent macro event AND the headline reads as a shock
  (fed / fomc / rate decision / crash / plunge / tumble / selloff).
- B (market-wide AROUND one driver): top cluster clearly dominates #2 by BOTH
  score ratio (>= 1.30) AND breadth ratio (>= 1.50).
- A (market-wide, no single driver): everything else (weak dominance / divided
  pool).

Provisional mode distribution (35 days): A = 32, B = 3, C = 0.
The three provisional B days: 06-04 evening, 06-18 evening, 06-22 morning.
Note the absence of C: with NO gen-time tape, a true "one event IS the market"
crash / Fed-shock day cannot be distinguished from an ordinary day on cluster
signals alone, so the heuristic conservatively never asserts C. The A-heavy skew
is itself evidence of the prerequisite: without Gate 1 almost everything
collapses to the market-wide floor (the correct DEFAULT, but it means the modes
are not separable from our own records yet).

### Proposed thresholds
Gate 1 (did the market move) — UNTUNABLE WITHOUT PERSISTENCE.
Proposed SHAPE only (numbers are placeholders, NOT validated):
`S&P abs >= 1.0%  OR  Nasdaq abs >= 1.25%  OR  VIX day-change >= +15% or VIX >= 20`.
These cannot be tuned or checked against our archive because the gen-time tape is
not persisted (P0.1). They are SHAPE proposals to be tuned ONCE the tape lands.

Gate 2 (is THIS story the reason) — TUNABLE from the reconstructable data:
- Dominance: `top_2nd_breadth_ratio >= 1.5` AND `top_2nd_score_ratio >= 1.3`
  (the winning cluster must clearly out-cover and out-score the runner-up).
- Direction match: the existing `market_tape.classify_framing` +
  direction-consistent check already wired in #430/#431 (kept as-is).
- Sector scope rule: broad move (`distinct_sectors_top5` high) -> macro only;
  concentrated move (`distinct_sectors_top5` low, one sector dominates) ->
  single name allowed if it is a demonstrable driver.

### Separation quality + misclassifications
Empirical spread over the 35 days:
- `top_2nd_score_ratio` is COMPRESSED to 1.002 - 1.862 (median ~1.13). The score
  blends log-breadth + log-count + recency + additive tier1/mega boosts, so the
  #1-vs-#2 score gap is small. It is a WEAK separator on its own.
- `top_2nd_breadth_ratio` spreads 0.167 - 15.0 and is the DISCRIMINATING signal.
  Days where the top cluster has FEWER distinct sources than #2
  (breadth_ratio < 1: 06-05 eve, 06-09 morn, 06-10 eve, 06-11 eve, 06-15 morn,
  06-16 eve, 06-17 morn 14:44, 06-17 eve, 06-19 morn, 06-20 eve, 06-23 morn) are
  the cleanest "no single driver owns the read" -> MODE A cases.

Applying the proposed Gate-2 dominance threshold
(`breadth_ratio >= 1.5 AND score_ratio >= 1.3`) flags exactly 3 of 35 days:
06-04 evening (co:spacex:ipo, br 6.5 / sr 1.32), 06-18 evening (macro:fed, br 1.5
/ sr 1.86), 06-22 morning (macro:fed, br 3.0 / sr 1.30).

Misclassifications / days no threshold cleanly catches (be honest):
1. FALSE POSITIVE without Gate 1: 06-04 evening passes the Gate-2 dominance bar
   on a STALE `co:spacex:ipo` recap (high syndicated breadth, no fresh event).
   The floor model says this should STAY market-wide. Gate 2 alone promotes it;
   only Gate 1 (the tape did not materially move that evening) would correctly
   relegate it. This single day is the cleanest proof that Gate 2 is not
   sufficient without the persisted tape.
2. `co:spacex:ipo` is the top cluster on 8 days spanning the IPO debut window
   (06-04 to 06-16). On most of them breadth is large purely from wire
   syndication of one recurring story, not from a fresh market-moving event.
   Breadth ratio overfits to syndication here (06-12 morning hits br 15.0 yet is
   a stale Western-Digital-headlined day). A staleness/recency gate plus the tape
   is required; breadth ratio alone misranks these.
3. `macro:fed` is STICKY: it is the top cluster on ~18 days regardless of the
   brief headline, because the recent-tier1 / Fed boost (TIER1_BOOST +
   RECENT_EVENT_BOOST in impact_ranking) accumulates Fed coverage every day in a
   FOMC-adjacent window. A high `macro:fed` cluster does NOT by itself mean the
   Fed drove the tape that day. Distinguishing a genuinely Fed-driven day
   (e.g. 06-19, the hawkish dot plot) from a day where Fed coverage merely
   lingered REQUIRES the gen-time tape (Gate 1). No cluster threshold separates
   these two from our records.
4. Headline is an unreliable mode signal on this archive: the brief headline is
   frequently a small single deal while the top cluster is `macro:fed`
   (e.g. 06-17 morning, 06-23 morning), an artifact of the pre-#430 lead-
   selection behavior. The provisional labels lean on headline+tone only as a
   weak tiebreak; they should be replaced by Noah's ground truth.

Bottom line on separation: Gate 2 (cluster dominance) is computable and the
breadth ratio is a usable signal, but on its own it both over-promotes stale
high-breadth single names AND cannot tell a real macro-driven day from accumulated
macro coverage. Both failure modes are resolved only by Gate 1, which needs the
persisted tape. This is why Phase 1 is correctly blocked behind persistence.

## P0.4 PERSISTENCE PROPOSAL (description only — NOT implemented)

Minimal change to make Gate 1 tunable: persist the gen-time tape snapshot
(`tape_obj` from `market_tape.fetch_tape()`, already computed at
`synthesize.py:2324`) on every run. Two options:

1. Preferred (queryable, robust): add a `market_tape JSONB` column to the
   `briefings` table and write `tape_obj` into the insert row at
   `synthesize.py:3022-3068` every run (independent of whether `market_pulse`
   persists). REQUIRES A MIGRATION. This makes Gate-1 backtesting a plain SELECT
   over `briefings.market_tape->'quotes'`.
2. No-migration interim: stamp `tape_obj` as a `tape` sub-object on the
   `market_pulse` dict before insert, mirroring the existing `market_closed`
   stamp pattern (`synthesize.py:3006-3010`). Cheaper, but it only persists when
   `has_pulse` is true (`:3042`), so it is lossy on tape-unavailable days and is
   buried in a TEXT column. Acceptable as a stopgap, not as the long-term store.

Recommendation: option 1 (dedicated JSONB column). It is the only one that makes
Gate 1 a first-class, every-day, queryable field.

## Phase 1 NOT implemented
Phase 1 (T1-T5 gate thresholds) was NOT implemented: stopped at the data
prerequisite per the stop-gate. Phase 2 harness changes were NOT implemented.
No guessed Gate-1 thresholds were shipped.

## Status flags
- HALT after Phase 0.
- REQUIRES LUCAS: the persistence change touches `synthesize.py` (the brief
  insert path) and the briefings schema; route through Lucas.
- REQUIRES MIGRATION: the preferred persistence option (a `market_tape` JSONB
  column on `briefings`) is a migration; agents never apply migrations.

## Needs Noah
1. Fill the `ground_truth_mode` column in
   `backend/tests/fixtures/modes_v2_worksheet.csv` (A/B/C per day) so the
   provisional AGENT labels can be replaced with ground truth.
2. Approve the tape-persistence change (P0.4 option 1, JSONB column) so Gate 1
   becomes tunable.
3. After 1 + 2: re-tune the Gate-2 dominance/sector thresholds against ground
   truth, and tune Gate-1 thresholds against the newly-persisted tape. Then
   Phase 1 can be implemented.
