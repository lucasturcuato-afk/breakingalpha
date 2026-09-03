/**
 * Financial facts consumption helpers (read-only).
 *
 * Bridges Company Intel's name/slug/id world to the financial_facts_latest
 * view (validated XBRL facts, keyed by CIK; see
 * supabase/migrations/20260603120000_create_financial_facts.sql). Resolution
 * reuses resolveCompanyCik from sec-filings, so private / pre-IPO names get a
 * null CIK and an empty result -- a normal state, not an error.
 *
 * UNIT PINNING: a handful of filers tag stray units (eps_* rows in "pure",
 * "shares", even "BillionsCubicFeet"; stockholders_equity in "USN"), so every
 * metric accepts exactly one unit and other rows are dropped. That accepted
 * unit is now derived from the company's OWN reporting currency (see
 * reporting-currency.ts) rather than pinned to USD, because pinning to USD
 * dropped every fact from a foreign private issuer. Values are never converted;
 * a single currency is chosen per company and the rest are dropped, so a metric
 * series can never mix denominations.
 *
 * Period model (labels are period-derived by the backend, never the filing's
 * fiscal context): Annual = fiscal_period 'FY', latest 5. Quarterly = the
 * latest 8 DISTINCT period_end dates drawn from all instant rows (balance
 * sheets, including FY-labeled fiscal year-ends) plus discrete-quarter
 * (Q1..Q4) durations; FY full-year durations never populate a quarterly
 * column. 6M/9M cumulative YTD rows are excluded everywhere. Year-end
 * quarterly columns therefore show balance-sheet values with dashed income
 * (no Q4 10-Q exists; only operating cash flow carries a derived Q4).
 *
 * Consumption-side only: no writes, no memo-pool involvement.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCompanyCik, type CompanyRef } from "@/lib/sec-filings";
import { filterToCurrency, selectReportingCurrency } from "@/lib/reporting-currency";

export interface FinancialPeriod {
  /** Stable column key, e.g. "FY-2025" or "Q2-2026". */
  key: string;
  /** Column header, e.g. "FY2025" or "Q2 FY2026". */
  label: string;
  fiscalYear: number;
  fiscalPeriod: string;
  /** Latest period_end seen for the column (sorting + balance alignment). */
  periodEnd: string;
}

export interface FinancialCell {
  value: number;
  filingUrl: string | null;
  /** Source accession; used server-side to upgrade filingUrl to the primary document. */
  accession: string | null;
}

/** metric_key -> period key -> cell. Missing entries render as em-dashes. */
export type FinancialGrid = Record<string, Record<string, FinancialCell>>;

export interface FinancialView {
  periods: FinancialPeriod[]; // newest first
  grid: FinancialGrid;
}

export interface CompanyFinancialsResult {
  cik: number | null;
  annual: FinancialView;
  quarterly: FinancialView;
  /**
   * ISO code the filer actually reported in, read from the fact units rather
   * than assumed. "USD" for domestic filers, "TWD" for Taiwan Semiconductor,
   * "DKK" for Novo Nordisk. Null when the company has no monetary facts.
   * Every value in the views is denominated in THIS currency and no other.
   */
  reportingCurrency: string | null;
  /**
   * TRUE when the read itself failed, which is NOT the same fact as "this
   * company has nothing on file" and must never be collapsed into it.
   *
   * WHY IT EXISTS. `financial_facts_latest` intermittently timed out with
   * Postgres `57014`, and both failure paths below used to return the same
   * empty views a company with no facts gets. Every consumer then rendered
   * `financialsEmptyCopy(true)`, "Financials appear after the first periodic
   * report", which is an ASSERTION ABOUT THE ISSUER. Measured on
   * `/company/salesforce?tab=financials` twenty minutes apart in one session:
   * the empty sentence on one pass, the full FY2022 to FY2026 table on the
   * next. Salesforce (cik 1108524) has validated XBRL on file, `net_income`
   * FY2026 7,457,000,000, so the sentence was false about a real company.
   *
   * An empty view answers "we have nothing to draw". This flag answers WHY,
   * and only a failed read sets it. A caller that ignores it is back to the
   * old behaviour, which is why every consumer of an empty view on this
   * surface reads it.
   *
   * THE TIMEOUT ITSELF IS FIXED, and this flag still matters. The 57014 was
   * not intermittent-by-nature: the read materialised a company's entire
   * filing history to draw thirteen columns, so its cost scaled with that
   * company's row count and the biggest filers ran into the statement timeout
   * whenever their pages were not already cached. FACT_LOOKBACK_YEARS bounds
   * the read on `period_end` and removes that scaling. What remains is every
   * other way a query can fail -- a dropped connection, a pooler restart, a
   * genuinely slow instant -- so the flag stays, and so does the rule that no
   * consumer may collapse it into an empty view.
   */
  readFailed: boolean;
}

