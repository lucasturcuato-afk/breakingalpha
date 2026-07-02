/**
 * Pure tier-selection logic for the thin-news fallback. Kept in a leaf module
 * with NO runtime imports (only an erased `import type`) so it loads under
 * node:test / tsx without the "@/..." alias chain, mirroring edgar-url.ts.
 * Re-exported from src/lib/thin-fallback.ts for callers.
 */
import type { CompanyFinancialsResult } from "@/lib/financial-facts";

export type ThinFallbackTier = "A" | "B" | "C";

/** True when a financials result carries at least one validated XBRL period. */
export function hasXbrl(financials: CompanyFinancialsResult): boolean {
  return financials.annual.periods.length > 0 || financials.quarterly.periods.length > 0;
}

/**
 * Pure tier decision, keyed ONLY on real data presence:
 *   A: XBRL financials exist.
 *   B: a CIK and >= 1 filing exist (but no XBRL).
 *   C: everything else (CIK but no filings/XBRL, or no CIK).
 */
export function selectTier(
  xbrlPresent: boolean,
  filingsCount: number,
  cik: number | null,
): ThinFallbackTier {
  if (xbrlPresent) return "A";
  if (cik != null && filingsCount > 0) return "B";
  return "C";
}
