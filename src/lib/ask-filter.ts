/**
 * ask-filter - the substring match behind Ask's field.
 *
 * WHAT IT IS, said plainly, because the screen says the same thing out loud.
 * It narrows the rows the server already read. It does not search the corpus,
 * it reaches no endpoint, it calls no model, and it makes NO TYPO TOLERANCE
 * PROMISE, because a substring match over fifty names cannot keep one. The
 * screen's own copy under the field says so rather than leaving a reader to
 * infer it from an empty list.
 *
 * WHY IT IS ITS OWN MODULE. `src/lib/ask-companies-data.ts` is the read, and it
 * imports `company-intel`, `aliasResolver` and the companies route to prove
 * every href. The Ask screen is a `"use client"` module, so a value import of
 * that file would drag all three into the browser bundle for the sake of one
 * `includes`. This carries no imports at all except the row's type.
 *
 * NAME AND TICKER, and nothing else. Sector is drawn on the row as a tail, and
 * matching on it would mean typing "tech" returns five companies with no
 * visible reason why, since the tail is the quietest thing on the row. The two
 * fields a reader is looking a company up BY are the two that match.
 */

import type { AskCompanyRow } from "@/lib/ask-companies-data";

/**
 * How many rows the directory draws when the field is EMPTY. A non-empty field
 * overrides it and draws every match, because a filter that hid matches would
 * be lying about how many rows carry the name.
 *
 * It lives here rather than beside the read for one mechanical reason: the
 * screen is a `"use client"` module and cannot value-import
 * `ask-companies-data.ts` without dragging `company-intel`, `aliasResolver` and
 * the companies route into the browser bundle.
 */
export const ASK_SHOWN = 6;

/**
 * Rows whose name or ticker contains the query, case-insensitively, in the
 * order the read returned them. An empty or blank query gives every row back
 * unchanged; the caller decides how many of those to draw.
 */
export function filterAskCompanies(rows: AskCompanyRow[], query: string): AskCompanyRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      (row.ticker !== null && row.ticker.toLowerCase().includes(needle)),
  );
}

/**
 * What the block says about a filtered result, and the count is read from the
 * result rather than typed.
 *
 * The second sentence is the load-bearing one and is the same in all three
 * cases: the filter narrowed a list, and nothing outside that list was looked
 * at. It is what keeps a reader from taking an empty result as "Signalera has
 * never heard of this company".
 */
export function filterBlurb(matched: number): string {
  const tail = "Nothing beyond this list was searched.";
  if (matched === 0) return `No company in this directory carries that name. ${tail}`;
  if (matched === 1) return `One company in this directory carries that name. ${tail}`;
  return `${matched} companies in this directory carry that name. ${tail}`;
}