const EMPTY_VIEW: FinancialView = { periods: [], grid: {} };

export const ANNUAL_PERIODS = 5;
export const QUARTERLY_PERIODS = 8;

/**
 * How far back the first read reaches, in years.
 *
 * WHY A BOUND EXISTS AT ALL. `financial_facts_latest` is
 * `SELECT DISTINCT ON (cik, metric_key, period_type, period_start, period_end,
 * unit) * FROM financial_facts WHERE validation_status = 'validated'`. Postgres
 * pushes a qual into a DISTINCT ON subquery only when the qual's column is in
 * the DISTINCT ON key (check_output_expressions in optimizer/path/allpaths.c
 * marks every other output column unsafe). So of this query's three quals:
 *   cik           IS in the key -> pushed down, becomes the index scan
 *   period_end    IS in the key -> pushed down
 *   fiscal_period is NOT in the key -> applied only AFTER the dedup
 * and `LIMIT` likewise cannot apply until after the dedup. Without a bound on a
 * key column, the query therefore materialises EVERY validated row the company
 * has ever filed in order to draw 5 annual and 8 quarterly columns.
 *
 * That is why the failures correlated with size. Cost here is proportional to a
 * company's stored fact rows, and the longest-filing issuers carry more than an
 * order of magnitude more of them than a recent listing. Nothing capped that
 * ratio, so the heaviest filers were the ones whose read reached the statement
 * timeout and came back as Postgres 57014 whenever their pages were not already
 * resident. The driver is row volume, NOT market capitalisation: filers of
 * ordinary size but long history failed the same way, measured.
 *
 * WHY EIGHT. The bound must never cost a column. Measured read-only against the
 * highest-volume companies available, an eight-year window still returns more
 * distinct fiscal years than ANNUAL_PERIODS and several times more distinct
 * quarter-ends than QUARTERLY_PERIODS, so the window is nowhere near binding on
 * either dimension while roughly halving the rows the view has to build.
 *
 * Eight years of slack is NOT a correctness argument on its own, because a
 * filer with gaps can need more. The guard in fetchCompanyFinancials is what
 * makes the bound safe; this constant only makes the common case cheap.
 */
export const FACT_LOOKBACK_YEARS = 8;

/**
 * The `period_end` floor for the bounded read, as an ISO date.
 * Exported so a test can pin the bound the query is actually built with rather
 * than recompute it, which would be two paths for one fact.
 */
export function factLookbackCutoff(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - FACT_LOOKBACK_YEARS);
  return d.toISOString().slice(0, 10);
}

// Unit pinning now lives in reporting-currency.ts, where the accepted unit is
// derived from the company's own reporting currency instead of a USD constant.
// The old UNIT_BY_METRIC map hardcoded "USD" for every monetary metric, which
// dropped 100% of a foreign private issuer's facts.

const FACT_COLS =
  "metric_key, period_type, fiscal_year, fiscal_period, period_end, unit, value, filing_url, accession_number";

interface FactRow {
  metric_key: string;
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_end: string;
  unit: string;
  value: number | string;
  filing_url: string | null;
  accession_number: string | null;
}

