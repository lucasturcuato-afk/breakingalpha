# Spec: Analyst-grade XBRL financial-fact extraction

**Status:** Draft for review (Noah) · **Type:** Research + design + read-only spike
**Branch:** `noah/xbrl-financials-spec` · **Date:** 2026-06-03
**Author:** Claude (paired with Noah)

> **Scope guardrail.** This document and the artifacts in `scratch/` are
> research + a read-only spike only. No production module was written, no DB
> rows were written, and the proposed migration in
> `supabase/migrations/20260603120000_create_financial_facts.sql` is **written
> but NOT applied**. Building the production ingest, applying the migration, and
> wiring the UI are explicitly out of scope here and require Noah's go-ahead.

---

## 0. TL;DR

- **Recommendation: extract from the SEC "Company Facts" structured JSON API**
  (`data.sec.gov/api/xbrl/companyfacts/CIK##########.json`) for the v1 line-item
  set. It is free, deterministic, GAAP-tagged, and already de-duplicated across
  a company's filing history. **Do not spend LLM tokens on numbers the SEC has
  already machine-tagged.**
- **Proven, not assumed.** A read-only spike (`scratch/xbrl_spike.py`) pulled 5
  tracked tickers (AAPL, NVDA, CRWD, DDOG, SNOW — deliberately mixed fiscal-year
  ends and including loss-makers) and extracted the full v1 line-item set with
  **100% coverage: 12/12 concepts × 5/5 companies, for both the latest annual
  (10-K) and latest quarter (10-Q)**. A spot-check (`scratch/xbrl_spotcheck.py`)
  confirmed the numbers are analyst-grade:
  - cross-endpoint agreement (Company Concept API == Company Facts API) to the
    dollar, and
  - internal tie-out `GrossProfit == Revenue − CostOfRevenue` to the dollar for
    all 5 companies.
- **LLM extraction is the wrong tool** for tagged financials: it costs tokens
  per filing, can hallucinate digits, and still needs a deterministic verifier —
  which is the SEC data we'd be paying to re-derive.
- **Segments are out of v1.** Company Facts collapses XBRL dimensions and returns
  only the consolidated value per concept; per-segment breakdowns require parsing
  raw iXBRL / the Financial Statement data sets. Deferred to a later phase.

---

## 1. Source strategy

### 1.1 The three candidate sources

