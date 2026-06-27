# Lead trust run report (branch fix/lead-trust, stacked on #427 -> #422 -> main)

## PHASE 0: RECON (read-only, findings-first)

### P0.1 EVENING PATH: shared generation, single primary_story drives both surfaces

The evening wrap is the SAME backend generation as the morning brief. `backend/synthesize.py:run(brief_type="morning"|"evening")` produces ONE Gemini JSON containing `headline`, `lead_paragraph`, `supporting_context`, `what_to_watch`, and `market_pulse.narrative`. There is NO separate "Today's Story" assembly in the backend.

Both evening surfaces are rendered from that single JSON in `src/app/evening-wrap/page.tsx`:
- "The Close" overview body = `briefing.market_pulse.narrative` (`closeBody`, line ~505):
  `briefing?.market_pulse?.narrative || briefing?.summary || briefing?.lead_paragraph || <fallback>`
- "Today's Story" card = `briefing.headline` (line ~1016) plus `leadCards` (lines ~547-553):
  `{ label: "The Story", body: briefing?.lead_paragraph ... }`, The Context = `supporting_context`, What to Watch = `what_to_watch`.

They resolve identically because the SAME deterministic `primary_story` pre-pick (`lead_preselect.preselect_primary_story`, hoisted into spine slot 0) constrains BOTH the lead block AND, absent a relegating gate, the `market_pulse.narrative` subject. The line that lets them collapse: the overview-subject gate exists precisely to "break the inheritance where the market_pulse overview subject = the pre-picked lead" (`synthesize.py:2124` comment). When the gate passes (or is inert), the narrative is allowed to center on the same pre-picked story the lead block narrates.

### P0.2 D13/D14 EVENING COVERAGE: already cover both surfaces

D13 (temporal normalizer) and D14 (direction reconciliation, folded into the overview-subject gate) are applied in `synthesize.run()` for `brief_type in ("morning","evening")`, so they cover evening by construction. Specifically:
- D13 temporal directive prepend: `synthesize.py:~2190` (brief_type in morning/evening).
- D13 deterministic post-parse normalizer: rewrites BOTH `data["lead_paragraph"]` (`~2364`) AND `data["market_pulse"]["narrative"]` (`~2383`). So "Today's Story" (lead_paragraph) and "The Close" (market_pulse.narrative) are both normalized.
- D14 gate + directive: `synthesize.py:~2162` overview_subject_gate call, applied for morning/evening.

There is NO evening-only assembly that bypasses these guards. Both surfaces share the same JSON, so routing is already correct. T4 is therefore largely satisfied; the gap is that D14's direction check is INERT (P0.4) because `tape_driver_names=None` keeps the gate from ever flagging a single-name story, and the direction-contradiction sub-check only flags when `subject_session_pct`/`subject_framing` are supplied (they are, via `_lead_session_move`, but the FULL gate still cannot pass-relegate on driver grounds).

### P0.3 DRIVER DATA AT GEN TIME: per-name % move and direction ARE available

At evening gen time, per-name live data is available via `market_tape.fetch_quote(symbol)` (`backend/market_tape.py:196`). It returns a dict `{"price", "prev", "pct", "change", "ts"}` parsed from Yahoo's 1d/5d chart (`parse_yahoo_daily`). `quote["pct"]` is the session percent move with sign (direction). This is ALREADY used at the lead level by `_lead_session_move(preselected)` (`synthesize.py:1759`), which resolves the lead company to a ticker via `_resolve_lead_ticker`, calls `fetch_quote`, and returns `(pct, framing)`.

Accessor for a single name: `market_tape.fetch_quote(ticker)["pct"]` (signed session percent). `fetch_tape()` only surfaces indices + VIX (`TAPE_SYMBOLS = ^GSPC, ^IXIC, ^RUT, ^VIX`), NOT per-name. So the driver set must be built by fetching quotes for the candidate names (the story companies in the corpus / preselected lead), NOT from `fetch_tape`.

Driver-set v1 source: resolve the lead/story company name(s) to tickers (existing `_resolve_lead_ticker`), fetch each quote, take `pct`. A name is a "driver today" if `|pct| > DRIVER_MIN_ABS_PCT` and it is among the top `DRIVER_TOP_K` absolute movers in the fetched set.

### P0.4 GATE INERT BRANCH: confirmed tape_driver_names=None; is_tape_driver always False today