/**
 * EDGAR filing INDEX page for an accession. The stored filing_url is the bare
 * accession DIRECTORY (a raw file list); the index page is the human filing
 * view: .../data/{cik}/{accession_no_dashes}/{accession-with-dashes}-index.htm
 * The cik is unpadded, matching the form EDGAR serves in directory URLs.
 * Falls back to null when the accession does not normalize to 18 digits.
 */
function edgarFilingIndexUrl(cik: number, accession: string | null): string | null {
  const digits = (accession ?? "").replace(/-/g, "");
  if (!/^\d{18}$/.test(digits)) return null;
  const dashed = `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${digits}/${dashed}-index.htm`;
}

function periodLabel(fiscalPeriod: string, fiscalYear: number): string {
  return fiscalPeriod === "FY" ? `FY${fiscalYear}` : `${fiscalPeriod} FY${fiscalYear}`;
}

function buildView(rows: FactRow[], keep: number): FinancialView {
  const periodsByKey = new Map<string, FinancialPeriod>();
  const grid: FinancialGrid = {};

  for (const r of rows) {
    if (r.fiscal_year == null || !r.fiscal_period) continue;
    const key = `${r.fiscal_period}-${r.fiscal_year}`;
    const existing = periodsByKey.get(key);
    if (!existing || r.period_end > existing.periodEnd) {
      periodsByKey.set(key, {
        key,
        label: periodLabel(r.fiscal_period, r.fiscal_year),
        fiscalYear: r.fiscal_year,
        fiscalPeriod: r.fiscal_period,
        periodEnd: r.period_end,
      });
    }
    const cell: FinancialCell = {
      value: typeof r.value === "string" ? parseFloat(r.value) : r.value,
      filingUrl: r.filing_url ?? null,
      accession: r.accession_number ?? null,
    };
    const metricCells = (grid[r.metric_key] ??= {});
    // Boundary-jitter twins share a label; keep the later-ending instance.
    const prev = metricCells[key];
    if (!prev || r.period_end >= (periodsByKey.get(key)?.periodEnd ?? "")) {
      metricCells[key] = cell;
    }
  }

  const periods = [...periodsByKey.values()]
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))
    .slice(0, keep);
  return { periods, grid: pruneGrid(grid, periods) };
}

function pruneGrid(grid: FinancialGrid, periods: FinancialPeriod[]): FinancialGrid {
  const keptKeys = new Set(periods.map((p) => p.key));
  for (const metric of Object.keys(grid)) {
    for (const k of Object.keys(grid[metric])) {
      if (!keptKeys.has(k)) delete grid[metric][k];
    }
    if (Object.keys(grid[metric]).length === 0) delete grid[metric];
  }
  return grid;
}

/**
 * Quarterly view, keyed by DISTINCT period_end dates so the fiscal year-end
 * balance sheet is a real column. Inputs: ALL instant rows (the FY-labeled
 * instant IS the year-end balance sheet; hiding it dropped a 10-K-latest
 * filer's most recent balance sheet entirely) + duration rows labeled Q1-Q4
 * (discrete quarters; FY full-year durations NEVER populate a quarterly
 * column, so income cells dash at year-end columns -- the truthful shape).
 * A year-end column is headed by its FY label (e.g. "FY2025"), not a fake Q4.
 */
function buildQuarterlyView(rows: FactRow[], keep: number): FinancialView {
  const periodsByEnd = new Map<string, FinancialPeriod>();
  const grid: FinancialGrid = {};

  for (const r of rows) {
    if (r.fiscal_year == null || !r.fiscal_period) continue;
    const key = r.period_end;
    const isYearEndInstant = r.period_type === "instant" && r.fiscal_period === "FY";
    const existing = periodsByEnd.get(key);
    if (!existing || (isYearEndInstant && existing.fiscalPeriod !== "FY")) {
      periodsByEnd.set(key, {
        key,
        label: periodLabel(r.fiscal_period, r.fiscal_year),
        fiscalYear: r.fiscal_year,
        fiscalPeriod: r.fiscal_period,
        periodEnd: r.period_end,
      });
    }
    const metricCells = (grid[r.metric_key] ??= {});
    if (!metricCells[key]) {
      metricCells[key] = {
        value: typeof r.value === "string" ? parseFloat(r.value) : r.value,
        filingUrl: r.filing_url ?? null,
        accession: r.accession_number ?? null,
      };
    }
  }

  const periods = [...periodsByEnd.values()]
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))
    .slice(0, keep);
  return { periods, grid: pruneGrid(grid, periods) };
}

