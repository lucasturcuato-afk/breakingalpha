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
   * WHY IT EXISTS. `financial_facts_latest` intermittently times out with
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
   */
  readFailed: boolean;
}

const EMPTY_VIEW: FinancialView = { periods: [], grid: {} };

export const ANNUAL_PERIODS = 5;
export const QUARTERLY_PERIODS = 8;

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

/**
 * Resolve accessions to their primary filing DOCUMENT (the readable 10-K/10-Q
 * .htm), so View opens the filing itself rather than the index page.
 *
 * Cheapest source first: sec_filings.primary_doc_url joins on
 * accession_number with zero SEC fetches (it only covers cron-era filings, so
 * hit rate is partial). Anything unresolved falls back to ONE submissions-API
 * fetch for the company (cached an hour via Next), never per-fact fetches.
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
 * Read-only financials for a company, resolved via resolveCompanyCik.
 *
 * NEVER THROWS. A company with no CIK, or with a CIK and no validated rows,
 * comes back as empty views. A READ THAT FAILED also comes back as empty views,
 * and the two are told apart by `readFailed` and by nothing else. Collapsing
 * them is how a Postgres statement timeout became the printed sentence
 * "Financials appear after the first periodic report" over an issuer with five
 * years of validated XBRL on file.
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
  try {
    // Newest-first with an explicit cap: PostgREST returns at most 1000 rows
    // anyway, and the tab only renders the most recent 5 FY / 8 Q columns.
    const { data, error } = await supabase
      .from("financial_facts_latest")
      .select(FACT_COLS)
      .eq("cik", res.cik)
      .in("fiscal_period", ["FY", "Q1", "Q2", "Q3", "Q4"])
      .order("period_end", { ascending: false })
      .limit(1000);
    if (error) {
      console.error("[financial-facts] fetch failed:", error.message);
      /* `readFailed`, not a bare empty view. The 57014 statement timeout lands
         here, and the caller that cannot tell it from an empty table renders a
         sentence about the issuer. */
      return {
        cik: res.cik,
        annual: EMPTY_VIEW,
        quarterly: EMPTY_VIEW,
        reportingCurrency: null,
        readFailed: true,
      };
    }
    // Currency is READ, not assumed. The old check was
    // `UNIT_BY_METRIC[r.metric_key] === r.unit`, which hardcoded USD and
    // therefore silently dropped every fact from a foreign private issuer:
    // TSMC extracts 337 real facts, all TWD, and rendered an empty tab.
    //
    // selectReportingCurrency picks ONE currency for the company and
    // filterToCurrency keeps only rows consistent with it, so a metric series
    // can never mix denominations. Nothing is converted.
    const allRows = (data ?? []) as unknown as FactRow[];
    const reportingCurrency = selectReportingCurrency(allRows);
    const rows = filterToCurrency(allRows, reportingCurrency)
      // Source links open the filing index page, not the raw directory.
      .map((r) => ({
        ...r,
        filing_url: edgarFilingIndexUrl(res.cik as number, r.accession_number) ?? r.filing_url,
      }));
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