| | (a) SEC Company Facts / Concept / Frames JSON | (b) Raw iXBRL from the filing documents | (c) LLM extraction from filing text |
|---|---|---|---|
| **What it is** | SEC pre-parses every filer's XBRL into one JSON doc per company (all concepts, all periods, all units), plus per-concept and cross-company "frames" variants | The inline-XBRL instance embedded in the 10-K/10-Q primary document; parse tags + contexts yourself | Feed the financial statements (or full filing) to an LLM and ask for the numbers |
| **Cost** | **Free.** 1 HTTP GET per company; no tokens | Free bytes, but heavy parse + taxonomy/linkbase handling | Tokens per filing, every filing, forever |
| **Determinism** | **Fully deterministic** — same input → same value | Deterministic but you own the parser's correctness | Non-deterministic; digit/period/scale hallucination risk |
| **GAAP tagging** | Native — every value carries its `us-gaap` concept, unit, period, fiscal labels, source accession | Native (same XBRL), but you reconstruct it | None — you must re-infer the concept |
| **Provenance / audit** | **Built in** (`accn`, `fy`, `fp`, `form`, `filed`, `frame` per fact) | Reconstructable | Must be bolted on and trusted |
| **Restatements** | **Both original and restated facts present**, keyed by accession + filed date | Present per filing; you stitch history | Not handled |
| **Dimensions (segments)** | **Not exposed** — consolidated value only | **Exposed** (this is iXBRL's advantage) | Possible but unreliable |
| **Latency to availability** | Minutes–hours after acceptance (SEC reprocesses) | Immediate (in the filing) | Immediate |

### 1.2 Recommendation

**Use Company Facts JSON as the v1 source.** It is the cheapest path that is
also the most correct for the standard, machine-tagged line items, because the
SEC has already done the parsing, normalization, and history-merging we would
otherwise pay an LLM (or a brittle home-grown iXBRL parser) to approximate.

The strong prior held up under the spike: every v1 concept resolved for every
test company, with exact provenance and exact internal consistency.

**Use the Company Concept API** (`/api/xbrl/companyconcept/CIK…/us-gaap/{tag}.json`)
as a narrower fetch when we only need one concept (and, as the spike used it, as
a cross-check oracle). **Use the Frames API**
(`/api/xbrl/frames/us-gaap/{tag}/{unit}/CY####Q#.json`) later for cross-company
peer comparisons ("Comps" tab) — one concept, one period, all filers.

**iXBRL parsing is reserved** for the things Company Facts cannot give us:
**segment/dimensional detail** and any company-specific extension tags we decide
to chase. This is a later phase, not v1.

**LLM extraction stays where it already is** — turning *narrative* (8-K event
prose, MD&A, guidance language) into summaries. It is the right tool for untagged
text and the wrong tool for tagged numbers.

### 1.3 Coverage gaps that would force iXBRL (named, per the spike)

1. **Segments.** Company Facts returned only `NumberOfReportableSegments` /
   `SegmentReportingInformationOperatingIncomeLoss`-style aggregates — never the
   per-segment revenue/operating-income members. Segment economics (e.g. NVDA
   Data Center vs Gaming) live in XBRL *dimensions*, which Company Facts drops.
2. **Custom extension tags.** Concepts a filer defines in its own namespace
   (not `us-gaap`/`dei`) are largely a segment/footnote concern; the v1 standard
   line items were 100% covered by `us-gaap`, so this does not block v1.
3. **Footnote-level detail** (e.g. revenue disaggregation tables, lease
   maturity schedules) — dimensional, same limitation as segments.

---

## 2. Scope — v1

### 2.1 In scope (the v1 line-item set — all proven at 100% coverage)

Income statement (duration facts):
- Revenue · Cost of revenue · Gross profit · Operating income · Net income
- EPS basic · EPS diluted

Cash flow (duration):
- Operating cash flow

Balance sheet (instant facts):
- Total assets · Total liabilities · Stockholders' equity · Cash & equivalents

Derived (computed, not stored as a primary fact, or stored as a derived row):
- Gross margin = Gross profit / Revenue (spike computed it; tied out exactly)

Each stored fact carries full provenance: the exact `us-gaap` concept used, unit,
period start/end, period type (instant/duration), fiscal year + fiscal period,
source `form`, source accession number, filed date, and calendar `frame`.

### 2.2 Tag-resolution note (a real correctness finding from the spike)

The same economic line item is tagged differently across issuers and **over time
within one issuer**. Observed in the spike:

| Line item | Tags seen across the 5 companies |
|---|---|
| Revenue | `RevenueFromContractWithCustomerExcludingAssessedTax` (AAPL, DDOG, SNOW), `Revenues` (NVDA), `RevenueFromContractWithCustomerIncludingAssessedTax` (CRWD) |
| Cost of revenue | `CostOfGoodsAndServicesSold` (most), `CostOfRevenue` (NVDA) |
| Stockholders' equity | `StockholdersEquity` (most), `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest` (SNOW quarter) |

**First-tag-wins is a bug.** NVDA *migrated* its revenue tag from
`RevenueFromContractWithCustomerExcludingAssessedTax` to `Revenues`; the old tag
still carries stale facts (last FY2022). Naively taking the first present
candidate tag returned a 4-year-old revenue and produced a nonsensical **570%
gross margin**. The fix, implemented in the spike: **union all candidate tags for
a line item, then pick the fact with the latest period.** After the fix NVDA
resolved correctly to `Revenues` = $215.938B (FY2026), gross margin 71.07%.

→ v1 must maintain a curated, ordered candidate-tag map per metric and select by
*latest period across the union*, not first-present.

### 2.3 Explicitly OUT of v1

- **Segment / dimensional data** (needs iXBRL — see §1.3).
- **Custom (non-`us-gaap`/`dei`) extension tags.**
- **Footnote disaggregation tables.**
- **Non-GAAP / adjusted metrics** (adjusted EBITDA, ARR, free cash flow as the
  company defines it) — these are usually untagged or in custom tags; they are an
  8-K/MD&A *narrative* concern and stay with the existing LLM summary path for now.
- **Guidance / forward estimates** — not in XBRL; narrative-only.
- **Backfill of deep history** — v1 captures latest annual + latest few quarters;
  multi-year backfill is a later phase (Company Facts already contains the
  history, so this is a throughput decision, not a sourcing one).

---

## 3. Correctness — the analyst-grade bar

Findings below are grounded in the spike output (`scratch/xbrl_spike_output.txt`,
`scratch/xbrl_spotcheck_output.txt`).

1. **Units & scaling.** Company Facts values are already in base units (full
   dollars, not thousands/millions) under an explicit `units` key (`USD`,
   `USD/shares`, `shares`). The spike's tie-out (`Revenue − CostOfRevenue ==
   GrossProfit` to the dollar for all 5) confirms there is **no hidden scaling**
   to undo — unlike scraping a statement that says "(in millions)". Store the
   raw value + the unit string verbatim; never infer scale.

2. **Period context: instant vs duration.** Balance-sheet facts are *instant*
   (only an `end` date); income/cash-flow facts are *duration* (`start`+`end`).
   The model stores `period_type`, `period_start` (nullable), `period_end`. The
   spike enforced this split when selecting facts.

3. **YTD vs discrete-quarter (a real trap).** In 10-Qs, income-statement items
   are reported as discrete quarters (e.g. AAPL Q2 revenue, 3-month span, with a
   calendar `frame`), but **cash-flow items are cumulative year-to-date**:
   - AAPL latest 10-Q `OperatingCashFlow` period was `2025-09-28 → 2026-03-28`
     (6 months, `frame=-`),
   - CRWD's was `2025-02-01 → 2025-10-31` (9 months, `frame=-`).
   → To present a *discrete-quarter* operating cash flow we must **difference
   consecutive YTD values**, or label the stored value as YTD. v1 stores the raw
   period (start/end) faithfully and marks YTD vs discrete via span length; the
   discrete-quarter derivation is a read-side computation.

4. **Fiscal-year alignment.** Test companies span four fiscal-year ends (AAPL
   Sep, NVDA/CRWD/SNOW Jan, DDOG Dec). The issuer's `fy`/`fp` labels do **not**
   equal the calendar year — e.g. NVDA's FY2026 ended 2026-01-25 and it has
   already filed Q1 **FY2027**. → Store both the issuer fiscal labels (`fiscal_year`,
   `fiscal_period`) **and** the actual `period_start`/`period_end` dates, and use
   the SEC `frame` (e.g. `CY2025`, `CY2026Q1`, `CY2026Q1I`) as the
   calendar-normalized key for cross-company alignment. Never assume
   `fiscal_year == calendar_year`.

   **Refinement (2026-06-03): labels are PERIOD-derived, not copied from the
   filing.** SEC `fy`/`fp` describe the *filing's* fiscal context, so a
   prior-year comparative kept under latest-filed-wins inherits the wrong year
   (Apple's true-FY2024 revenue arrived labeled fy=2025 from the FY2025 10-K),
   and a 6-month YTD and the discrete quarter sharing its `period_end` both
   arrive as "Q2". The extractor now infers each issuer's fiscal calendar from
   its annual facts (year **numbering** anchored to each year's *original*
   10-K, so NVDA's Jan-FYE numbering survives; the in-progress year is
   extrapolated forward) and labels every fact from its own dates:
   `FY` / `Q1..Q4` (discrete) / `6M` / `9M` (cumulative YTD); fiscal-year-end
   balances are `FY`. Filing provenance stays in `accession_number` / `form` /
   `filed_date`.

5. **Amendments & restatements.** Company Facts includes the *original* and any
   *restated* fact for the same period, distinguished by `accn` + `filed` (and
   `form`, e.g. `10-K/A`). v1 **keeps all facts** (keyed by accession) so history
   is preserved, and exposes a `financial_facts_latest` view that selects the
   most-recently-filed value per `(cik, metric, period)`. This gives both "what
   they report now" (latest) and "what they said then" (audit trail) — the
   analyst-grade requirement.

6. **Negative values / losses.** Loss-makers were handled correctly: CRWD
   (−$162.5M net income), SNOW (−$1.332B operating loss, −3.95 EPS), DDOG
   (positive net income with *negative* operating income — non-operating gains).
   → Always store the signed value; never derive net income from operating income.

7. **Custom / non-GAAP tags.** Out of v1 (§2.3). When encountered later, they
   must be quarantined under their own taxonomy namespace and never silently
   mapped onto a GAAP metric_key.

8. **Provenance is mandatory.** Every stored fact links to its source accession
   so any number shown in the product is one click from the filing it came from
   (spike printed the EDGAR index URLs for AAPL/NVDA in spot-check 3).

---

## 4. Data model & integration

### 4.1 Proposed table: `financial_facts`

One row per (company, concept, period, source filing). Long/narrow so new line
items never require a schema change. Full DDL is in the **unapplied** migration
`supabase/migrations/20260603120000_create_financial_facts.sql`. Shape:

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `company_id` | uuid → `companies(id)` | nullable (CIK may precede a company row) |
| `cik` | bigint | always set; the join of record to SEC |
| `filing_id` | uuid → `sec_filings(id)` | nullable; set when the filing is also ingested |
| `accession_number` | text | provenance (`accn` from Company Facts) |
| `taxonomy` | text | `us-gaap` / `dei` |
| `concept` | text | the **actual** XBRL tag used (e.g. `Revenues`) |
| `metric_key` | text | our normalized key (e.g. `revenue`, `net_income`, `eps_diluted`) |
| `value` | numeric | raw, signed, base units |
| `unit` | text | `USD` / `USD/shares` / `shares` |
| `period_type` | text | `duration` / `instant` |
| `period_start` | date | null for instant |
| `period_end` | date | not null |
| `fiscal_year` | int | issuer fiscal year (≠ calendar year) |
| `fiscal_period` | text | `FY` / `Q1`..`Q4` |
| `frame` | text | SEC calendar frame, e.g. `CY2026Q1` / `CY2026Q1I`; null if off-calendar |
| `form` | text | `10-K` / `10-Q` / `10-K/A` … |
| `filed_date` | date | for latest-wins restatement logic |
| `created_at` / `updated_at` | timestamptz | |

- **Uniqueness:** `(accession_number, concept, period_start, period_end, unit)`
  (a filing reports a concept-period-unit once). `period_start` coalesced for
  instant facts in the index.
- **Latest view:** `financial_facts_latest` selects the max-`filed_date` row per
  `(cik, metric_key, period_end, period_type, unit)` → the restatement-aware
  "current" value, while the base table preserves history.
- **RLS:** SELECT-only `"Public read access"` policy + `GRANT SELECT` to
  `anon, authenticated`, mirroring the `sec_filings` read-policy convention
  (`20260531000000_…`). **Writes stay with the service-role ingest** — no
  INSERT/UPDATE/DELETE policy, so this is not a write over-grant.

### 4.2 How it joins existing data

- `financial_facts.cik` ↔ `companies.sec_cik` (and `sec_filings.cik`).
- `financial_facts.company_id` → `companies(id)`; `filing_id` → `sec_filings(id)`.
- The existing CIK↔company bridge (`fetchCompanyFilings` / edgar-consume, #291)
  already resolves company → CIK; the same resolver feeds the financials read.

### 4.3 Integration with the SEC ingest path

`backend/ingest_sec.py` currently routes 10-K/10-Q to
`record_periodic_filing()`, which is an explicit placeholder ("XBRL parsing in
follow-up PR"). The production build (later phase, not now) adds a
`backend/edgar/forms/xbrl_facts.py` step that, on a new periodic filing, fetches
Company Facts for the CIK and upserts the v1 line items into `financial_facts`.
Because Company Facts is per-company (not per-filing), the natural cadence is a
**daily refresh per tracked CIK** rather than strictly per-filing — simpler and
self-healing for restatements.

### 4.4 How it feeds the product

- **Company Intel.** Today the detail page (`src/app/company/[id]`) has
  Brief / Articles / Trend / Filings tabs and two *stub* tabs (Insider, Comps);
  there is **no financials surface and no fundamentals stored anywhere**. v1
  unlocks a **Financials tab** (revenue/EPS/margin trend table + sparklines from
  `financial_facts_latest`) and lets `CompanyKPIStrip` show latest revenue and
  YoY growth — real numbers, each linkable to its source filing.
- **Thesis grading.** `backend/thesis_grader.py` + `backend/grading/features.py`
  currently reason over *prose article summaries* + Finnhub price only. Structured
  facts add deterministic grading features — earnings growth, margin trend
  (expanding/compressing), operating-cash-flow trend — so a thesis like "margins
  are expanding" can be **checked against the actual GrossProfit/Revenue series**
  instead of inferred from sentiment. This is the highest-leverage consumer.
- **Optional `outputs` linkage.** Extractions could be recorded with
  `output_type='xbrl_extraction'` for the substrate-learning loop. Note this
  requires `ALTER TYPE … ADD VALUE` on the `output_type` enum; v1 keeps
  `financial_facts` independent of `outputs` and treats that linkage as optional
  follow-up.

---

## 5. Cost

**Recommended path (Company Facts):**
- **Per company:** 1 HTTPS GET (`companyfacts/CIK…json`, ~1–15 MB), parsed with
  stdlib JSON. **$0 in API/token cost.** Bounded by SEC's 10 req/s limit; we pace
  at 5 req/s (existing `backend/edgar/client.py` convention).
- **Per run (daily, ~200 tracked CIKs):** ~200 GETs ≈ **40–60s** wall at 5 req/s,
  **$0 marginal cost**. (A per-filing-only variant touches far fewer CIKs/day.)
- **Storage:** ~24 v1 facts × a handful of periods per company ≈ low thousands of
  small rows per company; negligible.

**LLM number-extraction (the path we're rejecting):**
- To match accuracy you must feed the financial statements (~20–50k input
  tokens/filing). At Gemini-2.5-Flash-class pricing that's roughly **$0.01–0.05
  per filing** in tokens; across ~1,000 periodic filings/yr (≈200 companies × ~5
  filings) ≈ **$15–50/yr** — *plus* the engineering cost of a deterministic
  verifier to trust the digits, *plus* unbounded hallucination/period/scale risk,
  *plus* cost that **scales with breadth** (every extra line item = more tokens).

**Why Company Facts wins:** the dollar gap is real but secondary; the decisive
factors are **$0 marginal cost, determinism, native provenance, and built-in
restatement handling**. An LLM would be paying tokens to *re-derive numbers the
SEC already publishes in machine-readable form* — and we'd then need the SEC data
anyway to verify the LLM. Spend LLM tokens on narrative (guidance, MD&A, 8-K
events), not on tagged financials.

---

## 6. Open questions & phased plan

### 6.1 Open questions (for Noah)

1. **Refresh cadence:** daily full refresh of all tracked CIKs, or only CIKs with
   a new periodic filing that day? (Daily-all is simpler and auto-heals
   restatements; per-filing is lighter.)
2. **History depth in v1:** latest annual + last 4–8 quarters, or full available
   history backfill? (Company Facts already holds the history.)
3. **Candidate-tag map ownership:** start with the curated map proven in the
   spike (revenue/cost/equity variants) — who owns extending it as new issuers
   appear?
4. **Comps timing:** do we want the Frames API peer-comparison ("Comps" tab) in
   the same phase as the Financials tab, or later?
5. **`outputs` enum:** add `xbrl_extraction` to the `output_type` enum for the
   substrate loop, or keep `financial_facts` standalone for v1?

### 6.2 Phased build plan

- **Phase 0 (this PR — done):** research, read-only spike with real numbers +
  spot-check, proposed `financial_facts` model, **unapplied** migration. No prod
  writes.
- **Phase 1 — deterministic facts (the v1 build):** apply the migration; build
  `backend/edgar/forms/xbrl_facts.py` (Company Facts fetch + candidate-tag
  resolver + upsert) wired into `ingest_sec.py`; daily refresh for tracked CIKs;
  `financial_facts_latest` view.
- **Phase 2 — surface it:** Company Intel **Financials tab** + KPI-strip
  enrichment, each value linked to its source filing; basic backfill of recent
  history.
- **Phase 3 — grading features:** feed structured facts into
  `backend/grading/features.py` (earnings growth, margin trend, OCF trend) so
  theses are checked against real fundamentals.
- **Phase 4 — beyond Company Facts:** Frames-based **Comps**; iXBRL parsing for
  **segments** and selected custom/non-GAAP tags.

---

## Appendix A0 — Phase 1 implementation (added 2026-06-03)

Phase 1 is now built on this branch (per Noah's decisions: daily refresh of
tracked CIKs as an isolated job; full Company Facts history; Frames/Comps
deferred; standalone table, no `output_type` enum change):

- `backend/edgar/xbrl_facts.py` — extraction: union-candidate-tags with
  period-aware resolution, YTD→discrete cash-flow differencing, fiscal labels +
  actual dates + SEC frame, accession-keyed history, restatement & tag-drift
  hooks (detection + logging; alerting is a fast-follow).
- `backend/edgar/xbrl_validation.py` — runtime gate: gross-profit / balance-sheet
  (NCI-aware) / EPS / cash-flow-roll tie-outs, magnitude & sign bounds (incl.
  the 570% gross-margin case and QoQ jumps), and to-the-dollar cross-endpoint
  reconciliation against Company Concept. Fail-closed: every fact is
  `validated` or `quarantined` + reason; `validated_only()` / the
  `financial_facts_latest` view are the only read paths.
- `backend/ingest_xbrl_facts.py` — isolated daily job (`--dry-run` works
  without the table; real runs fail with a clear error until the migration is
  applied).
- `backend/tests/test_xbrl_facts.py`, `backend/tests/test_xbrl_validation.py`
  — 35 offline unit tests (stdlib unittest), incl. the NVDA tag-migration
  regression and the YTD differencing fixtures.
- `backend/evals/xbrl_golden_eval.py` — the golden-set regression gate:
  18 spot-verified company × concept × period values asserted exact AND
  validated against live Company Facts under the FULL gate. This eval is the
  definition of done for any future extractor change.
  Evidence: `scratch/golden_eval_output.txt` (18/18 PASS; per-ticker
  validated/quarantined dry-run counts).

Observed gate behavior on real data: quarantines land on historical
comparatives only — AAPL split-basis EPS eras, NVDA 2007–2010 share counts
tagged in thousands (a genuine 1000× units inconsistency in the source), and
small mezzanine-equity balance gaps (~1%) in 2016-era filings. RTX initially
quarantined 425 balance-sheet facts until the gate learned the accounting-true
`Assets = Liabilities + ParentEquity + MinorityInterest` form; it now validates
2,942/2,942. No current-period golden value was ever quarantined.

## Appendix A — Spike artifacts (read-only, throwaway)

- `scratch/xbrl_spike.py` — pulls 5 tickers from Company Facts, extracts the v1
  set with provenance, probes segments, prints a coverage matrix.
- `scratch/xbrl_spike_output.txt` — captured run (coverage: 12/12 × 5/5, annual
  + quarterly).
- `scratch/xbrl_spotcheck.py` — cross-endpoint agreement + GrossProfit tie-out +
  source URLs.
- `scratch/xbrl_spotcheck_output.txt` — captured run (all matches/tie-outs OK).

These import nothing from the app, write nothing, and are safe to delete.

## Appendix B — Selected spike numbers (sanity reference)

| Company | Period | Revenue | Net income | EPS dil. | Gross margin | Source accn |
|---|---|---|---|---|---|---|
| AAPL | FY2025 (10-K, end 2025-09-27) | $416.161B | $112.010B | 7.46 | 46.91% | 0000320193-25-000079 |
| NVDA | FY2026 (10-K, end 2026-01-25) | $215.938B | $120.067B | 4.90 | 71.07% | 0001045810-26-000021 |
| CRWD | FY2026 (10-K, end 2026-01-31) | $4.812B | −$162.502M | −0.65 | 74.67% | 0001535527-26-000010 |
| DDOG | FY2025 (10-K, end 2025-12-31) | $3.427B | $107.741M | 0.31 | 79.96% | 0001628280-26-008819 |
| SNOW | FY2026 (10-K, end 2026-01-31) | $4.684B | −$1.332B | −3.95 | 67.17% | 0001640147-26-000008 |

All figures read directly from SEC Company Facts; GrossProfit tied out to
Revenue − CostOfRevenue to the dollar for every row.
