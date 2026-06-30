# Decouple Market Pulse: always market-wide hero, Today's Lead untouched

Branch: feat/market-pulse-decouple (off post-#435 origin/main, base HEAD 3c9a6444)
Worktree: /Users/noahhanning/sig-pulse

## PHASE 0: RECON

### Control flow: ONE Gemini JSON emits BOTH surfaces

`_generate_brief_json(...)` is the single Gemini JSON call (synthesize.py:1252,
invoked at :2548) that emits the whole brief object `data`, including BOTH:
- `data["market_pulse"]["narrative"]` (the HERO / Market Pulse), and
- the lead block (`headline`, `lead_paragraph`, `supporting_context`,
  `what_to_watch`).

They are coupled: one model call, one JSON, both surfaces share the same chosen
lead subject.

### The coupling guard (the bug), synthesize.py ~:2589-2680

The post-generation "final-lead gate" block runs the grounded market-wide
rewrite on the hero ONLY when the gate relegates the lead to market_wide:

```python
            if _final_gate.get("subject") == "market_wide":      # :2640  <-- the guard
                _mp = data.get("market_pulse")
                if isinstance(_mp, dict) and isinstance(_mp.get("narrative"), str) and _mp["narrative"].strip():
                    _best_title = _lead_title or (data.get("headline") or "")
                    _new = _rewrite_market_wide_grounded(
                        data, tape_obj, _final_corpus_companies, _best_title, article_text
                    )
                    _candidate = _new if _new else _mp["narrative"]
                    _vres = overview_grounding.validate_overview(
                        _candidate, article_text, _final_corpus_companies, tape_obj
                    )
                    ... (one bounded re-ask, then build_minimal_overview fallback) ...
                    _mp["narrative"] = _candidate
```

When `_pregen_passed` is True (the pre-pick gate ran with real breadth and
PASSED, so `_final_gate = _pregen_gate` at :2607 and `subject == "single_name"`),
the `if subject == "market_wide"` guard is FALSE, the rewrite never runs, and the
hero is left exactly as the single-Gemini-chosen single-name read. CONFIRMED:
on gate-PASS the hero is NOT rewritten. That is the Jun 29 Rocket Lab/Iridium $8B
bug: a single deal owned the hero on a broad +1-2% risk-on day.

### Cleanest decoupling point

The rewrite+validate+fallback block (synthesize.py:2640-2680) is the decoupling
point. The fix is to drop the `if _final_gate.get("subject") == "market_wide":`
condition so the grounded market-wide rewrite of `data["market_pulse"]["narrative"]`
runs UNCONDITIONALLY for morning+evening, independent of the gate's lead pick.
The gate still decides the LEAD subject (untouched); the hero is always
re-grounded market-wide. The call site reused as-is:

```python
                    _new = _rewrite_market_wide_grounded(
                        data, tape_obj, _final_corpus_companies, _best_title, article_text
                    )
```

The lead block (`headline`, `lead_paragraph`, `supporting_context`,
`what_to_watch`) is never read or written by this block; only
`data["market_pulse"]["narrative"]` is reassigned (`_mp["narrative"] = _candidate`).
So decoupling here leaves Today's Lead byte-unchanged.

### Grounding inputs confirmed at the decoupling point

- `tape_obj`: fetched ONCE at synthesize.py:2324 via `_maybe_inject_tape_directive`
  (its docstring at :1355 states it returns the raw tape dict "so the caller can
  run ... without a second fetch"). In scope at :2640. Accessors used by the
  rewrite via `_tape_facts_block(tape)` (synthesize.py:1962): `quotes["^GSPC"]`,
  `quotes["^IXIC"]`, `quotes["^RUT"]` (`.pct`), `vix_level`, `regime`. NOTE: Dow
  `^DJI` is NOT currently rendered in `_tape_facts_block` (only GSPC/IXIC/RUT).
  Left as-is (out of scope; honesty preserved by stating only present numbers).
- corpus roster: `_final_corpus_companies` (synthesize.py:2591-2593), built from
  `(spine + floor)` via `_companies_of(a)` (spine + floor companies).
- `article_text`: the candidate corpus body text passed to the rewrite and to
  `validate_overview`.

### overview_grounding can validate/fallback the always-on hero

`overview_grounding.validate_overview(text, corpus_text, roster, tape)`
(overview_grounding.py) runs the ENTITY check (`unsupported_entities`) +
TAPE-claim check (`tape_claim_violations`). On failure the caller does ONE
bounded re-ask then `build_minimal_overview(tape, best_story_title)`. All pure,
no I/O, import-safe, already harness-tested. These work identically whether the
gate passed or relegated, because the hero text is the only input. CONFIRMED.

### COST SECTION (marginal Gemini cost of T1)

(a) Per-brief delta on a gate-PASS single-name day:
Today that branch runs 0 rewrite calls. Under T1 it runs the same code as the
relegate branch: 1 bounded `_rewrite_market_wide_grounded` call, and on a
grounding violation 1 additional bounded re-ask (then a pure-Python
`build_minimal_overview`, no Gemini). So the per-brief delta on a gate-pass day
is +1 Gemini call (worst case +2 if the first rewrite fails grounding). On days
the gate already relegated, NO change (that branch already ran the rewrite).

(b) Fraction of days on the gate-pass-single-name path:
The #433 signals table (`backend/tests/fixtures/modes_v2_signals.json`) is NOT
present on this branch (it ships with #433, unmerged here), so I cannot read the
committed day-type mix. ESTIMATE (stated as estimate): the gate only
affirmatively PASSES a single name when the tape has a material move AND the lead
is the cited driver AND its event cluster has dominant cross-source breadth - a
high bar. On the self-select path the gate can only relegate (never promote), so
those days already run the rewrite. Gate-pass single-name days are the minority:
estimate ~20-35% of trading days clear the pass bar; the rest already relegate
(no delta). Use 30% as a working figure.

(c) Order-of-magnitude monthly dollar delta:
Added calls/brief on a gate-pass day = 1 (worst case 2). Briefs/day = 2 (morning
+ evening). Trading days/month ~= 22. Gate-pass fraction ~= 0.30.
Added calls/month ~= 1 (avg ~1.3 with occasional re-ask) x 2 x 22 x 0.30
  ~= 13 to 17 added Gemini calls/month.
The rewrite is one bounded call: system+user prompt is short (tape facts block +
a <=60-name roster + the current narrative), `max_tokens=1024`. Reusing the known
synthesis per-call size (Gemini 2.5 Flash; a few thousand input tokens + <=1k
output), this call is FAR smaller than the main `_generate_brief_json` synthesis
call. At Gemini 2.5 Flash pricing the per-call cost is a fraction of a cent;
~15 added calls/month is well under ~$0.10/month. ORDER OF MAGNITUDE: cents per
month. NEGLIGIBLE.

(d) NON-Gemini cost: the rewrite REUSES the already-fetched `tape_obj` (passed by
reference; `_tape_facts_block(tape)` only READS it) and the in-memory corpus. It
does NOT re-fetch the tape, quotes, or any network resource. CONFIRMED no
re-fetch. No added DB/network cost.

VERDICT: the marginal cost is negligible (cents/month, ~13-17 added bounded calls/
month). No flag needed.

## PHASE 1: IMPLEMENT

File: backend/synthesize.py. Commit: b0442b50
"feat(brief): always-market-wide Market Pulse hero (decouple from lead gate)".

- T1 ALWAYS-MARKET-WIDE (LANDED): removed the `if _final_gate.get("subject") ==
  "market_wide":` guard at ~:2640. The grounded market-wide rewrite + grounding
  post-check now run on the hero on BOTH the gate-pass and gate-relegate branches,
  for morning and evening. De-indented the block one level; logic otherwise
  identical.
- T2 GROUND IT (LANDED): reuses the existing `_rewrite_market_wide_grounded`
  mechanism (no new mechanism). Its prompt was reframed from "the pre-picked lead
  did NOT clear the gate" to "the Market Pulse hero is ALWAYS a MARKET-WIDE
  synthesis ... a single story appears only as an example". The TAPE-FACTS-only
  characterization and "BREVITY IS ALLOWED" rules are unchanged.
- T3 PRESERVE POST-CHECK (LANDED): `overview_grounding.validate_overview` runs on
  the candidate hero; on failure ONE bounded `_rewrite_market_wide_grounded`
  re-ask, then `build_minimal_overview` fallback. Wiring byte-for-byte preserved
  (only re-indented). No ungrounded hero ships.
- T4 DOMINANT-DRIVER DAYS (LANDED): added a `lead_is_dominant` flag
  (`_final_gate.get("subject") != "market_wide"`). When the gate PASSED (the lead
  genuinely dominates the tape), the rewrite prompt PERMITS the market-wide read to
  CENTER on that event (still as the market's read, not a single-name writeup, not
  a verbatim copy of the lead block). When relegated, the lead is at most a
  one-line example. Nothing forces the hero away from a story that truly is the
  whole market.
- T5 TODAY'S LEAD UNTOUCHED (CONFIRMED): the decoupling block only reads
  `data.get("headline")` (for the example title `_best_title`) and only writes
  `data["market_pulse"]["narrative"]`. It never reads or writes `lead_paragraph`,
  `supporting_context`, `what_to_watch`, or `headline`. `git diff` over
  synthesize.py touches no lead-block field. Today's Lead generation/rendering is
  byte-unchanged.

Self-critique: the only behavior change is that the hero rewrite now also fires on
gate-pass days (the intended fix); on relegate days behavior is identical (same
rewrite, now with lead_is_dominant=False which preserves the prior
lead-as-mention framing). No Lucas file edited, no migration, no runtime Gemini in
tests, no em-dashes in added lines.

## PHASE 2: OFFLINE HARNESS

File: backend/tests/test_lead_overview_offline.py. python3.11 -m unittest.
Result: 44 tests, OK (was 37; +7 new). ALL prior assertions still green,
including Assertion10 (self-select bypass repro) and the grounding post-check
(Assertion11-13). No synthesize import (it builds clients at import); the T1
DECISION is asserted via pure mirror predicates `_rewrite_runs` /
`_lead_is_dominant` matching the production code, plus the pure grounding pieces.

New assertions:
- Assertion16_SingleDealDayAlwaysMarketWide (item 1, the Rocket Lab / Saab Jun 29
  repro): a single fresh deal ("Rocket Lab to Acquire Iridium in $8B") on a broad
  RISK-ON rally tape (S&P +1.32%, Nasdaq +1.55%, Russell +1.69%). Asserts the gate
  PASSES the single name (the pre-T1 bug precondition), the hero rewrite runs
  ANYWAY (`_rewrite_runs` True), the dominant flag is set (T4), the grounded
  market-wide hero leads with the broad tape ("+1.32%") not the deal name, the deal
  is at most a trailing example, it validates clean, and it is not verbatim-
  identical to the lead paragraph.
- Assertion17_DominantDriverDayMayCenter (item 2): a Fed-shock tape (S&P -2.6%,
  VIX +35%) where one event IS the market. The gate passes; the dominant flag is
  set so centering is ALLOWED (not forced away); the down-tape hero asserts no up
  move.
- Assertion18_HeroGroundingCaughtAndThinPoolBrief (items 3 + 4): a hero naming a
  non-corpus entity is caught; a bullish hero against a DOWN tape is caught; the
  thin-pool hero is short (<280 chars, single read), cites the real S&P figure, and
  self-validates.

Re-ask paths (the model rewrite + bounded re-ask) are integration-only (Gemini)
and are NOT asserted, consistent with the prior harness convention.

## STATUS

- HALT: none. Branch is green (offline harness 44 OK; market_tape +
  morning_tape_grounding + org_supported_d8 + opener_guard + impact_ranking = 84
  OK).
- REQUIRES LUCAS: none (no Lucas-protected file edited; the change is entirely
  inside synthesize.run's post-gen block + the rewrite helper).
- REQUIRES MIGRATION: none.
- NEEDS NOAH: review the always-on hero on a real gate-pass day to confirm the
  lead-as-example framing reads well (the model rewrite is not harness-assertable).
  Pre-existing observation (not introduced here): the tape-claim validator uses
  substring matching, so a corpus/title token like "surprises" (contains "rise")
  can false-positive as an up-word; not in scope for this PR.
- COST: negligible (~13-17 added bounded Gemini calls/month, cents/month order of
  magnitude; tape reused, not re-fetched). See Phase 0 COST SECTION.
