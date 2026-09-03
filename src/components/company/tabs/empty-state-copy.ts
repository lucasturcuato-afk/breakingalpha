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

export interface InsiderEmptyCopy {
  /** Rendered as the empty-state sentence. */
  headline: string;
  /** Coverage caveat, or null when there is no SEC identity to caveat. */
  note: string | null;
}

// Insider (F8) empty state.
//
// HONESTY NOTE, read before "improving" this. There are three states a product
// spec would like to draw apart:
//   (a) no SEC identity for the company,
//   (b) has a CIK but Form 4 was never polled,
//   (c) has a CIK, was polled, and nothing cleared the ingest filter.
// (b) and (c) ARE NOT DISTINGUISHABLE from data stored today. There is no poll
// cursor, no last_checked column, and no per-company EDGAR run log in the
// schema. The nearest proxy, "a Form 4 row exists in sec_filings but no
// insider_transactions rows exist", matched ZERO of 153 CIKs in prod on
// 2026-07-26, so it never fires and cannot be validated. Rather than invent a
// polled flag or imply a fix is pending, (b) and (c) collapse into one honest
// sentence that claims nothing about why the tab is empty. If a poll cursor
// ever lands, split them here and add a test.
//
// The no-CIK branch stays NEUTRAL for the same reason financialsEmptyCopy does:
// cik === null also covers an on-demand minted public ticker whose CIK is not
// resolved yet, so asserting "does not file with the SEC" would be false for
// real filers. State the missing identity, not a conclusion about the company.
export function insiderEmptyCopy(hasCik: boolean): InsiderEmptyCopy {
  if (!hasCik) {
    return {
      headline:
        "No SEC identity is on file for this company, so Form 4 insider transactions are not tracked.",
      note: null,
    };
  }
  return {
    headline: "No qualifying insider transactions are on file for this company.",
    note: INSIDER_COVERAGE_NOTE,
  };
}

/**
 * Coverage caveat shown under populated tables AND under the has-CIK empty
 * state. Single source so the two can never drift.
 */
export const INSIDER_COVERAGE_NOTE =
  "Source: SEC Form 4 filings. Coverage is partial: the ingest records open-market purchases and sales (SEC codes P and S) only, and records a sale only when it exceeds $1,000,000 or the filer is an executive officer. Absence of a row is not evidence that no transaction occurred.";

export function financialsEmptyCopy(hasCik: boolean): string {
  // No-CIK branch stays NEUTRAL: an on-demand minted public ticker (name + ticker,
  // sec_cik not resolved yet) has cik === null but is NOT private. Asserting
  // "private, pre-IPO, or not an SEC filer" was false for public filers like UNM.
  return hasCik
    ? "Financials appear after the first periodic report."
    : "SEC fundamentals are not available for this company yet.";
}

/**
 * A READ THAT FAILED, which is not a company with nothing on file.
 *
 * `fetchCompanyFinancials` gives back empty views on a query error, and
 * `financial_facts_latest` intermittently times out with Postgres `57014`. Every
 * consumer of an empty view then printed `financialsEmptyCopy(true)`,
 * "Financials appear after the first periodic report", which is an ASSERTION
 * ABOUT THE ISSUER rather than an absence. Measured on
 * `/company/salesforce?tab=financials` twenty minutes apart in one session: the
 * empty sentence on one pass and the full FY2022 to FY2026 table on the next,
 * over a filer whose `net_income` FY2026 is on file at 7,457,000,000. The
 * sentence was false about a real company, and nothing on the screen said so.
 *
 * This sentence claims nothing about the company at all. It says the read
 * failed, which is the only thing that is known.
 */
export function financialsUnreadableCopy(): string {
  return (
    "Financial data could not be read just now. That is a problem on our end, not " +
    "a statement about this company. Reload to try again."
  );
}

/**
 * The mobile Primer's key-figures empty state, which needs a THIRD state that
 * `financialsEmptyCopy` does not have.
 *
 * The Primer names four figures and only four: revenue, net income, operating
 * income and gross profit. A filer can have a CIK, have a periodic report on
 * file, and state none of those four. Measured on GRAB: its single validated
 * fact is `cost_of_revenue` for FY2022, so its key-figures list is empty while
 * the Financials section on the SAME screen draws
 * "FY2022 / INCOME STATEMENT / Cost of revenue $68.0M". The two-state copy drew
 * "Financials appear after the first periodic report" over exactly that, which
 * is false and is contradicted one tab away.
 *
 * The third branch says what is true of that screen: the report is on file,
 * these four figures are not in it, and the figures that ARE in it are one tap
 * away. It claims nothing about a listing and nothing about a filing that has
 * not happened.
 *
 * `hasFiledPeriod` implies an SEC identity, so it is read first; the two older
 * branches are untouched and still shared with the desktop tabs.
 */
