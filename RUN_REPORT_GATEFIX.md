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
The market-wide rewrite changes ONLY the narrative string value(s) inside the
existing `market_pulse` JSON (and possibly headline/lead text on the rewrite
path). No new column on the `briefings` row and no new key on `market_pulse`.
No route file is edited.
