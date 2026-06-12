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