export function primerKeyFiguresEmptyCopy(hasCik: boolean, hasFiledPeriod: boolean): string {
  if (hasFiledPeriod) {
    return (
      "The newest periodic report on file states none of revenue, net income, operating " +
      "income or gross profit. Every figure it does state is in Financials."
    );
  }
  return financialsEmptyCopy(hasCik);
}

/**
 * The Primer's recent-developments empty state.
 *
 * WHAT IT REPLACES, and why the old line was FALSE. The section printed
 * "No indexed coverage in the window this primer reads from." on screens with
 * abundant indexed coverage. Measured on apple and meta at every phone width in
 * both themes: development-classified rows exist INSIDE the 30-day window the
 * loader queries, several on each, and zero of them render.
 *
 * THE MECHANISM, because the copy has to name it. `selectFacetProtectedPool`
 * fills ten slots in three steps: up to four facet-protected picks out of the
 * 30-day candidate window, then filler out of a 14-day sub-window, then, ONLY
 * if slots are still open, a reach back into the 30-day set. On a well-covered
 * company the 14-day sub-window fills every remaining slot, so step three never
 * runs and the wider window is never read from. The section is not reporting an
 * empty window. It is reporting a full pool.
 *
 * THE CONTROL CASE that proves it: a thinner company renders exactly the
 * developments that fall inside 14 days, because there the filler runs out and
 * step three does execute.
 *
 * THE STANDARD THIS IS HELD TO is PR 790's: a reader gets the bucket's own
 * arithmetic and the reason for the gap in one breath, and hiding a count is
 * not an acceptable fix. So every branch names how many the primer selected,
 * how many the window it reads holds, and why those differ.
 *
 * AND THE HONEST CASE STAYS HONEST. Coverage existing while none of it is a
 * company development is the COMMON case and not a defect, so deleting the
 * whole empty well would have thrown away a true answer to be rid of a false
 * one. The two branches are worded so a reader can tell that case from the
 * full-pool case without reading the code.
 */
export interface PrimerDevelopmentsEmptyCopy {
  headline: string;
  note: string;
}

/**
 * @param selected           rows the pool selection handed back
 * @param poolSize           the ceiling it fills to
 * @param candidates         rows in the window it chose from
 * @param candidateDevelopments how many of those classify as a development
 * @param windowDays         the candidate window, or null when the path applies none
 * @param fillerWindowDays   the sub-window filled first, or null likewise
 */
export function primerDevelopmentsEmptyCopy(args: {
  selected: number;
  poolSize: number;
  candidates: number;
  candidateDevelopments: number;
  windowDays: number | null;
  fillerWindowDays: number | null;
}): PrimerDevelopmentsEmptyCopy {
  const { selected, poolSize, candidates, candidateDevelopments } = args;
  const { windowDays, fillerWindowDays } = args;

  /* NO COVERAGE AT ALL. The only branch where the original sentence was true,
     kept close to it, with the count that makes it checkable. */
  if (candidates === 0) {
    return {
      headline: "No indexed coverage in the window this primer reads from.",
      note: windowDays === null
        ? "Nothing is indexed against this company on the path that answered."
        : `Zero articles are indexed against this company in the last ${windowDays} days.`,
    };
  }

  /* THE FULL POOL. Developments exist in the window and none reached the pool,
     which is a fact about the selection and not about the company. */
  if (candidateDevelopments > 0) {
    const where =
      windowDays === null
        ? "in the window behind it"
        : `in the last ${windowDays} days`;
    const why =
      fillerWindowDays === null
        ? "The pool filled before the primer reached them."
        : `The pool fills from the last ${fillerWindowDays} days first, and that filled it.`;
    return {
      headline: "The pool filled before these could reach it.",
      note:
        `${candidateDevelopments} company ${candidateDevelopments === 1 ? "development sits" : "developments sit"} ${where}. ` +
        `The primer reads a pool of ${poolSize} and took ${selected}, none of them a development. ` +
        why,
    };
  }

  /* THE HONEST CASE. Coverage read, none of it a company development. This is
     the common one, and it is the one the reader must be able to tell apart
     from the branch above. */
  const scope =
    windowDays === null
      ? `all ${candidates} indexed ${candidates === 1 ? "article" : "articles"} on the path that answered`
      : `all ${candidates} ${candidates === 1 ? "article" : "articles"} indexed in the last ${windowDays} days`;
  return {
    headline: "Coverage, but no company development in it.",
    note:
      `The primer read ${scope} and none is a development: no earnings report, ` +
      `deal, funding round or listing. Read the coverage itself under Price and tone.`,
  };
}