// Mirrors the backend SEC client's default UA (backend/edgar/client.py);
// the SEC 403s header-less requests.
const SEC_USER_AGENT = "Signalera lucas@signalera.ai";

// CLAUDE.md, learned the hard way: "SEC 8-K fetches can return 403 and hang
// silently. Keep the timeouts in place." This fetch runs inside the
// /company/[id] server render, now inside a Promise.all, so an open socket
// pins the entire page rather than just the reads queued behind it. The
// backend's SEC client already caps its GETs at 15s (backend/edgar/client.py);
// 5s is the tighter house default for outbound fetches in src/ and still ~66x
// the observed response time -- data.sec.gov submissions answered in 50-75ms
// for AAPL / NVDA / TSMC, ~27KB gzipped, measured 2026-08-20. Timing out is
// not a new failure mode: the catch below already yields a partial map and
// every caller keeps the filing-index URL, so the View link never breaks.
const SEC_SUBMISSIONS_TIMEOUT_MS = 5000;

/**
 * Resolve accessions to their primary filing DOCUMENT (the readable 10-K/10-Q
 * .htm), so View opens the filing itself rather than the index page.
 *
 * Cheapest source first: sec_filings.primary_doc_url joins on
 * accession_number with zero SEC fetches (it only covers cron-era filings, so
 * hit rate is partial). Anything unresolved falls back to ONE submissions-API
 * fetch for the company (cached an hour via Next, capped by
 * SEC_SUBMISSIONS_TIMEOUT_MS), never per-fact fetches.
 * Note the padding asymmetry: the submissions FILENAME takes the 10-digit
 * zero-padded CIK; the Archives doc path takes the unpadded CIK.
 * Failures return a partial (or empty) map; callers keep the filing-index URL
 * as the fallback so the link never breaks.
 */
async function resolvePrimaryDocUrls(
  supabase: SupabaseClient,
  cik: number,
  accessions: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (accessions.length === 0) return out;
  try {
    const { data } = await supabase
      .from("sec_filings")
      .select("accession_number, primary_doc_url")
      .in("accession_number", accessions);
    for (const r of data ?? []) {
      if (r.primary_doc_url) out[r.accession_number as string] = r.primary_doc_url as string;
    }
  } catch (e) {
    console.error("[financial-facts] sec_filings doc join failed:", e);
  }

  const unresolved = new Set(accessions.filter((a) => !out[a]));
  if (unresolved.size === 0) return out;
  try {
    const padded = String(cik).padStart(10, "0");
    const resp = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
      headers: { "User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate" },
      next: { revalidate: 3600 },
      // Passing a signal opts this fetch out of Next's per-render-pass
      // memoization (node_modules/next/dist/docs/01-app/03-api-reference/
      // 04-functions/fetch.md), which is inert here: /company/[id] reaches this
      // URL at most once per render. It does NOT weaken the persistent data
      // cache -- `signal` is not part of IncrementalCache.generateCacheKey in
      // Next 16.2.2 -- so next.revalidate 3600 still applies unchanged.
      signal: AbortSignal.timeout(SEC_SUBMISSIONS_TIMEOUT_MS),
    } as RequestInit);
    if (!resp.ok) return out;
    const recent = (await resp.json())?.filings?.recent ?? {};
    const accns: string[] = recent.accessionNumber ?? [];
    const docs: string[] = recent.primaryDocument ?? [];
    for (let i = 0; i < accns.length; i++) {
      if (unresolved.has(accns[i]) && docs[i]) {
        out[accns[i]] =
          `https://www.sec.gov/Archives/edgar/data/${cik}/${accns[i].replace(/-/g, "")}/${docs[i]}`;
      }
    }
  } catch (e) {
    console.error("[financial-facts] submissions doc lookup failed:", e);
  }
  return out;
}

