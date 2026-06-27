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

## PHASE 1: DEFECTS LANDED

| ID | Defect | Files | Commit |
|----|--------|-------|--------|
| D13 | Temporal grounding (anchor relative time to brief date) | backend/temporal_grounding.py (new), backend/synthesize.py | 183b7362 |
| D14 | Live-quote reconciliation (direction vs framing in the gate) | backend/market_tape.py, backend/synthesize.py | 24438075 |
| D15 | Prose quality guard (garbled constructions) | backend/prose_quality_guard.py (new), backend/synthesize.py | 4d1ec63f |

### D13 temporal grounding
New PURE module temporal_grounding.py: brief_date_et, event_date_et,
relative_phrase, normalize_relative_time, build_temporal_directive. CRITICAL: UTC
-> America/New_York conversion happens BEFORE taking the date, so a prior-evening-ET
article (Jun 26 01:30Z = Jun 25 21:30 ET) yields event_date Jun 25, not Jun 26.
Wired into synthesize.run: a temporal-anchor directive is prepended to the system
prompt (first line of defense), and a DETERMINISTIC post-parse normalizer rewrites
relative-time tokens in lead_paragraph + market_pulse.narrative: same day keeps
"today"; one day prior -> "yesterday" (strip time-of-day); same week -> weekday;
older -> "last week"/"earlier this month"; UNKNOWN (NULL published_at) -> strip the
clause, never assert "today". Token set: today, this morning, this afternoon,
tonight, earlier today, now, currently, right now. A garbled inline rewrite falls
back to ONE targeted re-ask (_retemporalize_field), the only model call in D13 and
not on the default path.

### D14 live-quote reconciliation
Extended market_tape.overview_subject_gate ADDITIVELY (new optional params
subject_session_pct + subject_framing; new check direction_consistent). This is a
NEW commit on this branch that EXTENDS #422's gate, not a rewrite. New helpers
classify_framing and framing_contradicts_session, new constant RECON_DIR_PCT (1.5).
When a single-name lead is framed bullish but its ticker is materially DOWN today
(or bearish vs up), the gate fails on direction and the directive builder emits a
reconcile-not-celebrate reframe instruction (state today's direction after the
prior move; prefer reframe over silent drop). synthesize.run resolves the lead
ticker (HARD_TICKER_OVERRIDES, then finnhub search) and the live move via the
EXISTING market_tape.fetch_quote (no new live-call dependency). When inputs cannot
resolve, the check is inert and the gate behaves exactly as #422 shipped it.

### D15 prose quality guard
New PURE module prose_quality_guard.py: detect_garbled_prose / has_garbled_prose /
build_prose_correction. Detects a tight set of confidently-broken constructions
(compound-noun event subject feeding a clause verb, e.g. "stock surge ...
underscores"; dangling prepositions; doubled punctuation) in lead_paragraph +
market_pulse.narrative. Conservative: a clean determiner subject ("the rally
signals ...") is NOT flagged. On a hit, synthesize.run runs ONE targeted re-ask
with an explicit failure example. Not a general grammar engine. Soft-fail.

## PHASE 2: HARNESS RESULTS

Extended backend/tests/test_lead_overview_offline.py (commit 8a06bfcd) with a
committed fixture backend/tests/fixtures/narration_micron_2026-06-26.json.

- 12/12 tests pass in the module (6 prior retained + 6 new). The new assertions
  cover the three required scenarios plus prose + backward-compat:
  1. TEMPORAL: event_date Jun 25 (via ET conversion), brief_date Jun 26 -> the
     normalized lead + narrative have no "today"/"this morning"; read "yesterday".
  2. DIRECTION: MU -5% Jun 26 vs bullish framing -> gate flags direction_contradiction,
     relegates to market_wide, emits the reconcile directive; inert when omitted.
  3. UNKNOWN-DATE: NULL published_at -> UNKNOWN event date -> no "today" asserted.
  Plus: D15 garbled lead flagged / fixed lead passes.
- The re-ask paths (temporal + prose re-ask) are integration-only (they call the
  model) and are explicitly NOT asserted; the harness asserts the pure layers.
- Pre-existing env import errors UNCHANGED: discover-wide run shows 34 errors, all
  in modules other than mine (test_store_batch and test_sec_bypass need env-bound
  clients; test_smoke/test_supabase_conn_resilience/test_watchlist_boost/
  test_xbrl_resolver fail to import on missing pytest/env). None are introduced by
  this branch; temporal_grounding and prose_quality_guard import clean.

Fixture note: the prod snapshot (SELECT-only, 2026-06-27) confirms Micron led that
week's coverage with bullish earnings framing, but the exact "published Jun 25,
ATH $1,255, +15%" row the brief copied "today" from is not reproducible verbatim
(surviving Micron rows are Jun 26-published), so the temporal/direction inputs are
hand-set to the documented values, faithful to the bug shape.

## RECOMMENDED FOLLOW-UPS (described, not applied)

- To #420 (D6): D6 correctly stamps NULL for date-less items, which D13 now treats
  as UNKNOWN. Consider an ingest-side EVENT-date extraction (dateline / "as of" in
  the body) so D13 can key on a true event date rather than publication date; this
  would also let D4 penalize stale EVENTS, not just stale publications.
- To #421 (D5): no change needed; rails and D13 do not overlap. If an event_date
  column is ever added, the rails timeAgo could optionally prefer it.
- To #422 (D4 recency): D4 keys on publication age and cannot catch a fresh-
  published article narrating a prior-day event (the Micron case). If an event_date
  signal becomes available, feed it into _article_age_hours so the stale-event
  penalty fires on the event, not the publication. Out of scope here (would touch
  #422's ranking logic).
- D14 ticker resolution leans on finnhub search at gen time when a name is not in
  HARD_TICKER_OVERRIDES (only 2 entries). Consider a small curated name->ticker map
  for the most common single-name leads to make the direction check deterministic
  and network-free.
- RECON_DIR_PCT (1.5) and the framing word lists are conservative v1 tunables;
  validate against a few live mornings before tightening.

## HALT / REQUIRES LUCAS / REQUIRES MIGRATION

- REQUIRES LUCAS: none. No Lucas-protected file was edited (briefing/route.ts,
  MemoModal.tsx, watchlist-utils.ts, WatchlistAddInput.tsx, trends/page.tsx all
  untouched). All wiring rides synthesize.run's existing system-prompt prepend and
  post-parse guard paths.
- REQUIRES MIGRATION: none for D13/D14/D15. (#422 still carries its own UNAPPLIED
  migration, untouched here.) An optional event_date column is a follow-up, not a
  requirement of this work.
- No merges, no main pushes, no #422 rewrites, no Gemini runtime calls in the
  default paths, no prod writes, no pipeline runs.
