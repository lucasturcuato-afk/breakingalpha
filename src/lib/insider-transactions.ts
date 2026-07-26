/**
 * insider-transactions.ts -- pure presentation logic for Form 4 rows.
 *
 * Turns `insider_transactions` rows into display-ready facts: SEC transaction
 * codes translated to plain English, and every row classified as OPEN MARKET or
 * ROUTINE COMPENSATION.
 *
 * WHY THE SPLIT MATTERS. Undifferentiated, an RSU vest (code A) and an
 * open-market purchase (code P) both render as "insider acquired shares", which
 * reads as conviction buying when it is payroll. Grouping them apart is a
 * factual distinction drawn from the filing's own code, not an interpretation.
 *
 * COMPLIANCE. This module states what was filed and nothing else. No signal
 * language, no "bullish", no aggregate sentiment, no inference about intent.
 * Same descriptive-not-prescriptive rule as the financials commentary: the codes
 * and the numbers are facts, what they mean for the security is not ours to say.
 *
 * Pure and dependency-free: no network, no model, no DB. Unit-testable.
 */

/** One row of `insider_transactions`, as selected for display. */
export interface InsiderTransaction {
  id: string;
  accessionNumber: string | null;
  insiderName: string | null;
  insiderTitle: string | null;
  transactionCode: string | null;
  transactionDate: string | null;
  /** Filing date, joined from sec_filings on accession_number. Often null. */
  filedDate: string | null;
  shares: number | null;
  pricePerShare: number | null;
  totalValue: number | null;
  sharesOwnedAfter: number | null;
  documentUrl: string | null;
}

export type InsiderCategory = "open_market" | "routine" | "other";

export interface CodeMeaning {
  /** Plain-English label for the SEC transaction code. */
  label: string;
  category: InsiderCategory;
  /** Acquisition or disposition, where the code determines it. */
  direction: "acquired" | "disposed" | null;
}

/**
 * SEC Form 4 Table I/II transaction codes. Deterministic lookup, never a guess:
 * an unknown code renders as the raw code with an "other" category rather than
 * being mapped to something plausible.
 */
export const TRANSACTION_CODES: Record<string, CodeMeaning> = {
  P: { label: "Open-market purchase", category: "open_market", direction: "acquired" },
  S: { label: "Open-market sale", category: "open_market", direction: "disposed" },
  A: { label: "Grant or award", category: "routine", direction: "acquired" },
  M: { label: "Option exercise", category: "routine", direction: "acquired" },
  F: { label: "Shares withheld for taxes", category: "routine", direction: "disposed" },
  G: { label: "Gift", category: "other", direction: null },
  C: { label: "Conversion of derivative", category: "other", direction: "acquired" },
};

/** Meaning of a code, or an honest unknown. Case-insensitive, trims blanks. */
export function describeCode(code: string | null | undefined): CodeMeaning {
  const key = (code ?? "").trim().toUpperCase();
  if (key && key in TRANSACTION_CODES) return TRANSACTION_CODES[key];
  return {
    label: key ? `Code ${key}` : "Unspecified",
    category: "other",
    direction: null,
  };
}

export function categoryOf(code: string | null | undefined): InsiderCategory {
  return describeCode(code).category;
}

export interface InsiderGroups {
  openMarket: InsiderTransaction[];
  routine: InsiderTransaction[];
  other: InsiderTransaction[];
}

/**
 * Split rows by category, preserving input order within each group. Callers sort
 * before grouping; this never reorders.
 */
export function groupByCategory(rows: InsiderTransaction[]): InsiderGroups {
  const groups: InsiderGroups = { openMarket: [], routine: [], other: [] };
  for (const row of rows) {
    const category = categoryOf(row.transactionCode);
    if (category === "open_market") groups.openMarket.push(row);
    else if (category === "routine") groups.routine.push(row);
    else groups.other.push(row);
  }
  return groups;
}

/** Newest transaction first, tie-broken by accession then id for determinism. */
export function sortNewestFirst(rows: InsiderTransaction[]): InsiderTransaction[] {
  return [...rows].sort((a, b) => {
    const at = a.transactionDate ?? "";
    const bt = b.transactionDate ?? "";
    if (at !== bt) return bt.localeCompare(at);
    const aa = a.accessionNumber ?? "";
    const ba = b.accessionNumber ?? "";
    if (aa !== ba) return ba.localeCompare(aa);
    return a.id.localeCompare(b.id);
  });
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Locale-free date so server and client markup match. */
export function formatDate(iso: string | null): string {
  if (!iso) return "n/a";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const idx = parseInt(mo, 10) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${MONTHS[idx]} ${parseInt(d, 10)}, ${y}`;
}

/** Whole-share count with thousands separators. */
export function formatShares(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return Math.round(n).toLocaleString("en-US");
}

/** Per-share price, always two decimals. */
export function formatPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `$${n.toFixed(2)}`;
}

/** Compact dollar total. Values are filing figures, never derived estimates. */
export function formatValue(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Role as filed. Form 4 carries an officer title or the Director flag; entity
 * filers (funds, 10% owners) frequently carry neither, and that is rendered as
 * a stated blank rather than invented.
 */
export function formatRole(title: string | null): string {
  const t = (title ?? "").trim();
  return t.length > 0 ? t : "Not stated";
}
