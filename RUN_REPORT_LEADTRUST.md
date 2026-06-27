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
