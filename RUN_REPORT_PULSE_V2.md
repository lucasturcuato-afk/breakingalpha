# MARKET_PULSE_V2 run report

Dedicated tape-first Market Pulse generation, behind env flag `MARKET_PULSE_V2` (default OFF).
Branch: `feat/market-pulse-v2`, off `origin/main` HEAD `2aae8ecd`.
Worktree: `/Users/noahhanning/sig-pulsev2` (isolated).

================================================================
## PHASE 0: RECON
================================================================

### Where `market_pulse.narrative` is produced today

1. **Monolithic synthesis (source of the field).** `_generate_brief_json(system, user_content)`
   (backend/synthesize.py:1269) makes ONE `gemini_generate` call at synthesize.py:2732
   (`data = _generate_brief_json(system, f"Today's articles:\n\n{article_text}")`). The
   response schema embeds `market_pulse` as a nested object with `narrative`,
   `sentiment_word`, and `market_tone` (schema literal at synthesize.py:181 for morning
   and :337 for evening). The narrative is one field of the article-dominated monolith,
   which is exactly why it anchors on the lead story's sector.

2. **The #436 always-market-wide rewrite (post-gen block).** After the monolith parses,
   the final-lead gate block at synthesize.py:2773-2895 runs on morning + evening:
   - `_resolve_final_lead(...)` + `market_tape.overview_subject_gate(...)` decide
     `_final_gate` and `_lead_is_dominant = (_final_gate.get("subject") != "market_wide")`.
   - `_rewrite_market_wide_grounded(...)` (synthesize.py:2079) does ONE grounded re-ask
     that rewrites ONLY `market_pulse.narrative` (synthesize.py:2840).
   - `overview_grounding.validate_overview(...)` (synthesize.py:2845) runs the pure ENTITY
     + TAPE post-check on the candidate; on violation ONE bounded re-ask
     (synthesize.py:2853), then `overview_grounding.build_minimal_overview(...)`
     (synthesize.py:2866/2871) as the last-resort grounded template.
   - The result is written back at synthesize.py:2878 (`_mp["narrative"] = _candidate`).

3. **D13 temporal normalization.** synthesize.py:2907+ normalizes relative-time tokens in
   `headline`, `lead_paragraph`, and `market_pulse.narrative` (via
   `temporal_grounding.normalize_relative_time`), running AFTER the rewrite block.

### V2 replace-vs-preserve map

| Stage | Today | V2 (flag ON) |
|---|---|---|
| Field origin | Monolith produces `market_pulse.narrative` | Monolith still produces it; V2 OVERWRITES it with a dedicated tape-first call BEFORE the rewrite block |
| `_rewrite_market_wide_grounded` re-ask | runs on the monolith narrative | runs on the V2 narrative (PRESERVED, unchanged) |
| `overview_grounding.validate_overview` post-check | PRESERVED | PRESERVED, runs on the V2 narrative |
| `build_minimal_overview` fallback | PRESERVED | PRESERVED |
| D13 temporal normalization | PRESERVED | PRESERVED, runs on the V2 narrative |
| `enforce_tape_consistency` sentiment_word / market_tone | PRESERVED (runs at synthesize.py:2743, BEFORE the final-lead block) | PRESERVED; V2 does NOT touch sentiment_word, so the banner word stays regime-derived |

**What V2 REPLACES:** only the *content* of `market_pulse.narrative`, injected once
BEFORE the existing final-lead rewrite block. **What V2 PRESERVES:** the entire grounding
post-check chain (rewrite re-ask, validate_overview, minimal-template fallback) and the
D13 temporal normalizer, which all still run on the new narrative. `sentiment_word` and
`market_tone` continue to come from the monolith + `enforce_tape_consistency`, untouched.

### In-process inputs available at the injection point (synthesize.py ~2836)

- **tape_obj** (`market_tape.fetch_tape()` result, hoisted via `_maybe_inject_tape_directive`
  at synthesize.py:2507): `{"quotes": {"^GSPC"/"^IXIC"/"^DJI"/"^RUT"/"^VIX": {price, prev,
  pct}}, "regime": "risk-on"|"risk-off"|"neutral", "vix_level": float}`. Accessor for the
  fact block already exists: `_tape_facts_block(tape)` (synthesize.py:2053) renders
  "S&P 500 +0.26%; Nasdaq +0.39%; VIX 15.8. Regime: NEUTRAL".
- **top stories** (`spine` + `floor`, assigned at synthesize.py:2343): each article dict has
  `title`, `sector`, `industry_verticals`, `companies`, `summary`/`content` (one-liner via
  `_spine_body`), `relevance_reason`. `_companies_of(a)` resolves the roster.
