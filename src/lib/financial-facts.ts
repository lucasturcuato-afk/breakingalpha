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
 * metric accepts exactly one unit and other rows are dropped.
 *
 * Period model (labels are period-derived by the backend, never the filing's
 * fiscal context): Annual = fiscal_period 'FY', latest 5 by fiscal_year;
 * Quarterly = Q1..Q4, latest 8 by period end. 6M/9M cumulative YTD rows are
 * excluded. Q4 income-statement cells are absent for most filers (there is
 * no Q4 10-Q; only operating cash flow carries a derived Q4) -- the tab
 * renders those as em-dashes.
 *
 * Consumption-side only: no writes, no memo-pool involvement.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCompanyCik, type CompanyRef } from "@/lib/sec-filings";

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
}

const EMPTY_VIEW: FinancialView = { periods: [], grid: {} };

export const ANNUAL_PERIODS = 5;
export const QUARTERLY_PERIODS = 8;

// One accepted unit per metric; stray-unit rows are dropped.
const UNIT_BY_METRIC: Record<string, string> = {
  revenue: "USD",
  cost_of_revenue: "USD",
  gross_profit: "USD",
  operating_income: "USD",
  net_income: "USD",
  ni_available_to_common_basic: "USD",
  ni_available_to_common_diluted: "USD",
  preferred_dividends: "USD",
  eps_basic: "USD/shares",
  eps_diluted: "USD/shares",
  shares_basic: "shares",
  shares_diluted: "shares",
  operating_cash_flow: "USD",
  total_assets: "USD",
  total_liabilities: "USD",
  stockholders_equity: "USD",
  minority_interest: "USD",
  redeemable_noncontrolling_interest: "USD",
  temporary_equity: "USD",
  cash_and_equivalents: "USD",
};

const FACT_COLS =
  "metric_key, period_type, fiscal_year, fiscal_period, period_end, unit, value, filing_url";

interface FactRow {
  metric_key: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_end: string;
  unit: string;
  value: number | string;
  filing_url: string | null;
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
  const keptKeys = new Set(periods.map((p) => p.key));
  for (const metric of Object.keys(grid)) {
    for (const k of Object.keys(grid[metric])) {
      if (!keptKeys.has(k)) delete grid[metric][k];
    }
    if (Object.keys(grid[metric]).length === 0) delete grid[metric];
  }
  return { periods, grid };
}

/**
 * Read-only financials for a company, resolved via resolveCompanyCik. Returns
 * empty views (not an error) when the company has no CIK or no validated rows.
 */
export async function fetchCompanyFinancials(
  supabase: SupabaseClient,
  ref: CompanyRef,
): Promise<CompanyFinancialsResult> {
  const res = await resolveCompanyCik(supabase, ref);
  if (res.cik == null) {
    return { cik: null, annual: EMPTY_VIEW, quarterly: EMPTY_VIEW };
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
      return { cik: res.cik, annual: EMPTY_VIEW, quarterly: EMPTY_VIEW };
    }
    const rows = ((data ?? []) as unknown as FactRow[]).filter(
      (r) => UNIT_BY_METRIC[r.metric_key] === r.unit,
    );
    const annualRows = rows.filter((r) => r.fiscal_period === "FY");
    const quarterlyRows = rows.filter((r) => r.fiscal_period !== "FY");
    return {
      cik: res.cik,
      annual: buildView(annualRows, ANNUAL_PERIODS),
      quarterly: buildView(quarterlyRows, QUARTERLY_PERIODS),
    };
  } catch (e) {
    console.error("[financial-facts] fetchCompanyFinancials exception:", e);
    return { cik: res.cik, annual: EMPTY_VIEW, quarterly: EMPTY_VIEW };
  }
}