Confirmed at the call site `synthesize.py:2162-2170`:
```
_gate = market_tape.overview_subject_gate(
    story_companies=_ps_companies,
    is_single_name_or_deal=_is_single_or_deal,
    cluster_distinct_sources=_distinct_sources,
    tape=tape_obj,
    tape_driver_names=None,          # <-- hardcoded None
    subject_session_pct=_lead_pct,
    subject_framing=_lead_framing,
)
```
`market_tape.story_companies_are_tape_drivers(story_companies, tape_driver_names)` (`market_tape.py:284`): `drivers = _norm_names(tape_driver_names); if not cos or not drivers: return False`. With `tape_driver_names=None`, `drivers` is empty, so it ALWAYS returns False. Therefore the gate's `is_tape_driver` check is always False, and a single-name/deal story can never PASS the gate on the "is the day's driver" ground (it can only be relegated). The D14 direction sub-check IS wired (subject_session_pct/framing flow through `_lead_session_move`), so the direction-contradiction reframe directive can fire today, but the driver-magnitude promotion path is dead.

### P0.5 OVERLAP CONTROL: only advisory text exists today

Nothing DETERMINISTIC prevents "The Close" and "Today's Story" from sharing the same subject on the evening path. The existing controls are all prompt-side / advisory:
- The overview-subject gate directive (`build_overview_subject_directive`) tells Gemini to keep the narrative market-wide when the gate relegates the lead, but it is a prompt instruction, not enforced on output.
- The D9 redundancy guard (`synthesize.py:~2424`, `_narrative_is_redundant` + ONE re-ask) pushes the narrative toward net-new drivers vs the headline/lead, but it is a soft re-ask and the original is kept on failure.
- The morning-brief dedup rule (`~2089`) is also prompt-side.

No deterministic post-parse rule forces the two surfaces onto distinct subjects. Per task framing, advisory dedup does not count; this is the gap T5 addresses (materiality-gates-overlap, light deterministic).

### Fixture verification (T2 honesty, the committed 06-24 pool)
`compute_shadow_lead` on `lead_pool_2026-06-24.json` returns winner `co:spacex:stock` (score 13.75, count 16 < 48, freshest 6.5h). Articles in that cluster are the Jun 23 SELLOFF ("SpaceX slumps", "dived 16%"), i.e. a FRESH event, NOT the stale debut. The stale debut cluster `co:spacex:ipo` is #2 (score 12.34, freshest 11.5h). co:abbvie:ma 8.31, co:qualcomm:ma 9.25. So the current Assertion 1 (winner != co:spacex aggregate AND count < 48) passes while SpaceX still leads, but the winner is the fresh selloff event, not the stale debut. T2 will assert the winner is the fresh selloff (`co:spacex:stock`) and NOT the stale debut (`co:spacex:ipo`), so the test fails if a stale lead ever wins.

---

## PHASE 1 + PHASE 2: WHAT LANDED

