# RUN REPORT: Lead/overview overhaul (fix/lead-overview-overhaul)

Branch based on origin/main @ 0df8c777. Isolated worktree at /Users/noahhanning/sig-core.
All work is backend + tests + one UNAPPLIED migration. No merges, no pushes to
main, no migrations applied, no pipeline runs, no Gemini calls, no prod writes.
SQL access was SELECT-only via the supabase MCP tool (snapshot for the fixture).

## Defects implemented

| ID | Defect | File(s) | Status |
|----|--------|---------|--------|
| A1 (D1)  | Event-level clustering | backend/impact_ranking.py | LANDED |
| A2 (D2+D3) | Overview-subject materiality gate | backend/market_tape.py, backend/synthesize.py | LANDED |
| A3 (D4)  | Recency backstop | backend/impact_ranking.py, backend/lead_preselect.py | LANDED |
| A4 (D8)  | Section entity validation | backend/synthesize.py | LANDED |
| A5 (D9)  | Overview redundancy guard | backend/synthesize.py | LANDED |
| A6 (D7-be) | Entity-fact injection + UNAPPLIED migration | backend/synthesize.py, backend/migrations/ | LANDED |
| A7 (D12) | Mega-deal gate relaxation | backend/impact_ranking.py | LANDED |
| A-VERIFY | Offline harness + fixture | backend/tests/ | LANDED, PASS |

### A1 (D1) event-level clustering
`cluster_key` now sub-clusters within a company by EVENT theme
(`co:<name>:<theme>` or `co:<name>:sig:<signature>`). Distinct events are
distinct clusters; breadth (distinct sources) is counted per EVENT. Syndicated
near-duplicates of the SAME story still merge via a content signature. Macro
buckets unchanged. `_best_article_in_cluster` already picks the most on-topic /
highest-relevance article inside the (now event-scoped) cluster.

### A2 (D2+D3) overview-subject materiality gate
New `market_tape.overview_subject_gate` decides whether a single-name OR
pure-deal story may be the overview SUBJECT. v1 conservative, defaults to
market-wide. Requires ALL THREE gen-time proxies: (a) material tape move
(MATERIALITY_SPX_ABS_PCT=1.0, MATERIALITY_VIX_ABS_PCT=8.0), (b) story companies
are the tape's cited driver, (c) event cluster has dominant cross-source breadth
(MATERIALITY_MIN_DISTINCT_SOURCES=6). Otherwise the story is relegated to a
MENTION and the overview stays market-wide. Decision injected into the prompt via
the existing system-prompt prepend path in synthesize.py (no route file edited).
Gate (b) uses ONLY gen-time-available signals; the live tape fetch surfaces
indices + VIX, not per-name quotes, so the driver set is conservatively empty
(left a `# TODO(recon open question 2)` marker; no per-story index contribution
fabricated). The evening morning-dedup directive is retained but no longer
primary.

### A3 (D4) recency backstop
impact_ranking: W_RECENCY raised 2.0 -> 4.0; added EVENT_STALE_AGE_H=24.0 +
STALE_EVENT_PENALTY=3.0 for non-macro clusters older than 24h (tier-1 / recent
macro exempt). lead_preselect: DEAL_MAX_AGE_HOURS (= 24h fallback window) now
gates Filter A and Filter A2 so a stale deal article cannot lead on a fresh
deal_flow row.

### A4 (D8) section entity validation
Resolved companies[] are now passed into section generation (per-article
"Entities:" line in the spine/floor text). Post-gen check flags any org named in
a section that is absent from the corpus and the resolved roster; clear
hallucinations trigger ONE re-ask of the flagged sections. Unsupported orgs are
always logged. The re-ask code path is wired; it will run in prod (not invoked
in this offline change).

### A5 (D9) overview redundancy guard
Detects a narrative whose opener restates headline/lead (token-overlap heuristic)
and does ONE re-ask for net-new drivers. Runs AFTER the opener guard.