- **macro strip** (`macro_panel`): built as `{"releases": [asdict(MacroRelease)...],
  "periods": {...}, "fired_today": [...]}` at synthesize.py:3459, from
  `macro_calendar.fetch_macro_releases() + bea_calendar.fetch_bea_releases()`. Each
  `MacroRelease` = `{key, name, period, figures:[{label, value, unit, prior}], ...}`
  (CPI/core_cpi/PPI/nonfarm_payrolls/unemployment + BEA GDP/PCE). NOTE: today this is
  fetched POST-INSERT and MORNING-ONLY (synthesize.py:3431). It is NOT in-process at the
  narrative-rewrite point. V2 builds a compact macro strip lazily via the SAME fetchers
  (soft-fail to empty), so the dedicated call gets the macro backdrop without changing the
  existing morning macro_panel write.
- **prior-session context**: `_fetch_prior_brief_lead()` (synthesize.py:1369) returns the
  immediately-prior brief headline (read-only, soft-fail None). Cheap; threaded as
  `prior_ctx`.
- **per-name session moves**: `market_tape.fetch_quote(sym)` exists but is a network call;
  V2 does NOT add per-name fetches (the tape indices + VIX are the market read; stories are
  color).

### Sentiment / pulse WORD derivation (kept consistent)

- The banner word (`sentiment_word`) is constrained to `market_tape.REGIME_VOCAB[regime]`
  (market_tape.py:127): risk-off -> heavy/defensive/fragile/...; risk-on ->
  buoyant/steady/resilient; neutral -> mixed/divided/split/choppy. `market_tone` is
  `REGIME_MARKET_TONE[regime]` (market_tape.py:137). `enforce_tape_consistency`
  (market_tape.py:621, called at synthesize.py:2743) overrides an out-of-subset word to the
  regime default and forces `None` when the tape is missing.
- V2 does NOT set `sentiment_word`; it only replaces `narrative`. The V2 prompt is TOLD the
  regime and the allowed vocabulary so the prose mood matches the banner word, and the
  existing `enforce_tape_consistency` (already run before the final-lead block) remains the
  authority on the word itself. Consistency is preserved.

================================================================
## PHASE 1: `generate_market_pulse()` (backend/synthesize.py)
================================================================

New function `generate_market_pulse(brief_type, tape, macro, top_stories, prior_ctx=None)`
plus two helpers: `_pulse_macro_strip()` (lazy, soft-fail, reuses the SAME
macro_calendar + bea_calendar fetchers) and `_pulse_top_stories(spine, floor, companies_of_fn, limit=5)`
(pure reduction of the ranked spine/floor to title + one-liner + sector + companies).

### Exact inputs to the dedicated call
- `brief_type` -> claim-scope framing (morning = opened/opening/early-session; evening = closed).
- `tape` = `tape_obj` (fetch_tape dict: all indices + VIX + regime), rendered via the
  existing `_tape_facts_block`.
- `macro` = compact macro strip string (CPI/core CPI/PPI/payrolls/unemployment + BEA
  GDP/PCE, label + value + prior); `(no fresh macro prints)` when empty.
- `top_stories` = top 5 ranked stories, COLOR ONLY (title + sector + one-liner).
- `prior_ctx` = prior brief lead headline via `_fetch_prior_brief_lead()`.

### Prompt contract (stated in the prompt AND enforced by the post-check)
- Paragraph 1 is the index-level equity read (S&P / Nasdaq / breadth / VIX) with the
  macro backdrop woven in. No single company and no single sector may be the SUBJECT of
  paragraph 1.
- Stories appear only as one-line examples after the market read; never the subject; the
  pulse must never read as a single-sector overview.
- Direction characterized ONLY from the TAPE FACTS; regime-consistent mood (the allowed
  REGIME_VOCAB words are surfaced so the prose matches the banner word).
- Claim scope by brief_type (morning: never a settled whole-day close; evening: close allowed).
- Brevity allowed on a thin tape.

ONE bounded `gemini_generate` call (temperature 0.3, max_tokens 1024, JSON-only), +1
call/brief. Gemini is wired but NEVER called at import time.

### Deterministic post-check additions (backend/overview_grounding.py, pure)
- `opening_has_market_terms(text)`: opening paragraph must reference a tape figure, an
  index name, a regime word, or a market/breadth term. FLAG if absent (requirement a).
- `opening_subject_is_single_focus(text, roster)`: FLAG when the opening SENTENCE LEADS
  with a corpus company/ticker or a lone sector label and does not open on an index
  name / tape figure (requirement b). A later market term as an OBJECT
  ("Insurance dominated the tape") does not rescue a sector-led open.
- `opening_claim_scope_violation(text, brief_type)`: FLAG a morning opening that asserts a
  settled whole-day close.
- `validate_pulse_opening(text, roster, brief_type)`: aggregates the three into
  `{"ok", "reasons"}`.

### Wire-in (synthesize.py, inside the final-lead block, BEFORE the existing rewrite)
When `MARKET_PULSE_V2` is on and `market_pulse` is a dict: build top_stories + macro +
prior_ctx, call `generate_market_pulse`, run `validate_pulse_opening`; on violation ONE
bounded re-ask, then `build_minimal_overview` (leads with the tape by construction, never
a sector-as-market hero). Overwrite `_mp["narrative"]`, then the EXISTING
`_rewrite_market_wide_grounded` + `validate_overview` + `build_minimal_overview` chain and
the LATER D13 temporal normalization all run on the new narrative (PRESERVED). Soft-fail:
on any miss the monolith narrative is kept. `sentiment_word` / `market_tone` are untouched
(the banner word stays regime-derived via `enforce_tape_consistency`).

