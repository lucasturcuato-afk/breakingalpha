# RUN REPORT: Brief narration grounding (fix/brief-narration-grounding)

Branch STACKED on origin/fix/lead-overview-overhaul (open PR #422), itself based
on origin/main. Isolated worktree at /Users/noahhanning/sig-narration. Backend
only: synthesize.py, market_tape.py, backend/tests. No merges, no pushes to main,
no #422 rewrites, no migrations, no pipeline runs, no Gemini calls at runtime in
these guards, no prod writes. SQL access was SELECT-only via the supabase MCP tool.

This file is intentionally separate from #422's RUN_REPORT.md so this branch does
not rewrite #422's committed doc. The add/add RUN_REPORT.md merge conflict noted
below is unrelated to code.

## PROBLEM

Morning Brief (gen 10:13 AM ET Fri Jun 26) led Market Pulse with "Micron
Technology's stock surge to a new all-time high today ... underscores increasing
investor confidence". Three stacked defects:
- TEMPORAL: MU's surge and ATH were YESTERDAY (reported Wed Jun 24 after close,
  soared ~15% Thu Jun 25 to ATH $1,255). TODAY Fri Jun 26 MU is DOWN ~5%
  premarket in a chip selloff. The brief ingested the Jun 25 article and copied
  its "today" onto the Jun 26 brief.
- DIRECTIONAL: the narrative frames MU as today's bullish driver while its live
  tape is negative today.
- PROSE: "stock surge ... underscores" is garbled; the voice guard missed it.

Defects landed here: D13 temporal grounding, D14 live-quote reconciliation,
D15 prose quality guard.

## PHASE 0 RE-AUDIT

### P0.0 #422 MERGEABILITY
Dry-run merge of origin/fix/lead-overview-overhaul onto origin/main in a throwaway
worktree (`git merge --no-commit --no-ff`, then `--abort`, worktree removed).
Result: ONE conflict, add/add in `RUN_REPORT.md` only. No code conflicts. The
backend/SQL/test code merges cleanly. The doc conflict is expected (both branches
add a top-level report file) and is trivially resolvable at #422 merge time. This
narration branch keeps its report in a separate file to avoid compounding it.

### P0.1 EVENT-DATE SIGNAL (decides D13's key)
The `public.articles` schema (verified SELECT-only via information_schema) has NO
distinct event date/timestamp. Temporal columns are only `published_at`
(timestamptz, nullable) and `ingested_at` (timestamptz, nullable). There is no
extracted event time, dateline, or parsed "as of" field, and ingest.py does not
derive one (it stamps publisher-provided `published` or NULL; see P0.4).
DECISION: D13 derives event_date = date(published_at converted to America/New_York).
When published_at is NULL, event_date = UNKNOWN. There is no truer event signal to
key on. This is a known limitation: an article published Jun 25 about a Jun 24
event still yields event_date Jun 25, but that still correctly blocks "today" on a
Jun 26 brief (the Micron case), which is the bug in scope.

### P0.2 GATE vs DIRECTION (decides D14 landing)
market_tape.overview_subject_gate (market_tape.py:288) gates on THREE proxies:
(a) tape_has_material_move (magnitude of S&P/VIX), (b) story_companies_are_tape_drivers
(membership in a caller-supplied driver set, currently always None -> False), and
(c) cluster distinct-source breadth. It does NOT check the DIRECTION of the named
ticker's current-session move versus the story's bullish/bearish framing.
DECISION: FOLD D14 into the gate as a NEW, additive parameter on THIS branch (not
a rewrite of #422's commit). Add an optional `subject_session_pct` + `framing`
input and a new `direction_consistent` check. When a single-name lead is framed
bullish (surge/record/all-time high/rally) but the ticker is materially DOWN today
(<= -RECON_DIR_PCT), the gate fails on direction and the directive instructs a
reframe. The existing three-proxy behavior is unchanged when the new inputs are
omitted (backward compatible; #422's offline harness keeps passing). The live
per-name quote is obtainable at gen time via the EXISTING market_tape.fetch_quote
(Yahoo daily, baseline-correct prior close), so no new live-call dependency is
added. A small deterministic reconciliation step in synthesize.py fetches the
lead ticker's quote, runs the framing/direction check, and passes a reconciliation
fact line into generation.

### P0.3 D4 RECENCY
#422's D4 stale-event penalty keys on `_article_age_hours` (lead_preselect.py:401),
which reads published_at -> ingested_at. It measures PUBLICATION age. A fresh-
published article that narrates a prior-day event (the Micron case: published Jun 25,
event Jun 24/25) is YOUNG by publication age and passes D4 cleanly. D4 cannot catch
stale EVENTS, only stale publications. D13's event_date is a separate axis; D13 does
NOT feed D4 (changing D4 is out of scope and would touch #422's ranking logic). D13
fixes the narration, which is where the bug surfaces. Follow-up noted below.

### P0.4 D6 INTERACTION (read origin/main)
origin/main ingest.py stores `published_at = None` for date-less items (RSS path
~336-339, second feed path ~1079-1081, ~1132-1135). Comment confirms: "Missing
date stays NULL: never now-stamp a date-less item." D13 handles this: when
published_at is NULL, event_date = UNKNOWN, the normalizer REMOVES any relative-time
clause and forbids asserting "today"/"this morning". D13 reads published_at
defensively (None-safe) and does not depend on D6 being present in this tree.

### P0.5 D5 INTERACTION (read origin/main)
origin/main morning-brief/page.tsx (and siblings) render the fresh-story RAILS with
`gte("published_at", publishedFloor7d)` (7-day floor, NULL excluded by gte) and
`timeAgo(a.published_at || a.ingested_at)` for rail timestamps. That is FRONTEND
rail rendering. D13 operates only on the backend narrative strings (lead_paragraph,
market_pulse.narrative) inside synthesize.py. NO overlap: D13 does not touch rails,
timeAgo, or any frontend file.

### P0.6 GENERATION SURFACE
headline, lead_paragraph, supporting_context, market_pulse.narrative are produced by
`_generate_brief_json(system, "Today's articles:...")` at synthesize.py:2195 inside
`run(brief_type)`. At that call site both signals are available:
- brief_date: derived from datetime.now() converted to America/New_York (run is the
  gen-time entrypoint; ET conversion added by D13).
- per-story event_date: `preselected` (the lead dict) carries `published_at`,
  `companies`, `title`; event_date = date(published_at in ET) or UNKNOWN.
D13 prepends a temporal-anchor directive (brief_date + lead event_date) to `system`
before the call, AND runs a deterministic post-parse normalizer over the returned
lead_paragraph + market_pulse.narrative. The post-parse guards (opener, redundancy,
voice) already live immediately after this call (2226-2307); D13/D14/D15 slot in
alongside them.

## PHASE 1/2 RESULTS

(Filled in below after implementation.)
