// Empty-state copy for the Company Intel Filings and Financials tabs.
//
// Split out as a pure module so the public-with-CIK vs private classification
// can be unit-tested under node:test without rendering JSX -- FilingsTab /
// FinancialsTab are .tsx and cannot load under the node:test runner. Each tab
// renders exactly the returned string inside its empty-state <p>, so asserting
// these functions pins the copy the user actually sees. Mirrors the
// financials-format.ts split tested by financials-format.test.ts.
//
// hasCik = the company resolved to a SEC CIK (a public / EDGAR filer). When
// true, missing data means "nothing in our coverage yet", NOT "private". A
// freshly-IPO'd filer (e.g. SpaceX, ticker set, sec_cik set, but no 8-K / 10-Q
// yet) lands on the true branch and must never read as private.
//
// Financials copy stays NEUTRAL in BOTH branches: an on-demand minted public
// ticker (name + ticker, sec_cik not yet resolved) has cik === null but is not
// private, so financialsEmptyCopy must not assert private / pre-IPO. The filings
// false branch still carries the private label (filings coverage is a stronger
// signal of EDGAR presence); revisit if on-demand mint changes that too.

export function filingsEmptyCopy(hasCik: boolean): string {
  return hasCik
    ? "No recent 8-K, periodic, or insider filings."
    : "No SEC filings. This company is private, pre-IPO, or not in the EDGAR coverage list.";
}

export function financialsEmptyCopy(hasCik: boolean): string {
  // No-CIK branch stays NEUTRAL: an on-demand minted public ticker (name + ticker,
  // sec_cik not resolved yet) has cik === null but is NOT private. Asserting
  // "private, pre-IPO, or not an SEC filer" was false for public filers like UNM.
  return hasCik
    ? "Financials appear after the first periodic report."
    : "SEC fundamentals are not available for this company yet.";
}
