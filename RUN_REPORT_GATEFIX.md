# RUN_REPORT_GATEFIX

Branch: fix/gate-on-final-lead (off post-#430 origin/main, HEAD 293fb93c)
Worktree: /Users/noahhanning/sig-gatefix

## PHASE 0: RECON (findings-first, before any edit)

### P0.1 The exact fall-through

`preselected` is set at `backend/synthesize.py:1955`:

```
preselected = impact_pick or deal_pick
lead_source = "impact" if impact_pick else ("deal_preselect" if deal_pick else "gemini")
```

The self-select log is at `:1969-1970`:

```
else:
    print("  🎯 No deterministic lead (Gemini will select)")
```

The overview-subject gate (gate call + D14 + T5) runs ONLY inside
`if brief_type in ("morning", "evening") and preselected:` at `:2163`, gate call
`market_tape.overview_subject_gate(...)` at `:2202-2210`, directive prepend at
`:2211-2213`, T5 overlap at `:2220-2223`, D14 reconcile log at `:2224-2226`.
When `impact_pick` and `deal_pick` are both None, `preselected` is None, the
`:2163` block is skipped entirely, and Gemini's in-prompt PRIMARY STORY
SELECTION block (the prompt at `:109-127` / `:265-283`) picks the lead with NO
gate, NO D14 direction check, NO T5 overlap. THIS is the bypass.

The gate runs BEFORE generation (`data = _generate_brief_json(...)` at `:2371`);
it only injects a prompt directive. On the self-select path nothing constrains
the final lead the model actually chose.

Post-Gemini the lead NAME is resolvable: `data["headline"]` (names the
primary_story), `data["primary_story_id"]` (short identifier), and
`data["top_deals"][i]["company"]` (top_deals schema field is `company`, see
`:178`). So a second, AFTER-generation gate evaluation on the final lead is
feasible.

### P0.2 Resolving the self-selected lead company + session move

The gate needs a company name + a live session move. `_lead_session_move`
(`:1790`) currently takes `preselected` (a dict) and reads `.get("companies")`,
resolves the first via `_resolve_lead_ticker` (`:1768`, HARD_TICKER_OVERRIDES
then finnhub), then `market_tape.fetch_quote(ticker)`.

Adaptation for the self-select path: synthesize a minimal dict from the
generated JSON and reuse `_lead_session_move` unchanged:

```
{"companies": [<resolved name>], "title": data.get("headline"),
 "summary": data.get("lead_paragraph")}
```

Where `<resolved name>` is taken, in priority order, from: the matched corpus
article's `companies[]` (match `data["headline"]`/`primary_story_id` back to a
spine/floor article), else `data["top_deals"][0]["company"]`. If no single name
resolves, default MARKET-WIDE (never promote an unvalidated single name). For
the offline harness the relevant pure surface is the gate + the post-check; the
live company-resolution is integration-only (network in fetch_quote/finnhub).

### P0.3 Grounding inputs

Tape: `_maybe_inject_tape_directive` (`:1351`) returns `(system, tape_regime,
tape_obj)`; called at `:2153`. `tape_obj` = fetch_tape() shape
`{"quotes": {symbol: {price, prev, pct}}, "regime": str, "vix_level": float}`
(`market_tape.py:289`). Accessors: `tape_obj["quotes"]["^GSPC"]["pct"]`,
`["^IXIC"]["pct"]`, `["^VIX"]["pct"]`, `tape_obj["vix_level"]`,
`tape_obj["regime"]`. Tape is present on weekend/thin pools (fetch_tape returns
the prior completed session close); it is None ONLY on a fetch failure, in which
case the post-check soft-fails (no tape -> tape-claim validation is skipped).

Corpus: `spine, floor = _select_articles_for_synthesis(articles)` (`:1989`).
Resolved companies via `_companies_of(a)` (`:2041`). `article_text` (the prompt
corpus string) is built from spine+floor. Existing D8 builds
`_allowed_companies` by `_companies_of` over `spine + floor` (`:2640-2642`).
The post-check reuses these two: corpus titles/text + the resolved-company
roster.

### P0.4 D8 over-flagging (the fragment bug)

