/**
 * reporting-currency.ts -- derive and render the currency a filer actually
 * reported in.
 *
 * WHY THIS EXISTS. financial-facts.ts pinned every monetary metric to "USD" and
 * dropped anything else, which is why Taiwan Semiconductor rendered an empty
 * Financials tab even though the IFRS extractor pulls 337 real facts for it.
 * Those facts are denominated in TWD, and TWD is not a defect: it is what the
 * 20-F reports.
 *
 * NO CONVERSION. There is no FX rate source in this codebase, and inventing one
 * would put fabricated numbers on a financial surface. Values are shown in the
 * currency the filer used, labeled with that currency. A reader converts, we do
 * not.
 *
 * NEVER MIX. A metric series must be single-currency. A chart or a delta across
 * TWD and USD periods is meaningless and would look plausible, which is the
 * dangerous kind of wrong. selectReportingCurrency picks one currency per
 * company and everything else is dropped.
 *
 * Pure and dependency-free. Unit-testable.
 */

/** Metric families by the unit shape they carry, independent of currency. */
const PER_SHARE_METRICS = new Set([
  "eps_basic",
  "eps_diluted",
]);

const SHARE_COUNT_METRICS = new Set([
  "shares_basic",
  "shares_diluted",
]);

/**
 * Monetary metrics. Anything here is denominated in the reporting currency;
 * per-share metrics carry "<CUR>/shares" and share counts carry a bare "shares".
 */
const MONETARY_METRICS = new Set([
  "revenue",
  "cost_of_revenue",
  "gross_profit",
  "operating_income",
  "net_income",
  "ni_available_to_common_basic",
  "ni_available_to_common_diluted",
  "preferred_dividends",
  "operating_cash_flow",
  "total_assets",
  "total_liabilities",
  "stockholders_equity",
  "minority_interest",
  "redeemable_noncontrolling_interest",
  "temporary_equity",
  "cash_and_equivalents",
]);

/**
 * The unit a metric must carry for a given reporting currency. Returns null for
 * an unknown metric, which callers treat as "drop", preserving the old
 * behavior of only admitting metrics we understand.
 */
export function expectedUnit(metricKey: string, currency: string): string | null {
  if (MONETARY_METRICS.has(metricKey)) return currency;
  if (PER_SHARE_METRICS.has(metricKey)) return `${currency}/shares`;
  if (SHARE_COUNT_METRICS.has(metricKey)) return "shares";
  return null;
}

/** The currency component of a unit: "TWD/shares" and "TWD" both give "TWD". */
export function currencyOfUnit(unit: string | null | undefined): string | null {
  const u = (unit ?? "").trim();
  if (!u || u === "shares") return null;
  const head = u.split("/")[0].trim().toUpperCase();
  // ISO 4217 codes are three letters. Anything else is not a currency.
  return /^[A-Z]{3}$/.test(head) ? head : null;
}

export interface UnitBearingRow {
  metric_key: string;
  unit: string;
}

/**
 * Choose the single currency a company reports in.
 *
 * Rule: the currency carrying the most monetary rows wins, with USD breaking a
 * tie so a US filer that also discloses a convenience translation stays on USD.
 * Deterministic tie-break by code otherwise, so the answer never depends on row
 * order.
 *
 * Returns null when no monetary row is present, in which case there is nothing
 * to denominate and the caller keeps only share-count metrics.
 */
export function selectReportingCurrency(rows: UnitBearingRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const cur = currencyOfUnit(r.unit);
    if (!cur) continue;
    counts.set(cur, (counts.get(cur) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let best: string | null = null;
  let bestN = -1;
  for (const [cur, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > bestN || (n === bestN && cur === "USD")) {
      best = cur;
      bestN = n;
    }
  }
  return best;
}

/**
 * Keep only rows consistent with the chosen currency. This is what replaces the
 * old hardcoded `UNIT_BY_METRIC[metric] === unit` check: same shape, same
 * strictness, but the currency is read from the data rather than assumed.
 */
export function filterToCurrency<T extends UnitBearingRow>(
  rows: T[],
  currency: string | null,
): T[] {
  if (currency == null) {
    return rows.filter((r) => expectedUnit(r.metric_key, "USD") === "shares" && r.unit === "shares");
  }
  return rows.filter((r) => expectedUnit(r.metric_key, currency) === r.unit);
}

/**
 * Symbols only where the symbol is unambiguous to a US-centric reader. TWD is
 * deliberately rendered as a code, not "NT$", because an unfamiliar symbol
 * beside a large number is exactly how a reader mistakes it for dollars.
 */
const SYMBOLS: Record<string, string> = {
  USD: "$",
};

/** "$" for USD, otherwise the ISO code plus a space: "TWD 2.89T". */
export function currencyPrefix(currency: string | null): string {
  if (!currency) return "";
  return SYMBOLS[currency] ?? `${currency} `;
}

/**
 * Compact monetary rendering, always currency-labeled. Never emits a bare "$"
 * for a non-USD value, which is the specific production failure this guards.
 */
export function formatMoney(value: number | null, currency: string | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const prefix = currencyPrefix(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}${prefix}${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}${prefix}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${prefix}${abs.toFixed(0)}`;
}

/** Human label for a surface: "Figures in TWD" / "Figures in USD". */
export function currencyNote(currency: string | null): string {
  return currency ? `Figures in ${currency} as reported.` : "";
}

/** True when the filer reports in something other than US dollars. */
export function isNonUsd(currency: string | null): boolean {
  return currency != null && currency !== "USD";
}
