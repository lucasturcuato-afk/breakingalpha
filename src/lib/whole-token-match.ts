/**
 * ONE definition of "this name names that company", for every read path that
 * decides company identity from two strings.
 *
 * WHAT THIS REPLACES, AND WHY IT IS ONE FUNCTION AND NOT THREE
 * -----------------------------------------------------------
 * Three call sites answered that question with a bare `.includes()`:
 *
 *   src/lib/watchlist-title-precision.ts  companyCorroborates
 *   src/app/radar/watchlist/page.tsx      the short-company early return
 *   src/lib/radar-following.ts            (no in-memory check at all; the
 *                                          unanchored ILIKE was the decision)
 *
 * A bare `.includes()` accepts an INTERIOR substring, and an interior substring
 * is not evidence of identity. A watchlist or follow entry named "Ola" accepts
 * "Motorola Solutions" and "Coca-Cola"; "LIC" accepts "Republic Services" and
 * "Publicis"; "ABC" accepts "Labcorp". None of those rows is about the company
 * the reader asked for, and the reader is given no way to tell.
 *
 * The narrower half of that pair was already correct and had been for a while.
 * `titleMentionIsGenuine`, in the same file as `companyCorroborates`, written by
 * the same hand, checks the SAME question against the title with alphanumeric
 * lookarounds so a token boundary is required. Its sibling checking
 * primary_company did not, and because `companyCorroborates` SHORT-CIRCUITS the
 * filter, the anchored half never ran on any row the unanchored half accepted.
 * Two paths computing one fact, one of them guarded.
 *
 * THE RULE
 * --------
 * Both sides are lowercased and reduced to alphanumeric tokens. Then:
 *
 *   1. WHOLE-TOKEN RUN. The term's tokens appear as a contiguous run of whole
 *      tokens in the name. "nasdaq" matches "Nasdaq, Inc."; "visa" matches
 *      "Visa Inc" and does NOT match "Visanet".
 *
 *   2. LEFT-ANCHORED TOKEN PREFIX, above a length floor. A term of at least
 *      TOKEN_PREFIX_MIN_LEN characters also matches when it begins a token of
 *      the name: "jpmorgan" reaches the concatenated brand form
 *      "JPMorganChase". This is the same allowance `web-memo-entity.matchesName`
 *      already makes for concatenated brands, and it carries the same floor.
 *
 * Nothing else matches. In particular an INTERIOR or TRAILING fragment never
 * does, at any length: "ola" is neither a whole token of "coca cola" nor the
 * start of any token in it, and the floor puts every short fragment out of
 * reach of rule 2 as well. That is the property this module exists to hold.
 *
 * IT CAN ONLY NARROW. Every caller applies it to rows a query has already
 * returned, so a stricter answer removes rows and can never add one.
 */

/** Matches `web-memo-entity.DOMINANT_TOKEN_MIN_LEN`, and for the same reason:
 * below six characters a prefix test stops being a brand test and starts being
 * a spell-check. Kept in sync by intent, not by import, because that module's
 * floor governs a different corpus (web search results, not primary_company). */
export const TOKEN_PREFIX_MIN_LEN = 6;

/** Lowercase, every run of non-alphanumerics to one space, trimmed. */
export function normalizeForTokenMatch(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Does `name` name the company `term` refers to?
 *
 * Whole-token-run containment, plus a left-anchored token prefix above
 * TOKEN_PREFIX_MIN_LEN. Never an interior or trailing fragment.
 */
export function nameContainsTerm(
  name: string | null | undefined,
  term: string | null | undefined,
): boolean {
  const hay = normalizeForTokenMatch(name);
  const needle = normalizeForTokenMatch(term);
  if (!hay || !needle) return false;

  // 1. Whole-token run. The space padding is what makes this a token test and
  // not a substring test: " ola " is not inside " coca cola ".
  if (` ${hay} `.includes(` ${needle} `)) return true;

  // 2. Left-anchored token prefix, for concatenated brand forms only. A single
  // needle token is required: a multi-token term that failed rule 1 did not
  // merely lose a separator.
  if (needle.length < TOKEN_PREFIX_MIN_LEN) return false;
  if (needle.includes(" ")) return false;
  return hay.split(" ").some((token) => token.startsWith(needle));
}

/** True when any of `terms` names the company `name` refers to. */
export function nameContainsAnyTerm(
  name: string | null | undefined,
  terms: readonly string[],
): boolean {
  return terms.some((term) => nameContainsTerm(name, term));
}