Commits on `fix/lead-trust` (stacked on `origin/fix/brief-narration-grounding`):
- `9226979a` docs: Phase 0 recon
- `235138ad` T1 (#422 fix): D8 distinctive-prefix org support, kill generic head-token false negative. `backend/synthesize.py:_org_supported` + `_ORG_GENERIC_HEADS`; `backend/tests/test_org_supported_d8.py` (6 cases).
- `6d414907` T2 (#422 fix): harness honesty, Assertion 1 now asserts fresh selloff wins, not stale debut. `backend/tests/test_lead_overview_offline.py`.
- `a0fdbb05` T3: driver-set v1 wired into the gate. `backend/market_tape.py:build_tape_driver_names` + `DRIVER_MIN_ABS_PCT`/`DRIVER_TOP_K`; `backend/synthesize.py` call site (removed `tape_driver_names=None`, builds the set from the lead quote already fetched by `_lead_session_move`, which now also returns the company name); `backend/tests/test_market_tape.py` (5 cases).
- `d24c42bf` T5: materiality-gated overlap rule. `backend/market_tape.py:build_overlap_enforcement_directive` + injection in `synthesize.py`.
- `e8911868` T4: D13 evening coverage extended to `supporting_context` + `what_to_watch`. `backend/synthesize.py`.
- `3df0395f` Phase 2: Jun 26 evening fixture `session_tape` + Assertion7 (driver set, gate, overlap) + Assertion8 (honesty meta-check). `backend/tests/test_lead_overview_offline.py`, `backend/tests/fixtures/narration_micron_2026-06-26.json`.
- `01a461f9` follow-up: fixed `test_morning_tape_grounding` to unpack the 3-tuple `_maybe_inject_tape_directive` now returns (a stale #427 test, 3 pre-existing errors).

### Driver-set v1 definition + constants (recon open question 2, for Noah to tune)
- `DRIVER_MIN_ABS_PCT = 2.0` (percent): a name must move at least this much (absolute) to qualify as a driver.
- `DRIVER_TOP_K = 3`: at most this many names are the day's drivers (the largest absolute movers).
- Definition: `build_tape_driver_names(name_to_pct)` keeps names with `|move| > DRIVER_MIN_ABS_PCT`, sorts by absolute move, and returns the top `DRIVER_TOP_K` (lower-cased). v1 candidate set at gen time is the resolved lead company (its quote is already fetched by `_lead_session_move`; no second network call). Fail-safe: empty input / no material mover -> empty set -> `None` -> market-wide default. A name is NEVER promoted on magnitude alone; the gate still also requires a material tape AND dominant breadth, and the D14 direction sub-check rejects bullish framing on a name that is down today.
- The Micron case end to end: Micron is a driver (|-6.7%| > 2.0, top mover) but the bullish framing contradicts the down session, so `direction_consistent` is False and the lead is relegated to a mention; T5 then forces The Close onto a distinct market-wide subject.
- Tuning headroom: to widen the driver set, lower `DRIVER_MIN_ABS_PCT` or raise `DRIVER_TOP_K`. To expand the candidate set beyond the lead company (so the gate can confirm a different name owns the tape), fetch quotes for the top corpus companies and pass the full `name_to_pct` to `build_tape_driver_names` (a v2 follow-up; v1 stays conservative).

### Harness results
- Offline harness `test_lead_overview_offline`: 20 tests pass (12 prior + 8 new: 6 in Assertion7, 3 in Assertion8, minus overlap; exact: Assertion7 has 5, Assertion8 has 3). The 5 Phase-2 deliverable checks are all covered:
  1. TEMPORAL (no "today" on The Close + Today's Story): `Assertion7.test_temporal_no_today_on_both_evening_surfaces` (+ Assertion4 prior).
  2. DIRECTION/GATE (Micron driver but down -> bullish FAILS gate): `Assertion7.test_bullish_micron_down_fails_gate_with_real_driver_set` using the REAL T3 derivation.
  3. OVERLAP (The Close and Today's Story not both the stale Micron): `Assertion7.test_overlap_directive_forces_distinct_subjects_when_relegated` (+ no-op when dominant).
  4. D8 (Texas Pacific Land absent -> unsupported): `test_org_supported_d8.py` (kept in its own file because the offline harness deliberately does not import synthesize.py; that file imports synthesize with dummy env, same pattern as test_brief_synth_retry).
  5. HONESTY (rewritten Assertion 1 fails on stale, passes on fresh): `Assertion8`.
- Full backend suite under python3.11: 484 tests, OK (all green, including the 3 previously-erroring morning-tape cases now fixed).
- Offline + market_tape + impact suites under python3.14: 73 tests, OK.
- ENV IMPORT ERROR STATUS (unchanged in character): under python3.14 the system interpreter, 35 modules that import `supabase`/`synthesize` fail to COLLECT with the known `httpcore` + py3.14 `typing.Union.__module__` AttributeError (a third-party/interpreter incompatibility, not test logic). This is identical to the pre-existing failure on `test_brief_synth_retry` and is NOT introduced by this branch. python3.11 has compatible deps and runs everything green; use python3.11 for the synthesize-importing tests.

### Recommended edits to surface to #422 / #427 (cherry-pickable)
- INTO #422: T1 (`235138ad`) corrects the `_org_supported` head-token false negative ("Texas Pacific Land" via "texas"). T2 (`6d414907`) corrects the dishonest Assertion 1 (passed while SpaceX still led). Both are clean, self-contained, and cherry-pickable.
- INTO #427: `01a461f9` fixes the stale 2-tuple unpack in `test_morning_tape_grounding` left over from #427's 3-tuple change to `_maybe_inject_tape_directive`. Cherry-pickable.

### HALT / REQUIRES items
- REQUIRES LUCAS: none. No Lucas-protected file was edited (`src/app/api/briefing/route.ts` and the other protected files were read-only).
- REQUIRES MIGRATION: none. No schema change; driver-set and gate use existing fields and gen-time quotes.
- FOLLOW-UP (v2, not blocking): the driver-set candidate set in v1 is the lead company only. To let the gate affirmatively confirm a DIFFERENT name owns the tape (rather than only relegate the lead), fetch quotes for the top corpus companies and pass the full `name_to_pct`. Deliberately deferred to keep v1 conservative and fail-safe.
- NOTE: T4 found D13/D14 already cover both evening surfaces by construction (single shared JSON; both `lead_paragraph` and `market_pulse.narrative` are normalized). The only genuine bypass was `supporting_context`/`what_to_watch` on the Today's Story card, now routed through D13. No evening-only assembly exists in the backend.
- DID NOT MERGE, DID NOT PUSH TO #422/#427, DID NOT run backend/run.py, DID NOT call Gemini, DID NOT write to prod or apply a migration.