`_candidate_orgs` (`:1524`) regex:

```
\b([A-Z][A-Za-z.&'\-]+(?:\s+(?:of\s+|and\s+|&\s+)?[A-Z][A-Za-z.&'\-]+){1,4})\b
```

The token char class `[A-Za-z.&'\-]+` includes the literal `.`. A sentence
period therefore does not break the token: "Western Digital. This" matches as a
single phrase "Western Digital. This" because the `.` is consumed into the
"Digital." token and the run continues to the capitalized "This". Same for
"The Technology" style cross-clause joins. The fix in the rebuilt validator:
split on sentence boundaries first (so a period terminates a candidate), keep
trailing-period stripping, and prefer matching against the resolved
company/ticker roster over naive capitalized-token scanning.

### Output-shape note (for Lucas)
The market-wide rewrite changes ONLY the `market_pulse.narrative` STRING value
inside the existing `market_pulse` JSON. No new column on the `briefings` row,
no new key on `market_pulse`, no SUBJECT_MODE field added. No route file is
edited (the decision rides the existing system-prompt prepend path + a
post-parse narrative rewrite). The headline/lead block is NOT rewritten by this
change.

---

## PHASE 1: IMPLEMENT

All edits in `backend/synthesize.py` and a new pure module
`backend/overview_grounding.py`. No Lucas-protected file touched. No migration,
no prod call, no runtime Gemini added beyond the existing wired re-ask pattern.

### T3 (landed first, commit: pure validator module)
`backend/overview_grounding.py` (new, pure, import-safe):
- `candidate_orgs(text)` splits on sentence terminators FIRST (the D8 fix), then
  extracts capitalized multi-word runs / ticker-like tokens. The org token char
  class EXCLUDES the period, so "Western Digital. This" can never join.
- `org_supported` / `unsupported_entities(text, corpus_text, roster)` = the
  ENTITY check (prefers roster match, distinctive-prefix relaxation, generic-head
  guard ported from D8).
- `tape_claim_violations(text, tape)` = the TAPE check (bullish/up words vs a
  down tape, resilient/rallying vs down, down/risk-off vs up). Neutral/flat tape
  and no-tape both produce no violations (cannot/should-not flag).
- `validate_overview(...)` returns `{ok, unsupported_entities, tape_violations,
  reasons}`.
- `build_minimal_overview(tape, best_story_title)` = the last-resort grounded
  template (tape numbers + at most one corpus story mention), short by design.

### T1 (landed, commit: gate on the FINAL lead)
`backend/synthesize.py`:
- New helpers: `_resolve_final_lead(data, spine, floor, companies_of)` (matches
  headline/primary_story_id back to a corpus article, else top_deals[0].company;
  fail-safe returns no name -> market-wide), `_final_lead_session_move(name,
  title, summary)` (adapts `_lead_session_move` to a NAME from the self-select
  path).
- `_pregen_gate` now captures the pre-pick gate decision.
- New post-generation block (after the stub fallback): re-runs
  `overview_subject_gate` on the FINAL chosen subject on BOTH paths. Honors a
  pre-pick gate that PASSED with real breadth (no re-relegation where breadth is
  unrecomputable post-gen). Fail-safe to MARKET-WIDE when the lead name is
  unresolvable.

### T2 (landed, commit: gate on the FINAL lead)
`_rewrite_market_wide_grounded(...)` + `_tape_facts_block(...)`: ONE bounded
grounded re-ask that binds the market characterization to the fetched tape
numbers (explicit FACTS), constrains named entities to the corpus roster,
demotes the relegated story to at most a mention, and explicitly permits
BREVITY on a thin pool. Wired (gemini_generate), not run by me. The post-check
(`validate_overview`) gates the result: clean -> ship; violation -> ONE re-ask
naming the violation -> still failing -> `build_minimal_overview` fallback.
Every violation logged.

### T4 (SHIPPED scope: FLAG + LOG; reframe DEFERRED)
`_body_ticker_direction_flags(text, corpus_companies)`: for corpus-roster
companies named in the overview body that carry a directional framing, resolve
the ticker and fetch the live quote; FLAG + LOG any whose framing contradicts
the session move (`framing_contradicts_session`). It only checks names already
in the corpus (never invents a name) and soft-fails on any unresolved ticker /
missing quote.
- SHIPPED: detection, logging.
- DEFERRED: actually rewriting the body to reconcile the direction (a full body
  reframe). Needs Noah's call on scope + thresholds (see needs-Noah).

