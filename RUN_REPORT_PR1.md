# RUN_REPORT_PR1 - Tape-aware materiality ranking + continuity (shadow-first)

Branch: `feat/materiality-ranking` off `origin/main` @ `a24ceefd` (#437, post-#436).
Mode: shadow-first. Does NOT merge, does NOT flip to active.

---

## PHASE 0 - RECON (read-only)

### 0.1 The lead is chosen TAPE-BLIND, before the tape is fetched

The live lead path is `impact_ranking.compute_lead` (= `compute_shadow_lead`), invoked
inside the Path-B block in `backend/synthesize.py`.

**Selection (tape-blind) - `backend/synthesize.py:2126-2148`:**

```python
2126        impact_pick = None
2127        try:
2128            import impact_ranking
2129            _now = datetime.now(timezone.utc)
2130            _pool = impact_ranking.fetch_coverage_pool(supabase, _now)
2131            _impact = (
2132                impact_ranking.compute_lead(
2133                    _pool, _now, mega_deal_urls=impact_ranking._mega_deal_urls(supabase, _now)
2134                )
2135                if _pool else None
2136            )
...
2147        preselected = impact_pick or deal_pick
2148        lead_source = "impact" if impact_pick else ("deal_preselect" if deal_pick else "gemini")
```

`compute_lead` takes only `(pool, now, mega_deal_urls)`. It has **no tape argument** and
does no quote fetch. Its scoring (`impact_ranking.score_clusters`, lines 260-326) blends
`W_DISTINCT_SOURCES`, `W_ARTICLE_COUNT`, `W_RECENCY`, tier-1 / recent-event boosts, and
`MEGA_DEAL_BOOST`. All proxy importance with coverage-breadth / recency / deal-size. None
reference where the market actually moved.

**Tape fetch - `backend/synthesize.py:2342-2345`, ~200 lines LATER:**

```python
2342    tape_regime = None
2343    tape_obj = None
2344    if brief_type in ("morning", "evening"):
2345        system, tape_regime, tape_obj = _maybe_inject_tape_directive(brief_type, system)
```

`_maybe_inject_tape_directive` (synthesize.py) is the first and only `market_tape.fetch_tape()`
call in the synthesis path. Confirmed: **selection @ 2126 precedes tape fetch @ 2345.** The
ranker cannot see the tape. This is the tape-blind ordering.

**What the tape currently drives (and does NOT):** the fetched `tape_obj` feeds the
overview-subject materiality gate at `synthesize.py:2347-2436` (D2/D3 + T1/T3/T5 in
`market_tape.overview_subject_gate`). That gate decides whether the already-chosen lead may
become the market-wide **hero/overview subject** or is relegated to a MENTION - this is the
#436 decoupling. It does **not** change WHICH story is chosen as the lead block. So on
06-30/07-01 the hero was correctly market-wide while the lead block still narrated the
tape-irrelevant deal. PR1 fixes selection; the gate/hero path is untouched.

### 0.2 Hoisting the tape above selection is SAFE

`market_tape.fetch_tape()` (market_tape.py:261-290) is a pure Yahoo read: fetch 5 index/VIX
quotes, compute regime, return `{"quotes", "regime", "vix_level"}`. Nothing between
synthesize.py:2126 and :2345 mutates state the tape depends on, and nothing the tape needs is
produced by the selection block. It can be fetched before selection with no ordering hazard.

To avoid a double network fetch, the plan threads the once-fetched tape into
`_maybe_inject_tape_directive(brief_type, system, tape=<already fetched>)` (new optional
param, default `None` -> fetch as before). This keeps exactly one `fetch_tape()` per brief
and leaves the grounding-critical tape path (#435 serializer) behaviorally identical when the
param is omitted.

### 0.3 Materiality signals available NOW

From the persisted native `market_tape` snapshot (`serialize_tape_snapshot`, per-index
`{pct, level}` for sp500/nasdaq/dow/russell + `vix_level` + `vix_pct` + `regime`) plus the
live `tape_obj`, plus `market_tape.fetch_quote(symbol)` per ticker, plus each article's
resolved `companies[]` / `deal_type` / `sector`:

**CAN compute now (pure, deterministic):**
- **Is the tape material and broad?** `market_tape.tape_has_material_move(tape)` already exists
  (|S&P%| >= 1.0 or |VIX%| >= 8.0). Broad = multiple indices moving the same direction / a
  non-neutral regime. On 06-30 evening (S&P +1.18, Nasdaq +2.07, VIX -4.13%) the tape is
  material + risk-on.
- **Is a cluster's named ticker a tape driver, and direction-consistent?**
  `market_tape.build_tape_driver_names({name: pct})` +
  `story_companies_are_tape_drivers(...)` + `classify_framing` / `framing_contradicts_session`
  already exist (used by the overview gate). At gen time the per-name move comes from
  `fetch_quote` / `_lead_session_move`; in the offline backtest it comes from the CSV
  `named_movers` percents.
- **Broad vs concentrated:** cluster is `macro:*` (market-wide) vs `co:*` single-name;
  cross-source breadth via `distinct_sources` (already computed in `score_clusters`).
- **US-relevance:** detect foreign-market / foreign-currency markers in cluster text
  (rupee / ₹ / "Indian" / non-USD-denominated stake sale, e.g. GIC/Genus) with no US-ticker
  signal -> demote. The GIC/Genus rupee stake sale scores LOW because it did not move the US
  tape and is US-irrelevant.

**CANNOT compute yet (out of scope, the largest lift):** true index-weight attribution -
decomposing the S&P/Nasdaq move into per-constituent contribution to prove a named story is
THE driver. We approximate "plausible driver" with direction-consistency + breadth + a
material broad tape; we do not claim exact attribution.

### 0.4 Labeled CSV - location + format

- **File:** `pr1_materiality_labels.csv` (currently untracked in the main working tree,
  created 2026-07-01). PR1 copies it into the branch at
  `backend/tests/fixtures/pr1_materiality_labels.csv` so the offline harness has a
  committed, version-controlled source. Accrues FORWARD (Option A, no backfill).
- **Header:** `date_session, sp_pct, nasdaq_pct, dow_pct, russell_pct, vix, sectors_moved,
  named_movers, press_cause_urls, brief_actually_led_with, SUGGESTED_mode, SUGGESTED_lead,
  flags, NOAH_RATIFIED_mode, NOAH_RATIFIED_lead, NOAH_notes`
- **Ground truth = `NOAH_RATIFIED_*`.** `SUGGESTED_*` is advisory only, NOT the label.
- **Ratified filter:** a row counts only when `NOAH_RATIFIED_mode` is non-empty.
- **Tape filter (inherit from the CSV header):** read only rows whose brief had recorded tape
  (native `market_tape` jsonb object, or a successfully parsed string-tape row); SKIP null-tape
  rows. All rows in this CSV are >= 2026-06-30 and carry a recorded tape.
- **Currently ratified: 1 row** (as of Phase 0 recon; see Phase 2 for the current ratified
  count, which grew to 2 when the CSV accrued the 07-01 morning row mid-task) -
  `2026-06-30 evening`, `NOAH_RATIFIED_mode = A`
  (market-wide), `NOAH_RATIFIED_lead = "market-wide tech-led rally (Rocket Lab / Comcast as
  deal examples)"`. The `2026-06-30 morning` row is present but UNRATIFIED (blank
  `NOAH_RATIFIED_*`) and is skipped by the harness.
- **Mode A** in this CSV = market-wide read (the day had no single-name owner of the tape).
  The keystone test: on the ratified 06-30 evening row the new ranker must NOT choose the
  single Rocket Lab/Iridium deal as the lead.

### 0.5 Continuity (T2) - reading the prior brief's lead

The evening path already fetches the morning brief's headline for a soft dedup directive
(`synthesize.py:2285-2325`, `briefings.select("headline, lead_paragraph")` filtered to
today's morning). That is a Gemini-facing hint, not a deterministic guard, and there is no
morning-side equivalent (morning has no prior-brief lookup). T2 adds a deterministic
`fetch_prior_lead(supabase, brief_type)` that reads the immediately-prior brief's `headline`
(most recent `briefings` row before now) and a pure `continuity_decay(...)` that heavily
decays a cluster whose lead title fuzzy-matches the prior brief's headline, so the same story
cannot lead two consecutive briefs (the Rocket Lab repeat).

---

## PHASE 1 - IMPLEMENTATION

All behind `MATERIALITY_RANK_MODE` (off | shadow | active), now default **shadow** (logs the
divergence, serves the existing lead unchanged; see the flag flip below). Selection-only:
the #431 final-lead gate, the #436 always-market-wide hero, and the grounding post-check are
untouched (verified: the diff has no hunk in the overview-subject gate / grounding regions).

### T1 - Tape-aware materiality score (`backend/impact_ranking.py`)
`compute_materiality_lead(pool, now, *, tape, name_session_pct, prior_lead_title, mega_deal_urls)`
is a **pure DELTA** on top of the tape-blind `score_clusters`. The tape dict and any per-name
session moves are PASSED IN; the module makes no network call and imports no network module.
Two tiers, so a MATERIAL day (06-30 evening) and an IMMATERIAL divided day (07-01 morning) both
resolve market-wide:

- **Penalties (any present tape):**
  - `MAT_US_IRRELEVANT_PENALTY` (6.0): a foreign / non-USD story with no US anchor (rupee /
    crore / Sensex / "Indian" markers) cannot own the US tape. Demotes GIC/Genus.
  - `MAT_DEAL_NOT_DRIVER_PENALTY` (10.0, ~neutralizes `MEGA_DEAL_BOOST`): a single-name pure-deal
    cluster that is NOT a confirmed tape driver AND lacks dominant breadth
    (`distinct_sources < 6`) falls back to competing on organic breadth + recency. A genuinely
    broadly-covered deal is exempt and still leads.
- **Bonuses (material tape only):**
  - `MAT_MARKET_WIDE_BONUS` (5.0): a market-wide cluster (macro:* or broad-market vocabulary)
    on a real move.
  - `MAT_TAPE_DRIVER_BONUS` (4.0): a cluster whose named company is a confirmed driver moving
    WITH the tape.
  - `MAT_DIRECTION_CONTRADICTION_PENALTY` (4.0): a named mover contradicting a material tape.

`tape_pcts` reads BOTH the live tape shape (`quotes[^GSPC].pct`) and the persisted snapshot
shape (`indices.sp500.pct`), so the same code grades gen-time and the backtest.

### T2 - Continuity guard (`_continuity_decay`, `CONTINUITY_DECAY` = 12.0)
Decays a cluster whose lead-article title matches the immediately-prior brief's lead
(>=0.6 Jaccard on significant tokens, or a shared content signature), so the same story
cannot lead two consecutive briefs (the Rocket Lab repeat). Reading the prior lead:
`synthesize._fetch_prior_brief_lead()` SELECTs the most-recent `briefings.headline` (any type;
the current brief is not written until after synthesis, so the newest row IS the prior brief).

### T3 - Flag + shadow-first wiring (`backend/synthesize.py`)
`MATERIALITY_RANK_MODE` mirrors the `RELEVANCE_GRADE_MODE` three-state precedent.
- **shadow:** runs the re-rank, prints + logs the divergence vs the shipped lead to the run
  decision log (`lead_preselect._LAST_DECISION_LOG.materiality_*`), serves the existing lead
  UNCHANGED.
- **active:** replaces the pick BEFORE the slot-0 hoist + directive build; `lead_source="materiality"`.
- **off / any error:** current behavior. Fails closed.

One `fetch_tape()` per brief: the tape fetched at selection time is threaded into
`_maybe_inject_tape_directive(brief_type, system, tape=...)` (new optional param, default None
→ fetch as before), so the grounding path is behaviorally identical and there is no double fetch.

**Shadow-divergence log location + read-back.** The block writes the `materiality_*` keys into
`lead_preselect._LAST_DECISION_LOG`, which `run.py` snapshots and `observe.record_run` persists
verbatim into the existing **`pipeline_runs.preselect_decision`** JSONB column (confirmed jsonb;
no new table, no migration). Keys: `materiality_mode`, `materiality_lead_title`,
`materiality_cluster`, `materiality_base_cluster`, `materiality_score`, `materiality_base_score`,
`materiality_delta`, `materiality_continuity_delta`, `materiality_reasons`,
`materiality_diverged_from_shipped`, `materiality_prior_lead` (plus the existing shipped-lead
telemetry: `lead_source`, `impact_lead_title`, `impact_lead_cluster`).

Read back what the ranker WOULD have led each day during accrual (SELECT-only):

```sql
select created_at, brief_type,
       preselect_decision->>'materiality_mode'                  as mode,
       preselect_decision->>'materiality_diverged_from_shipped' as diverged,
       preselect_decision->>'lead_source'                       as shipped_source,
       preselect_decision->>'impact_lead_title'                 as shipped_lead,
       preselect_decision->>'materiality_lead_title'            as materiality_would_lead,
       preselect_decision->>'materiality_cluster'               as materiality_cluster,
       preselect_decision->>'materiality_base_cluster'          as base_cluster,
       preselect_decision->'materiality_reasons'                as reasons,
       preselect_decision->>'materiality_prior_lead'            as prior_lead
from pipeline_runs
where preselect_decision ? 'materiality_mode'
order by created_at desc
limit 30;
```

`diverged=true` rows are the days the materiality ranker would have chosen a different lead than
the one that shipped; those are the cases to eyeball against the recorded tape.

### T4 - Preservation
Verified selection-only. The diff touches: the flag block, the selection block, the
`_fetch_prior_brief_lead` helper, the optional `tape=` param on `_maybe_inject_tape_directive`,
and the single tape-thread line. No hunk in `overview_subject_gate` / `build_overview_subject_directive`
/ `enforce_tape_consistency` (the one `enforce_tape_consistency` line in the diff is an unchanged
docstring context line). No Lucas-protected / propose-only file touched.

## PHASE 2 - BACKTEST HARNESS

`tools/materiality_backtest.py` - fully offline (NO prod, NO Gemini, NO network).

- Reads ratified rows from `backend/tests/fixtures/pr1_materiality_labels.csv`
  (`NOAH_RATIFIED_mode` set AND a recorded tape; null-tape and unratified rows skipped).
- For each day: loads the PERSISTED tape from the CSV row + a FROZEN candidate pool from
  `backend/tests/fixtures/materiality_pools/<date_session>.json` (reconstructed from the row's
  `brief_actually_led_with` + `named_movers` + `press_cause_urls`).
- Runs the tape-blind base ranker and the materiality ranker, classifies each lead as mode A
  (market-wide) or B (single-name/deal), prints per-day agreement.
- Newly-ratified days are auto-picked-up once their pool fixture is added (a ratified row with
  no fixture is reported `PENDING-POOL`, not a failure).

**Keystone (06-30 evening, ratified mode A):** PASS - the materiality ranker does NOT lead the
single Rocket Lab/Iridium deal (base picks it at 18.1 via the mega-deal boost; materiality demotes
it −10 to 8.1) and lands market-wide ("Stocks Rally to Start a Big Holiday Week"), matching the
ratified market-wide read.

**Per-day agreement (currently ratified):**

| date_session | ratified | base lead | materiality lead | agree |
|---|---|---|---|---|
| 2026-06-30 evening | A | Rocket Lab/Iridium $8B (deal) | Broad rally / market-wide | ✓ A |
| 2026-07-01 morning | A | KKR/EDF $4.2bn (deal) | ADP payrolls / market-wide | ✓ A |

Agreement: **2/2 (100%)**. With n=2 this is **indicative, not conclusive** (stated in the harness
output). Note the 07-01 pool is RECONSTRUCTED from the label row: the base ranker there leads the
confirmed $4.2bn KKR mega-deal rather than the live GIC/Genus micro-cap pick, but the point holds
(a deal-mode lead corrected to market-wide, and GIC/Genus is itself demoted −16).

**Both currently-ratified days are Mode A (market-wide), so the current 2/2 only tests the
RELEGATE path, not the PROMOTE path.** A ranker that always relegates to market-wide would also
score 100% here. The 2/2 is therefore indicative only and does NOT yet validate that the ranker
correctly promotes a single story when one legitimately should lead. See the go-live gate below.

Prior suites kept green: 102 tests across `test_impact_ranking`, `test_market_tape`,
`test_lead_overview_offline` (which cover the #431 / #436 / grounding assertions) plus 16 new
offline tests (`test_materiality_ranking`, `test_materiality_backtest`). ruff clean.

## WHAT NEEDS NOAH

1. **Ratify the score weights / thresholds** (all named constants in `impact_ranking.py`):
   `MAT_DEAL_NOT_DRIVER_PENALTY` (10.0), `MAT_US_IRRELEVANT_PENALTY` (6.0),
   `MAT_MARKET_WIDE_BONUS` (5.0), `MAT_TAPE_DRIVER_BONUS` (4.0),
   `MAT_DIRECTION_CONTRADICTION_PENALTY` (4.0), `CONTINUITY_DECAY` (12.0),
   `MAT_MIN_DISTINCT_SOURCES` (6), the `_FOREIGN_MARKERS` / `_MARKET_WIDE_TERMS` vocab, and the
   driver rule (`_MAT_DRIVER_MIN_ABS_PCT` 2.0 / top-3). These are v1 and deliberately tunable.
2. **Go-live gate (B/C requirement).** `MATERIALITY_RANK_MODE` is now **shadow** (logs only,
   nothing served changes). Promote shadow -> active ONLY when the backtest agrees with the
   ratified labels on **>= 8-10 days AND that label set includes at least 2 genuine B (or C)
   days where a single story legitimately should lead.** Rationale: all current ratified days
   are Mode A; a ranker that always relegates to market-wide would also score 100% on an all-A
   set. The discriminating test is whether the ranker correctly PROMOTES a single story on a
   B/C day. **An all-A label set, at any size, does NOT satisfy this gate.** The present 2/2 is
   two Mode-A days and is indicative only (it does not test the promote path).
3. **Ratify more days:** fill `NOAH_RATIFIED_mode` / `NOAH_RATIFIED_lead` in the labels CSV as
   days accrue (the 06-30 morning row is present but unratified today). Each newly-ratified day
   needs a frozen-pool fixture added under `materiality_pools/` to be graded offline.
4. **Optional accuracy lift (follow-up, not in this PR):** feed gen-time per-name session moves
   into the shadow ranker (`name_session_pct`) via `fetch_quote` / `_lead_session_move` so the
   driver bonus + contradiction penalty fire live; today the gen path passes `None` (conservative:
   deals are demoted when the tape is material rather than confirmed as drivers).

## STATUS

- **HALT:** implementation complete, flag now defaults **shadow** (logs the divergence to
  `pipeline_runs.preselect_decision`, serves the existing lead unchanged; no served brief moves).
  Draft PR opened; NOT merged; NOT flipped to active.
- **REQUIRES LUCAS:** none. No Lucas-protected / propose-only file was edited
  (`briefing/route.ts`, `MemoModal.tsx`, `watchlist-utils.ts`, `WatchlistAddInput.tsx`,
  `trends/page.tsx`, `memo/route.ts` all untouched).
- **REQUIRES MIGRATION:** none. The shadow divergence rides the existing in-memory run decision
  log; no schema change.