### A6 (D7-be) entity-fact injection + migration
`_build_entity_fact_block` injects an authoritative [ENTITY FACTS] block built
from finnhub_helper.HARD_TICKER_OVERRIDES + a small in-code status map
("SpaceX: public, NASDAQ: SPCX"). v1 needs no migration. Companion UNAPPLIED
migration backend/migrations/2026-06-25-companies-public-status-ticker-facts.sql
adds is_public + exchange columns and seeds the SpaceX fact; header marks it
UNAPPLIED, requires Noah. NOT APPLIED.

### A7 (D12) mega-deal gate relaxation
New pure `impact_ranking.confirmed_mega_deal_urls(deal_rows, pool)` keeps the
trusted-stage path and adds a relaxed same-day path: a deal with explicit >=$1B
value whose article side is unambiguous (relevance >= 9 and >= 2 distinct sources
on the event cluster) qualifies even when deal_flow stage is stale ('rumored').
Unconfirmed-keyword headlines stay blocked. `_mega_deal_urls` now delegates to
it. Recovers the genuine Qualcomm/Modular $4B deal.

## Tests added + results

- backend/tests/test_impact_ranking.py: +event-subcluster, stale-backstop, and
  mega-deal-relax cases (19 tests, PASS).
- backend/tests/test_market_tape.py: +materiality-gate cases (29 tests, PASS).
- backend/tests/test_lead_overview_offline.py: A-VERIFY harness (6 tests, PASS).

Combined relevant suite: 54 tests, OK.

## A-VERIFY result: PASS

Fixture: backend/tests/fixtures/lead_pool_2026-06-24.json (SELECT-only snapshot
of the 06-24 morning pool: SpaceX 48 articles / 21 distinct sources spanning many
distinct events; genuine deals AbbVie/Apogee $10.9B, Accenture $4.175B, Public
Storage Canada $1.2B; A7 stale Qualcomm/Modular $4B; mild risk-on/neutral tape).

1. SpaceX no longer wins on name-level volume: the company-aggregate cluster no
   longer exists; the 48 articles split into multiple event clusters and the lead
   is drawn from a single event cluster smaller than the aggregate. PASS.
2. The materiality gate relegates SpaceX to a mention on the mild 06-24 tape and
   selects the market-wide synthesis path. PASS.
3. A genuine fresh confirmed deal (AbbVie/Apogee $10.9B) is eligible (Filter A
   qualifies; the deterministic pre-picker selects it over SpaceX); the relaxed
   mega-deal gate also recovers the stale-stage Qualcomm/Modular $4B. PASS.

## Skipped items / known limitations

- None of A1-A7 skipped.
- Full `unittest discover` over backend/tests shows 34 PRE-EXISTING errors,
  unrelated to this change: module-import failures (missing `pytest`; supabase /
  httpx / postgrest incompatibility under Python 3.14). They are import-level,
  not behavioral, and exist on the baseline. My touched-module test files all
  pass.

## REQUIRES LUCAS

- None. No Lucas-protected file was edited. The overview-subject gate decision is
  injected via the existing system-prompt prepend path in synthesize.py, NOT via
  src/app/api/briefing/route.ts.

## REQUIRES MIGRATION (human, do not auto-apply)

- backend/migrations/2026-06-25-companies-public-status-ticker-facts.sql
  (UNAPPLIED). Adds companies.is_public + companies.exchange and seeds SpaceX.
  Review column names against the TS entity reader before applying. v1 of D7
  works without it.

## OPS items for Noah

- D12: deal_extractor left the genuine Qualcomm/Modular $4B row at stage
  'rumored' (never re-confirmed). The relaxed gate is a runtime mitigation; the
  underlying fix is a deal_flow re-extraction / stage-refresh. Do NOT re-run
  deal_extractor as part of this change; flag for ops.
- A2 gate (b): per-name tape movers are not surfaced at gen time. To let a genuine
  single-name catalyst pass the gate on a material day, the tape fetch needs a
  per-name mover/driver set (recon open question 2, marked with a TODO in
  market_tape.overview_subject_gate). Needs Noah's confirmed inputs.