================================================================
## PHASE 2: OFFLINE HARNESS (no prod, no Gemini, no writes)
================================================================

Added to backend/tests/test_lead_overview_offline.py (imports pure modules only;
synthesize.py is NOT imported). New classes:
- **Assertion19_PulseInsuranceSectorSubjectFlagged** (THE flag test): an
  insurance-sector-subject opening is FLAGGED; a single-company opening is FLAGGED; a
  tape-first opening (index terms + regime, sector only as color) PASSES; plus the
  `opening_has_market_terms` predicate.
- **Assertion20_PulseClaimScopeByBriefType**: a morning settled whole-day close verdict is
  FLAGGED; prior-close / into-the-open morning framing PASSES; an evening close verdict is
  ALLOWED and passes.
- **Assertion21_PulseThinTapeBrevityReachable**: the minimal grounded fallback (what the
  wire-in falls back to) is short, tape-grounded, and passes the pulse opening check.

### Results (python3.11)
- `backend.tests.test_lead_overview_offline`: **52 tests OK** (was 44; +8 new). Includes the
  insurance-sector-subject FLAG test and all prior #431 Assertion10-18 + grounding + temporal.
- `test_materiality_ranking + test_materiality_backtest + test_market_tape +
  test_morning_tape_grounding + test_opener_guard + test_impact_ranking`: **96 tests OK**.
- Full `backend/tests` discovery: 562 tests, **5 failures + 3 errors that PRE-EXIST on the
  clean base** (`2aae8ecd`, verified via `git stash`: identical 5 failures + 3 errors at
  554 tests). They live in `test_ingest` (filter orchestration) and `test_run_degraded`,
  unrelated to this change. This change adds 8 tests and introduces ZERO new failures.
- `py_compile` OK; `ruff check` on both edited py files: all checks passed.

NOTE (stated plainly): prose QUALITY is not harness-assertable. The flag-off default exists
so Noah eyeballs the first real render before flipping it on.

================================================================
## COST DELTA
================================================================
+1 bounded Gemini call per brief when the flag is ON (JSON-only, max_tokens 1024, ~the
size of the existing `_rewrite_market_wide_grounded` re-ask, which is smaller than the
4096-token monolith). On a violation, ONE additional bounded re-ask can fire (same as the
existing grounding re-ask pattern). At 2 briefs/day (morning + evening) that is ~2 extra
calls/day = ~60/month baseline, ~120/month worst case if every brief re-asks. At Gemini
2.5 Flash pricing this is order-of-magnitude a few cents/month. When the flag is OFF: zero
extra calls.

================================================================
## FLAG-OFF BYTE-IDENTICAL CONFIRMATION
================================================================
`MARKET_PULSE_V2 = os.environ.get("MARKET_PULSE_V2", "").strip().lower() in ("1","true","yes","on")`
-> default `""` -> `False`. Both `generate_market_pulse(...)` call sites are inside
`if MARKET_PULSE_V2 and isinstance(_mp, dict):`. With the flag off the entire V2 block is
skipped: the monolith-produced `market_pulse.narrative` flows unchanged into the existing
`_rewrite_market_wide_grounded` + `overview_grounding.validate_overview` +
`build_minimal_overview` chain and the D13 temporal normalizer, exactly as today.
`sentiment_word` / `market_tone` are never touched by V2. The new pure functions in
overview_grounding.py are additive (no existing symbol changed), so nothing else moves.
Behavior is byte-identical to today when off.

================================================================
## HALT / REQUIRES LUCAS / REQUIRES MIGRATION / NEEDS NOAH
================================================================
- **HALT**: done. No merge, no push to main, no migration, no prod pipeline run, no email,
  no runtime Gemini call executed (the V2 call is wired but the flag is OFF and the harness
  tests only pure functions).
- **REQUIRES LUCAS**: none. No Lucas-protected file touched
  (briefing/route.ts, MemoModal.tsx, watchlist-utils.ts, WatchlistAddInput.tsx,
  trends/page.tsx are all untouched).
- **REQUIRES MIGRATION**: none. V2 rides the existing `market_pulse.narrative` field.
- **NEEDS NOAH**:
  1. Eyeball the first real morning + evening render with `MARKET_PULSE_V2=1` set in a
     controlled run before flipping it on in prod (prose quality is not harness-assertable).
  2. Decide the rollout: the flag is env-gated and default off; suggest a supervised manual
     run first, then a shadow/A-B window if desired.
  3. Pre-existing 5 failures + 3 errors in `test_ingest` / `test_run_degraded` on the base
     commit are unrelated to this work but worth a separate look.
