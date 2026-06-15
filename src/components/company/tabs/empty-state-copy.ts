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
// true, missing data means "nothing in our coverage yet", NOT "private": the
// private / pre-IPO label must appear ONLY in the false branch. A freshly-IPO'd
// filer (e.g. SpaceX, ticker set, sec_cik set, but no 8-K / 10-Q yet) lands on
// the true branch and must never read as private.

export function filingsEmptyCopy(hasCik: boolean): string {
  return hasCik
    ? "No recent 8-K, periodic, or insider filings."
    : "No SEC filings. This company is private, pre-IPO, or not in the EDGAR coverage list.";
}

export function financialsEmptyCopy(hasCik: boolean): string {
  return hasCik
    ? "Financials appear after the first periodic report."
    : "Financials not available. This company is private, pre-IPO, or not an SEC filer.";
}
