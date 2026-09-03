// Pure privacy / ticker derivation.
//
// The single source of truth for "is this company private?" is the presence
// of a resolved ticker on the canonical companies row (companies.ticker).
// There is no is_private column. Extracted here so the rule is unit-testable
// (src/lib/company-privacy.test.mjs) and shared by the data layer
// (getCompanyDetail) and the KPI strip, instead of being duplicated inline.

export interface TickerPrivacy {
  /** Normalized ticker (trimmed, uppercased) or null when none resolves. */
  ticker: string | null;
  /** Derived privacy: a company is private iff no ticker resolves. */
  isPrivate: boolean;
}

/**
 * companies.ticker (any shape) -> normalized ticker + derived privacy.
 * A non-empty trimmed string is public; null / empty / whitespace is private.
 */
export function deriveTickerPrivacy(rawTicker: unknown): TickerPrivacy {
  const ticker =
    typeof rawTicker === "string" && rawTicker.trim()
      ? rawTicker.trim().toUpperCase()
      : null;
  return { ticker, isPrivate: ticker === null };
}

/**
 * KPI PRIVATE-badge rule. Privacy is driven SOLELY by the ticker SOT
 * (detailIsPrivate). A Yahoo "private" / 404 response on a company that DOES
 * have a resolved ticker means the quote is pending (e.g. a brand-new listing
 * Yahoo has not indexed yet), NOT that the company is private. By taking only
 * detailIsPrivate as input, it is structurally impossible for an upstream
 * quote status to flip the badge.
 */
export function shouldRenderPrivate(detailIsPrivate: boolean): boolean {
  return detailIsPrivate;
}

/** The SEC identity the Filings / Insider / Financials tabs resolved. */
export interface FilerIdentity {
  /** CIK from resolveCompanyCik, or null when no SEC identity resolved. */
  cik: number | null;
  /** companies.ticker on the row that CIK was read from. */
  ticker: string | null;
}

/**
 * ONE ANSWER TO "IS THIS COMPANY PUBLIC", ACROSS THE HEADER AND THE TABS.
 *
 * TWO PATHS USED TO COMPUTE IT AND ONLY THE TABS WERE RIGHT.
 * `deriveTickerPrivacy` reads `companies.ticker` on the row `resolveAlias`
 * anchored (a case-insensitive exact name match, with NO bridge through the
 * `aliases` table). `resolveCompanyCik` resolves the same company by id, then
 * ticker, then name, then THROUGH `aliases`. The second reaches rows the first
 * cannot, so the two disagreed and the page printed both answers at once.
 *
 * Measured read-only, 2026-09-03. `/company/exxonmobil` anchors on the
 * brand-form `companies` row ("ExxonMobil"), whose ticker and sec_cik columns
 * are both null, and printed "Ticker Private" beside "Market data is not
 * available for this company". `aliases.lookup_key = 'exxonmobil'` also points
 * at the filer row ("Exxon", ticker XOM, cik 34088), which is the row the tabs
 * below resolved, so the same screen drew that filer's audited FY2025 revenue,
 * its recent filings and a Form 4. The page called a company private while
 * displaying its own SEC financials, which is worse than showing nothing.
 *
 * The same split runs the other way and is the larger half. `/company/<TICKER>`
 * is the URL the search box and the watchlist push, and its slug reconstructs
 * to the bare ticker string, which matches no company NAME and no alias key. So
 * `/company/apple` resolved the filer and `/company/AAPL` did not, and the
 * three SEC tabs denied an EDGAR identity the header had already resolved.
 *
 * THE RULE, and it is deliberately one-directional:
 *   - A company that already has a ticker is public and is returned UNTOUCHED.
 *     This function can never turn a public company private, so no page that is
 *     correct today can be flipped by it.
 *   - A company with no ticker AND no resolved CIK is returned UNTOUCHED. There
 *     is nothing that contradicts "private", so nothing is asserted.
 *   - A company with no ticker whose SEC identity DID resolve is an EDGAR filer.
 *     A filer is not private. It adopts the filer's ticker so the header, the
 *     market-data card and the tabs all describe the same issuer.
 *
 * BOTH SIDES ARE NORMALIZED BY THE SAME FUNCTION. `detail.ticker` arrived
 * through `deriveTickerPrivacy`; `filer.ticker` is raw `companies.ticker` off a
 * different row, so it is put through `deriveTickerPrivacy` here rather than
 * compared or stored as-is. A comparison where one side is normalized and the
 * other is not cannot succeed, and that is the shape of this whole defect.
 */
export function reconcileTickerPrivacy(
  detail: TickerPrivacy,
  filer: FilerIdentity,
): TickerPrivacy {
  // Already public. Never re-decide a company the ticker SOT got right.
  if (!detail.isPrivate) return detail;
  // Nothing contradicts "private": no SEC identity resolved for this page.
  if (filer.cik == null) return detail;
  // An EDGAR filer is not private, whatever the anchored row's ticker column says.
  return { ticker: deriveTickerPrivacy(filer.ticker).ticker, isPrivate: false };
}
