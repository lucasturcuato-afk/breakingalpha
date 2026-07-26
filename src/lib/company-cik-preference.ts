/**
 * company-cik-preference.ts -- the single definition of "which duplicate company
 * row wins".
 *
 * WHY THIS EXISTS. The companies table stores duplicates: the CIK lives on one
 * row ("Taiwan Semiconductor", cik 1046179) while a shorter or more-mentioned
 * surface form ("TSMC", 439 mentions) exists as a SEPARATE row with a null
 * sec_cik. Two resolvers independently decided what to do about that and
 * disagreed:
 *
 *   src/lib/sec-filings.ts        resolveCompanyCik -> pickPreferCik, CIK wins
 *   src/lib/data-access/          resolveAlias -> rankCluster, mention_count wins
 *     aliasResolver.ts
 *
 * So /company/TSM rendered "SEC fundamentals are not available" off the CIK-less
 * row while the financials API generated full XBRL commentary off the filer row,
 * for the same company, at the same moment. Same class of split on PTON, RGTI
 * and GEMI.
 *
 * The rule now lives here once and both call sites import it, so the two paths
 * cannot drift apart again. Adding a third resolver means importing this, not
 * re-deciding.
 *
 * Deliberately NOT in scope: clustering, normalization, or which rows are
 * candidates in the first place. This module only orders candidates that some
 * caller already decided belong together.
 *
 * Pure and dependency-free. Unit-testable.
 */

/** Minimum shape needed to rank. Both CompanyRow and ResolverRow satisfy it. */
export interface CikRankable {
  sec_cik?: number | null;
}

/** A row carries a usable SEC identity. */
export function hasCik(row: CikRankable): boolean {
  return row.sec_cik != null;
}

/**
 * Comparator fragment: CIK-bearing rows sort ahead of CIK-less ones, and rows
 * on the same side of that line compare equal so the caller's own tiebreakers
 * decide. Chain it BEFORE the existing ordering, never after.
 */
export function compareCikFirst(a: CikRankable, b: CikRankable): number {
  const ac = hasCik(a) ? 1 : 0;
  const bc = hasCik(b) ? 1 : 0;
  return bc - ac;
}

/**
 * First CIK-bearing row, else the first row. Order-sensitive by design: the
 * caller passes rows in its own preference order, and this promotes the best
 * CIK-bearing candidate without otherwise disturbing that order. Returns null
 * for an empty list.
 *
 * This is the original pickPreferCik body, generalized off CompanyRow so the
 * alias resolver can share it.
 */
export function preferCik<T extends CikRankable>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.find(hasCik) ?? rows[0];
}
