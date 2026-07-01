# RUN_REPORT_PR1 — Tape-aware materiality ranking + continuity (shadow-first)

Branch: `feat/materiality-ranking` off `origin/main` @ `a24ceefd` (#437, post-#436).
Mode: shadow-first. Does NOT merge, does NOT flip to active.

---

## PHASE 0 — RECON (read-only)

### 0.1 The lead is chosen TAPE-BLIND, before the tape is fetched

The live lead path is `impact_ranking.compute_lead` (= `compute_shadow_lead`), invoked
inside the Path-B block in `backend/synthesize.py`.

**Selection (tape-blind) — `backend/synthesize.py:2126-2148`:**

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

**Tape fetch — `backend/synthesize.py:2342-2345`, ~200 lines LATER:**

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
become the market-wide **hero/overview subject** or is relegated to a MENTION — this is the
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

**CANNOT compute yet (out of scope, the largest lift):** true index-weight attribution —
decomposing the S&P/Nasdaq move into per-constituent contribution to prove a named story is
THE driver. We approximate "plausible driver" with direction-consistency + breadth + a
material broad tape; we do not claim exact attribution.

### 0.4 Labeled CSV — location + format

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
- **Currently ratified: 1 row** — `2026-06-30 evening`, `NOAH_RATIFIED_mode = A`
  (market-wide), `NOAH_RATIFIED_lead = "market-wide tech-led rally (Rocket Lab / Comcast as
  deal examples)"`. The `2026-06-30 morning` row is present but UNRATIFIED (blank
  `NOAH_RATIFIED_*`) and is skipped by the harness.
- **Mode A** in this CSV = market-wide read (the day had no single-name owner of the tape).
  The keystone test: on the ratified 06-30 evening row the new ranker must NOT choose the
  single Rocket Lab/Iridium deal as the lead.

### 0.5 Continuity (T2) — reading the prior brief's lead

The evening path already fetches the morning brief's headline for a soft dedup directive
(`synthesize.py:2285-2325`, `briefings.select("headline, lead_paragraph")` filtered to
today's morning). That is a Gemini-facing hint, not a deterministic guard, and there is no
morning-side equivalent (morning has no prior-brief lookup). T2 adds a deterministic
`fetch_prior_lead(supabase, brief_type)` that reads the immediately-prior brief's `headline`
(most recent `briefings` row before now) and a pure `continuity_decay(...)` that heavily
decays a cluster whose lead title fuzzy-matches the prior brief's headline, so the same story
cannot lead two consecutive briefs (the Rocket Lab repeat).

---

## PHASE 1 — IMPLEMENTATION

_(filled in as T1-T4 land)_

## PHASE 2 — BACKTEST HARNESS

_(filled in after the harness lands)_

## WHAT NEEDS NOAH

_(final section)_