function upgradeFilingUrls(view: FinancialView, docByAccession: Record<string, string>): void {
  for (const metric of Object.values(view.grid)) {
    for (const cell of Object.values(metric)) {
      if (cell.accession && docByAccession[cell.accession]) {
        cell.filingUrl = docByAccession[cell.accession];
      }
    }
  }
}

/**
 * Currency-pin the raw rows and point every source link at the filing index.
 * Single place so the bounded read and the widened re-read cannot diverge in
 * how they turn rows into the input `buildView` sees.
 */
function prepareRows(rows: FactRow[], currency: string | null, cik: number): FactRow[] {
  return filterToCurrency(rows, currency).map((r) => ({
    ...r,
    filing_url: edgarFilingIndexUrl(cik, r.accession_number) ?? r.filing_url,
  }));
}

/**
 * How many distinct fiscal years the annual view could draw from these rows.
 *
 * Counted on the currency-pinned rows and BEFORE any slice(), which is the
 * whole point: `buildView(...).periods.length` is already clamped to
 * ANNUAL_PERIODS by its own `keep` argument, so comparing it against
 * ANNUAL_PERIODS would be comparing that constant with itself normalised. The
 * two sides of the guard below have to be independent, and this is the side
 * the database wrote.
 */
function distinctAnnualPeriods(rows: FactRow[]): number {
  const years = new Set<number>();
  for (const r of rows) {
    if (r.fiscal_period === "FY" && r.fiscal_year != null) years.add(r.fiscal_year);
  }
  return years.size;
}

/**
 * Read-only financials for a company, resolved via resolveCompanyCik.
 *
 * NEVER THROWS. A company with no CIK, or with a CIK and no validated rows,
 * comes back as empty views. A READ THAT FAILED also comes back as empty views,
 * and the two are told apart by `readFailed` and by nothing else. Collapsing
 * them is how a Postgres statement timeout became the printed sentence
 * "Financials appear after the first periodic report" over an issuer with five
 * years of validated XBRL on file.
 *
 * Reachable from the /company/[id] Promise.all. Before adding .throwOnError(),
 * .abortSignal(), or an await outside this function's existing trys, read the
 * reject-safety block at the top of src/lib/sec-filings.ts.
 */
