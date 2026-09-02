/**
 * Precision filter for the watchlist `title ILIKE '%term%'` arm.
 *
 * THE DEFECT
 * ----------
 * `buildArticleOrFilter` (src/lib/watchlist-utils.ts, PROTECTED) emits, for
 * every search term of 6 characters or more:
 *
 *   primary_company.ilike.%Nasdaq%, title.ilike.%Nasdaq%
 *
 * The title arm is an unanchored substring match. Financial headlines carry an
 * exchange qualifier as a matter of house style, so `%Nasdaq%` matches every
 * one of these, none of which is about Nasdaq, Inc. (NDAQ):
 *
 *   Urban Outfitters (NASDAQ:URBN) Downgraded by Wall Street Zen to Hold
 *   Victory Capital to acquire First Eagle Investments in $7B deal (VCTR:NASDAQ)
 *   Hemnet Steps Up Share Buybacks on Nasdaq Stockholm
 *   Stock market today: Dow, S&P 500, Nasdaq futures fall as US strikes Iran
 *
 * Measured against prod on 2026-08-31, replaying the exact query the desk
 * issues for a NDAQ ticker entry (or-filter + order ingested_at desc + limit
 * 30): 18 of the 30 rows reached the user ONLY through the title arm, and not
 * one of the 18 was about the company. 16 of the 18 were exchange qualifier
 * tags; the other 2 were venue and index usages.
 *
 * WHY NOT JUST DROP THE TITLE ARM
 * -------------------------------
 * Because it carries real recall that nothing else provides. Same corpus,
 * term "Anthropic", rows where the title matches but primary_company does not:
 *
 *   Salesforce Stock Just Soared. Thank Anthropic.          (pc = Salesforce)
 *   Amazon Stock Gets a Boost. AWS Adds Anthropic, Meta ... (pc = Amazon)
 *   TeraWulf Stock Powers Higher On Anthropic AI Megadeal   (pc = TeraWulf)
 *
 * Those are exactly what an Anthropic watcher wants. Requiring
 * primary_company corroboration for every row would delete them. So the title
 * arm has to be made precise, not removed.
 *
 * THE RULE
 * --------
 * Keep a row when EITHER
 *   (a) its primary_company corroborates one of the search terms, OR
 *   (b) the title mentions a search term at a token boundary in a way that is
 *       not an exchange qualifier and not a venue or index construction.
 *
 * (a) is the safety net: a row that genuinely belongs to the watched company
 * survives even if its headline also happens to read like venue usage.
 *
 * This runs on rows already returned by PostgREST. It cannot widen a result
 * set, only narrow one, so it is safe to drop in ahead of the existing
 * fallback ladders: when it empties a result the caller's fallback fires and
 * the user gets real articles instead of wrong ones.
 */

import { getCompanySearchTerms } from "./watchlist-utils";

/**
 * Words that, immediately after a matched term, mark the match as a venue or
 * index construction rather than a reference to the company of that name.
 *
 * Deliberately small and deliberately term-agnostic: "Russell 100", "Bloomberg
 * Commodity Index" and "Nasdaq futures" are the same construction and all
 * three should lose to it. Words that are ambiguous outside an exchange
 * context are left out on purpose. "listed" is the one that keeps trying to
 * get in: it would drop "Anthropic listed as a defendant", so it stays out.
 */
const VENUE_QUALIFIERS = new Set([
  "composite",
  "futures",
  "index",
  "indexes",
  "indices",
  "stockholm",
  "copenhagen",
  "helsinki",
  "iceland",
  "tallinn",
  "riga",
  "vilnius",
  "baltic",
  "nordic",
  "100",
]);

/** Escape a term for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `title` mentions `term` at least once as a genuine reference.
 *
 * Token boundaries are checked with alphanumeric lookarounds rather than \b so
 * that terms ending in punctuation ("Lotus Technology Inc.") still anchor
 * correctly.
 */
export function titleMentionIsGenuine(title: string, term: string): boolean {
  const t = (title || "").trim();
  const needle = (term || "").trim();
  if (!t || !needle) return false;

  const re = new RegExp(
    `(?<![A-Za-z0-9])${escapeRegExp(needle)}(?![A-Za-z0-9])`,
    "gi",
  );

  for (const m of t.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = t.slice(0, start);
    const after = t.slice(end);

    // Exchange qualifier, either orientation: "NASDAQ:URBN" or "VCTR:NASDAQ".
    // The ticker side is 1-6 characters of A-Z and dots.
    const taggedAfter = /^\s*:\s*[A-Za-z][A-Za-z.]{0,5}(?![A-Za-z0-9])/.test(after);
    const taggedBefore = /(?<![A-Za-z0-9])[A-Za-z][A-Za-z.]{0,5}\s*:\s*$/.test(before);
    if (taggedAfter || taggedBefore) continue;

    // Venue or index construction: "Nasdaq Stockholm", "Nasdaq futures".
    // The class covers space, hyphen, and the two long dashes headlines use as
    // separators (U+2013 en, U+2014 em), written as escapes.
    const nextWord = after.match(/^[\s\-\u2013\u2014]+([A-Za-z0-9]+)/);
    if (nextWord && VENUE_QUALIFIERS.has(nextWord[1].toLowerCase())) continue;

    // A mention that is neither of those is the real thing.
    return true;
  }

  return false;
}

/** True when primary_company corroborates any of the search terms. */
export function companyCorroborates(
  primaryCompany: string | null | undefined,
  terms: string[],
): boolean {
  const pc = (primaryCompany || "").toLowerCase();
  if (!pc) return false;
  return terms.some((term) => {
    const t = term.trim().toLowerCase();
    return t.length > 0 && pc.includes(t);
  });
}

/**
 * The search terms a row must answer to, for a given watchlist entry.
 *
 * Mirrors what the callers hand to `buildArticleOrFilter`, so the filter is
 * judging rows against the same terms the query asked for.
 */
export function searchTermsForEntry(
  identifier: string,
  displayName: string | null | undefined,
  type: string,
): string[] {
  if (type === "sector") return [];
  return getCompanySearchTerms(identifier, displayName);
}

type TitleAndCompany = {
  title?: string | null;
  primary_company?: string | null;
};

/**
 * Drop rows that reached the result set only through an imprecise title match.
 *
 * `sector` entries are returned untouched: their filter is jsonb containment
 * on the taxonomy arrays and never involves the title arm at all.
 *
 * A row is kept when primary_company corroborates a term, or when the title
 * carries a genuine mention of one. Rows whose only claim is an exchange
 * qualifier or a venue construction are dropped.
 */
export function filterImpreciseTitleMatches<T extends TitleAndCompany>(
  rows: T[],
  identifier: string,
  displayName: string | null | undefined,
  type: string,
): T[] {
  if (type === "sector") return rows;

  const terms = searchTermsForEntry(identifier, displayName, type);
  if (terms.length === 0) return rows;

  return rows.filter((row) => {
    if (companyCorroborates(row.primary_company, terms)) return true;
    const title = row.title || "";
    return terms.some((term) => titleMentionIsGenuine(title, term));
  });
}
