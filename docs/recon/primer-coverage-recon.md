# Coverage Primer — coverage recon (read-only)

One question: for a company a user looks up, what does the Coverage Primer
render by TICKER vs by CIK, where is the company-universe boundary, and what is
the real gap between "has a ticker row" and "renders a full Primer."

Base: worktree off fresh `origin/main` @ `dd0f83a5` (Coverage Primer PR1 #400,
overview #403, token logging #404). Findings cross-checked against actual fetch
code; counts are read-only `SELECT` against prod Supabase. No code changed
outside this doc.

---

## RECON 1 — Primer data sources by key

Page entry: `src/app/company/[id]/page.tsx`. The slug resolves to a `companies`
row via `getCompanyDetail` -> `resolveAlias`. `companyDetail.ticker` (from the
companies row) and the curated `COMPANY_IDENTITY[canonical]` are passed into
`PrimerTab`. `PrimerTab` then fetches live data client-side on view.

| Primer section | Resolves by | Provider / source | Needs ONLY ticker? | Needs sec_cik? | Renders when key missing |
|---|---|---|---|---|---|
| **PrimerSnapshot** (company, ticker, sector, industry) | company row (name/ticker/sector from `getCompanyDetail`); industry overlaid from Yahoo `assetProfile` by ticker, else curated | DB `companies` + Yahoo v10 `assetProfile` | no — DB-backed | no | Always renders. Industry resolution order: live Yahoo -> curated `COMPANY_IDENTITY.industry` -> null (omitted). Ticker/sector show whatever the row has. |
| **PrimerBusinessOverview** | ticker -> Yahoo `assetProfile.businessSummary`, then normalized through `POST /api/company-overview` (Gemini 2.5 Flash, write-through cached in `outputs`); else curated `COMPANY_IDENTITY.brief` | Yahoo v10 + Gemini | ticker for the live path; curated brief otherwise | no | **Section hidden entirely** when neither a live summary nor a curated brief exists (`resolvedDescription` null -> `null` render). |
| **PrimerKeyStats** (valuation digest: P/E fwd/trailing, market cap, 52w range, div yield, EPS TTM, beta) | ticker -> `GET /api/company-kpis?ticker=` -> `fetchQuoteSummary` | Yahoo v10 `quoteSummary` (`price,summaryDetail,defaultKeyStatistics,financialData,...`) | **YES — ticker only** | no | Neutral empty/loading state. No ticker -> `loading=false`, empty digest. Private/404 from Yahoo -> `kind:"private"` -> empty. |
| **PrimerFinancialSnapshot** (latest annual XBRL digest + computed margins, GAAP fundamentals) | name -> `resolveCompanyCik` (reads `companies.sec_cik` by `ilike(name)`) -> `financial_facts_latest` keyed by `cik` | SEC **XBRL** (`financial_facts` / `financial_facts_latest`) | no | **YES — sec_cik required** | `financialsEmptyCopy(hasCik)`: `cik != null` -> "Financials appear after the first periodic report."; `cik == null` -> "Financials not available. This company is private, pre-IPO, or not an SEC filer." |
| **Recent developments** (BriefTab, embedded unchanged) | canonical name -> `articles` (own DB, variant-expanded) -> memo content (Gemini, via the existing `/api/memo` path BriefTab owns) | own-DB `articles` + Gemini memo | no | no | Brief always renders; degrades to its own empty state when no articles. Does NOT touch SEC/Yahoo. |

**Ticker-only (Yahoo) sections:** PrimerKeyStats (entirely) and
PrimerBusinessOverview (live path). Both populate from Yahoo with nothing but a
valid ticker — no `sec_cik`, no SEC ingestion, no poller involvement.

**sec_cik-required sections:** PrimerFinancialSnapshot GAAP fundamentals only.
It reads `financial_facts_latest` by CIK; with no resolved `sec_cik` the CIK is
null and the section shows the private/pre-IPO empty copy. (The separate
**Filings** tab — not a Primer section — also needs CIK + populated
`sec_filings`.)

**Snapshot + Recent developments** need neither ticker nor CIK; they render from
the `companies` row and own-DB articles.

---

## RECON 2 — company-universe boundary

**How a user reaches a Primer.** Two surfaces feed navigation to
`/company/[slug]`:
- The main `/company` list/search page (`src/app/company/page.tsx`) reads
  `GET /api/companies` and links to `/company/${slugify(name)}`. `/api/companies`
  queries the `companies` table with `mention_count is not null`, ordered by
  `mention_count desc`, default `limit=500` (max 1000); the `?q=` search does
  `name.ilike` + `ticker.ilike` against that same table (limit 50). So the
  in-app lookup set is **the `companies` table** (mention-ordered, bounded by the
  limit), not an external universe.
- `company-search` / `finnhub-search` routes (consumed by WatchlistAddInput and
  trends) proxy **Finnhub** and can surface tickers NOT in `companies`.

**Can you reach a Primer for a company NOT in `companies`?** No. The page calls
`getCompanyDetail` -> `resolveAlias`, which queries ONLY `companies` (by id,
ticker, or exact-name `ilike`). On a miss it returns `null` and the page renders
`<EmptyState>` inside the shell — **the tab grid (and therefore the Primer) is
never mounted.** A Finnhub-only ticker typed into the watchlist input resolves
to no `companies` row and lands on the EmptyState, not a Primer.

**`companies` table counts (prod, read-only):**

| Metric | Count |
|---|---|
| Total rows | 4,236 |
| Rows with non-null `ticker` | 1,193 |
| Rows with non-null `sec_cik` | 1,016 |
| Rows with neither ticker nor cik | 3,043 |
| Rows with ticker but NO cik | 177 |
| Rows with ticker AND cik | 1,016 |

Every row that has a `sec_cik` also has a ticker (ticker∧cik == with_cik ==
1,016). So the CIK set is a strict subset of the ticker set. ~72% of rows
(3,043 / 4,236) have neither key and can only ever render Snapshot + Recent
developments.

**Lookup set vs full table.** Full table is 4,236. The default list view shows
the top `mention_count` slice (≤500/1000). Search (`?q=`) `ilike`-matches the
full table (any row with non-null `mention_count`), so a named company deep in
the tail is still reachable — but only if it exists as a row.

---

## RECON 3 — the two ceilings

**The cap.** `backend/edgar/submissions.py`, `get_watchlist_ciks()`:

```
.from("companies").select("id, ticker, sec_cik, name")
    .not_.is_("sec_cik", "null")
    .order("mention_count", desc=True)
    .limit(200)            # submissions.py:62
```

Value = **200** (watchlist CIKs unioned with top-200 by mention_count). This
resolver feeds the **hourly EDGAR submissions poll** (`ingest_sec.py`), which
populates `sec_filings`. Prod confirms the cap bites: `sec_filings` holds
**230 distinct CIKs** (≈ top-200 + watchlist).

**What the 200 cap gates — and what it does NOT:**
- **Gates:** the `sec_filings` table -> the **Filings tab** (8-K / periodic /
  insider), 8-K self-heal/summaries, and the cosmetic primary-document URL
  upgrade on financial cells (which falls back to the EDGAR index URL, so no
  data is lost).
- **Does NOT gate XBRL fundamentals.** PrimerFinancialSnapshot reads
  `financial_facts_latest`, populated by a **separate, deliberately UNCAPPED**
  resolver `get_xbrl_ciks()` (`submissions.py:80`) — "ALL companies with a
  sec_cik", paged with `.range()`. The daily XBRL refresh
  (`ingest_xbrl_facts.py`) runs on that, not on the 200-cap poll.
- **Does NOT gate any Yahoo-fed section** (Snapshot industry, Business overview,
  Key Stats) — those never touch the poll.

The `.limit(1000)` in `financial-facts.ts:304` is a per-company fetch cap (the
tab only shows 5 FY / 8 Q), **not** a coverage ceiling.

**Raising the 200 cap touches hourly EDGAR poll cost directly:** each added CIK
is one more `data.sec.gov/submissions` fetch every hour. Widening XBRL
fundamentals coverage does **not** — that is what the dedicated uncapped
`get_xbrl_ciks` exists to isolate.

**Tickered company with NO sec_cik (the 177 rows):**

| Primer section | Populates? | Path |
|---|---|---|
| PrimerSnapshot | Yes | DB + Yahoo industry |
| PrimerBusinessOverview | Yes | Yahoo `assetProfile` (ticker only) |
| PrimerKeyStats | Yes | Yahoo `quoteSummary` (ticker only) |
| Recent developments | Yes | own-DB articles |
| **PrimerFinancialSnapshot (GAAP)** | **No** | needs `sec_cik`; shows private/pre-IPO empty copy |

So a tickered, CIK-less company already renders a near-complete Primer — only
SEC fundamentals stay empty.

**Note on the daily XBRL backfill gap.** `financial_facts` currently covers
**505 distinct CIKs** out of the 1,016 `companies.sec_cik` rows. So even among
CIK-bearing companies, roughly half do not yet have XBRL rows — the daily
uncapped refresh has not reached them (or they have filed nothing parseable
yet). That, not the 200 cap, is the live ceiling on the fundamentals section.

---

## RECON 4 — the real gap for "full Primer on any tickered company"

Ordered blockers, with status:

| # | Blocker | Status | Detail |
|---|---|---|---|
| 1 | **Ingestion / lookup** — company must exist as a `companies` row | **Already solved** for indexed names; **net-new** for arbitrary tickers | No row -> EmptyState, no Primer. Reaching "any company" means inserting/resolving a row first. The Finnhub search surface exists but does not create rows. |
| 2 | **ticker -> Yahoo resolution** (Snapshot industry, Business overview, Key Stats) | **Already solved** | Pure ticker -> Yahoo v10. Works for all 1,193 tickered rows today; no CIK, no poll, no backfill. |
| 3 | **CIK backfill** (`companies.sec_cik`) — needed for GAAP fundamentals | **In progress (tonight's backfill)** | 177 tickered rows have no CIK; until backfilled their fundamentals show the empty state. |
| 4 | **Poller cap (200)** — gates `sec_filings` / Filings tab, NOT Primer fundamentals | **Already solved for the Primer** (out of scope); **net-new** only if Filings-tab coverage is the goal | Raising it costs hourly EDGAR fetches. The Primer's fundamentals do not depend on it. |
| 5 | **XBRL availability** (`financial_facts` rows for a CIK) | **In progress** | Uncapped daily refresh covers 505 of 1,016 CIK rows so far. A CIK with no XBRL rows yet still shows "appears after the first periodic report." This is the true ceiling on the fundamentals section. |

---

## Bottom line

**(a) Valuation + overview + brief only** costs almost nothing beyond *existing
as a `companies` row with a ticker*: Snapshot, Business overview, Key Stats, and
Recent developments all populate from Yahoo (ticker only) plus own-DB articles,
with zero dependency on `sec_cik`, the XBRL refresh, or the 200-CIK poll. All
1,193 tickered rows can render this today; the only true blocker for "any
company" is getting it into the `companies` table in the first place (lookup
currently can't reach non-rows — it falls to EmptyState).

**(b) Full Primer incl SEC fundamentals** additionally requires the company to
have (i) a resolved `companies.sec_cik` — 1,016 of 4,236 rows today, with 177
tickered rows pending tonight's CIK backfill — and (ii) actual XBRL rows in
`financial_facts`, which the uncapped daily refresh has populated for only ~505
of those 1,016 CIKs so far. The 200-CIK poller cap is a red herring here: it
gates the Filings tab, not the Primer's fundamentals. The real, ordered path to
full-Primer-for-any-tickered-company is row-exists -> CIK backfill -> XBRL
refresh reach; the Yahoo half is already done.