---

## PHASE 2: OFFLINE HARNESS

`backend/tests/test_lead_overview_offline.py` extended (imports the pure
`overview_grounding`; does NOT import synthesize). Five new classes:
- Assertion10 SELF-SELECT BYPASS REPRO (the test that would have caught the prod
  bug): a single self-selected name on a quiet tape -> gate forces MARKET-WIDE.
- Assertion11 POST-CHECK ENTITY + D8 FRAGMENT FIX: absent company flagged;
  "Western Digital. This" and "The Technology" NOT parsed as orgs.
- Assertion12 POST-CHECK TAPE: bullish-vs-down flagged; consistent passes;
  no-tape and flat-tape do not flag.
- Assertion13 BREVITY: minimal grounded template is short, tape-grounded,
  self-validates.
- Assertion14 FAIL-SAFE: unresolvable lead -> market-wide, names no unsupported
  entity.

### Harness results
- `python3.11 -m unittest backend.tests.test_lead_overview_offline`: 35 tests,
  OK (24 prior preserved + 11 new). Includes the bypass-repro assertion.
- `python3.11 -m unittest backend.tests.test_market_tape
  backend.tests.test_impact_ranking backend.tests.test_morning_tape_grounding`:
  68 tests, OK.
- `python3.14 -m unittest backend.tests.test_lead_overview_offline`: 35 tests,
  OK. The py3.14 httpcore import error set is UNCHANGED: it only manifests when
  synthesize.py is imported (it builds clients at import); the offline harness
  deliberately never imports synthesize, so py3.14 is clean here exactly as
  before this change.
- py_compile clean on synthesize.py, overview_grounding.py, and the test file.

### D8 fragment-fix confirmation
`overview_grounding.candidate_orgs("Western Digital. This ...")` yields only
{"Western Digital"} (not "Western Digital. This"); "The Technology ..." yields
no org. Asserted in Assertion11. The rebuilt validator replaces the D8
behavior in `_candidate_orgs` for the overview post-check (the existing D8
section-guard `_candidate_orgs` is left in place untouched to keep that surface
unchanged; the new overview post-check uses the fixed extractor).

### Re-ask paths (unasserted, integration-only)
`_rewrite_market_wide_grounded`, the T4 live-quote fetch, and the existing
temporal/prose/voice re-asks all call the model and/or network; they are NOT
exercised by the offline harness, by design.

---

## Pre-existing test floor (NOT caused by this change)
`backend/tests/test_ingest.py` has 5 failures (2 fail + 3 error) on the BASE
commit 293fb93c, confirmed by checkout. They are in ingest filter-retry logic,
unrelated to synthesize/overview. Branch is green on every suite this change
touches.

## HALT / REQUIRES LUCAS / REQUIRES MIGRATION
- REQUIRES MIGRATION: none.
- REQUIRES LUCAS: none. No Lucas-protected file was edited. The decision rides
  the system-prompt prepend + a post-parse narrative-string rewrite, exactly
  like #430.
- HALT after deliverable per instructions; draft PR opened, NOT merged.

## needs Noah
- T4 scope: confirm whether to promote body-ticker direction from FLAG+LOG to a
  full body reframe (and the trust threshold for fetching live quotes per body
  name vs cost).
- Final thresholds: the post-gen final-lead gate uses
  `cluster_distinct_sources=0` (breadth unrecomputable post-gen) and relies on a
  passed pre-pick gate to keep a genuine dominant-driver story. Confirm this is
  the desired conservatism (it can never PROMOTE a single name post-gen on the
  self-select path; it can only relegate). If you want the self-select path able
  to KEEP a single-name subject when it truly is the driver, we need a gen-time
  breadth signal for the self-selected lead.
- The minimal grounded template wording ("On a quiet tape, ...") is a
  deterministic fallback; confirm the house voice is acceptable for that
  last-resort path.