export async function fetchCompanyFinancials(
  supabase: SupabaseClient,
  ref: CompanyRef,
): Promise<CompanyFinancialsResult> {
  const res = await resolveCompanyCik(supabase, ref);
  if (res.cik == null) {
    /* NOT a read failure. There is no CIK to read facts for, which is a fact
       about the company and not about the query. */
    return {
      cik: null,
      annual: EMPTY_VIEW,
      quarterly: EMPTY_VIEW,
      reportingCurrency: null,
      readFailed: false,
    };
  }
  /* `readFailed`, not a bare empty view. The 57014 statement timeout lands
     here, and the caller that cannot tell it from an empty table renders a
     sentence about the issuer. ONE place builds this result, so the bounded
     read and the widened re-read cannot disagree about what a failure is. */
  const failed = (where: string, message: string): CompanyFinancialsResult => {
    console.error(`[financial-facts] ${where} failed:`, message);
    return {
      cik: res.cik,
      annual: EMPTY_VIEW,
      quarterly: EMPTY_VIEW,
      reportingCurrency: null,
      readFailed: true,
    };
  };

  // Newest-first with an explicit cap: PostgREST returns at most 1000 rows
  // anyway, and the tab only renders the most recent 5 FY / 8 Q columns.
  // `cutoff` bounds period_end, the one filter on this query besides cik that
  // Postgres can push INTO the view's DISTINCT ON (see FACT_LOOKBACK_YEARS);
  // null asks for the company's whole history.
  const readFacts = (cutoff: string | null) => {
    const q = supabase
      .from("financial_facts_latest")
      .select(FACT_COLS)
      .eq("cik", res.cik)
      .in("fiscal_period", ["FY", "Q1", "Q2", "Q3", "Q4"]);
    return (cutoff ? q.gte("period_end", cutoff) : q)
      .order("period_end", { ascending: false })
      .limit(1000);
  };

  try {
    const bounded = await readFacts(factLookbackCutoff());
    if (bounded.error) return failed("bounded fetch", bounded.error.message);

    // Currency is READ, not assumed. The old check was
    // `UNIT_BY_METRIC[r.metric_key] === r.unit`, which hardcoded USD and
    // therefore silently dropped every fact from a foreign private issuer:
    // TSMC extracts 337 real facts, all TWD, and rendered an empty tab.
    //
    // selectReportingCurrency picks ONE currency for the company and
    // filterToCurrency keeps only rows consistent with it, so a metric series
    // can never mix denominations. Nothing is converted.
    let allRows = (bounded.data ?? []) as unknown as FactRow[];
    let reportingCurrency = selectReportingCurrency(allRows);
    let rows = prepareRows(allRows, reportingCurrency, res.cik);

    /* THE GUARD. Without it the lookback window would be a silent truncation of
       a company's history, which is the exact class of bug `readFailed` exists
       to prevent: a filer with a gap in its filings, or one that stopped filing
       nine years ago, would draw fewer annual columns than it has and say
       nothing about why. Two independent sides: the count of fiscal years the
       DATABASE returned inside the window, and ANNUAL_PERIODS, the quota this
       module renders. Short of quota means the window may have cut real
       history, so re-read without a bound and let the full history win.

       Cost is paid only by companies that cannot fill five annual columns from
       eight years, and those are short-history or dormant filers, which are
       precisely the low-row-count companies whose unbounded read is the
       cheapest in the table anyway. A recent listing therefore pays a second
       read on every load, and measured, that pair still lands far below what
       one unbounded read cost the heaviest filers.

       A failed widening returns readFailed rather than the bounded rows: this
       branch is only reached when the bounded result is SUSPECTED incomplete,
       and drawing a possibly-truncated table as though it were whole is the
       assertion-about-the-issuer this file exists to refuse. */
    if (distinctAnnualPeriods(rows) < ANNUAL_PERIODS) {
      const full = await readFacts(null);
      if (full.error) return failed("unbounded re-read", full.error.message);
      allRows = (full.data ?? []) as unknown as FactRow[];
      reportingCurrency = selectReportingCurrency(allRows);
      rows = prepareRows(allRows, reportingCurrency, res.cik);
    }

    const annualRows = rows.filter((r) => r.fiscal_period === "FY");
    // Quarterly takes every INSTANT row (balance sheets, including FY-labeled
    // year-ends) but only DISCRETE-QUARTER durations; FY durations stay out.
    const quarterlyRows = rows.filter(
      (r) => r.period_type === "instant" || r.fiscal_period !== "FY",
    );
    const annual = buildView(annualRows, ANNUAL_PERIODS);
    const quarterly = buildQuarterlyView(quarterlyRows, QUARTERLY_PERIODS);

    // Upgrade View links to the primary filing document where resolvable;
    // unresolved cells keep the filing-index URL (the fallback never breaks).
    const visibleAccessions = new Set<string>();
    for (const view of [annual, quarterly]) {
      for (const metric of Object.values(view.grid)) {
        for (const cell of Object.values(metric)) {
          if (cell.accession) visibleAccessions.add(cell.accession);
        }
      }
    }
    const docByAccession = await resolvePrimaryDocUrls(
      supabase,
      res.cik,
      [...visibleAccessions],
    );
    upgradeFilingUrls(annual, docByAccession);
    upgradeFilingUrls(quarterly, docByAccession);

    return { cik: res.cik, annual, quarterly, reportingCurrency, readFailed: false };
  } catch (e) {
    console.error("[financial-facts] fetchCompanyFinancials exception:", e);
    return {
      cik: res.cik,
      annual: EMPTY_VIEW,
      quarterly: EMPTY_VIEW,
      reportingCurrency: null,
      readFailed: true,
    };
  }
}
