/**
 * company-miss-copy.ts -- the pure copy decision behind the route-level
 * company miss state.
 *
 * Why a separate module: the components are .tsx and cannot load under
 * node:test, so the copy the component renders verbatim lives here and is
 * locked by tests/unit/company-miss-copy.test.ts. Same pattern as
 * src/components/company/tabs/empty-state-copy.ts.
 *
 * What the miss branch actually means
 * -----------------------------------
 * src/app/company/[id]/page.tsx renders this branch when getCompanyDetail()
 * yields null, and getCompanyDetail yields null on exactly one condition:
 * resolveAlias found no companies row (getCompanyDetail.ts:97-98). A company
 * row that exists with zero articles yields a detail object and renders the
 * tab grid with per-tab empty states instead.
 *
 * So this branch is "we could not resolve this name to a company", NOT "we
 * have no coverage of this company". The copy this replaces said "We haven't
 * indexed any qualifying coverage for this company", which described the
 * other condition and read as a claim that the company does not exist.
 *
 * Three phases, and only three, because that is all the code can tell apart:
 *   checking    the POST /api/company/resolve lookup is in flight. We do not
 *               know anything yet, so we assert nothing.
 *   unresolved  the lookup came back 404 not_found: no listed-equity match.
 *   failed      the lookup 5xx'd or the network died. We cannot say whether
 *               the company is covered, and saying "not covered" here would
 *               be a guess.
 *
 * What the code CANNOT tell apart, and therefore must not imply: a real
 * private company we do not index versus a name that is not a company at all.
 * Finnhub search is filtered to listed equity types, so a 404 means only "no
 * listed match". The unresolved copy says exactly that and no more.
 */

export type ResolvePhase = "checking" | "unresolved" | "failed";

export interface MissCopy {
  /** Rendered as the page h1. Carries the looked-up name. */
  headline: string;
  /** What happened, and the scope of coverage. */
  body: string;
  /** What the reader can do next. Empty string means render no action line. */
  action: string;
}

export function companyMissCopy(phase: ResolvePhase, name: string): MissCopy {
  if (phase === "checking") {
    return {
      headline: `Looking up ${name}.`,
      body: "Checking the Signalera index, then the listed-company directory, for a ticker or name that matches.",
      action: "",
    };
  }

  if (phase === "failed") {
    return {
      headline: `We could not finish looking up ${name}.`,
      body: "The lookup did not finish, so we cannot say whether this company is covered.",
      action: "Try again above, or search the directory.",
    };
  }

  return {
    headline: `We could not match ${name} to a company we cover.`,
    body: "Coverage today is public companies. A lookup matches on ticker or on listed company name, so a private or newly formed company often has nothing here to match against. That is a limit of what we index, not a claim about whether the company exists.",
    action:
      "Add it to your watchlist so it is there if coverage arrives, or search the directory for a ticker or a different spelling of the name.",
  };
}
