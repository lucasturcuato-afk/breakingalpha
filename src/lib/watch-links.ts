import { canonicalize } from "@/lib/company-intel";
import { TICKER_RE, slugToCompanyName } from "@/lib/data-access/aliasResolver";
import type { WatchlistKind } from "@/components/watch/fixture";

/**
 * watch-links - where a Radar watchlist card goes, PROVED before it is built.
 *
 * WHY THIS IS NOT A ONE LINER. The obvious version of this file was
 * `/company/${identifier}` for a ticker and null for everything else, and it
 * shipped a false claim on a live row. `/company/BRK.B` answers 200 with the
 * route's own "BRK.B isn't on Signalera yet" surface, while Berkshire Hathaway
 * sits in `companies` with 540 corpus mentions and `/company/Berkshire-Hathaway`
 * renders it. The cause is a regex, not a missing company:
 * `aliasResolver.ts`'s `TICKER_RE` is `/^[A-Z]{1,5}$/` and rejects the dot, so
 * the slug falls through to a name match that misses.
 * `resolveOrCreateCompany.ts:41` uses `/^[A-Z][A-Z.]{0,6}$/` and its comment
 * says outright that it is shaped that way to catch BRK.B. Two regexes for one
 * rule, and the file the route actually uses is the narrow one.
 *
 * THAT DIVERGENCE IS NOT FIXED HERE. Widening the resolver would fix BRK.B
 * everywhere and is the better product fix, but it is a shared resolver with
 * blast radius across every route that resolves a company, and this is a change
 * about Radar cards. Filed as its own issue. What this file does instead is
 * refuse to build a link the route will not honour.
 *
 * THE CHECK IS THE ROUTE'S OWN PIPELINE, step for step, which is the point of
 * writing it out rather than approximating it:
 *
 *   page.tsx      getCompanyDetail(sb, canonicalize(slugToCompanyName(id)))
 *   resolveAlias  ticker branch on THAT string, then, failing it, a SECOND
 *                 reconstruction before a case-insensitive exact name match
 *
 * The second pass is not a formality. `slugToCompanyName` consults `CANONICAL`,
 * which carries ticker-shaped keys (intc, coin, shop, uber, bx, tsm, kkr and
 * seventeen more), so `/company/INTC` arrives at `resolveAlias` already
 * rewritten to "Intel", fails the ticker lookup on a ticker that does not
 * exist, and lands through the NAME branch. A ticker-only check would omit
 * every one of those.
 *
 * THIS IS THE SAME APPROACH `src/lib/ask-companies-data.ts` TAKES on the Ask
 * directory (PR #736), deliberately rather than coincidentally: two units
 * inventing two answers to one question is what produced the regex divergence
 * above. `TICKER_RE` and `slugToCompanyName` are imported from the resolver
 * rather than copied for the same reason. When both land, one of the two
 * `resolvesTo` bodies should absorb the other.
 *
 * IT CAN ONLY OMIT, NEVER MISLEAD. The proof sets are built from a read this
 * loader already makes, and the name half of it matches case sensitively where
 * the resolver matches case insensitively. So a row the route would in fact
 * resolve can come back unproved and draw no link. That is the direction the
 * error has to fall in: an unlinked card is a card, and a linked one that lands
 * on the miss surface tells a reader their own company is not on Signalera.
 *
 * SERVER SIDE FOR RADAR, and that is structural rather than a convention. The
 * proof needs a read, so `resolvesTo` and `watchlistHref` only have an answer
 * where a read has happened. `watch-data.ts` calls them and puts the result on
 * `WatchlistItem.href`, so the card component renders a value rather than
 * deciding one.
 *
 * `linkLookups` IS THE EXCEPTION AND IT IS NOT AN ACCIDENT. It carries no read
 * and no proof set, only the route's reconstruction, so it is the half a client
 * can run. `src/lib/company-search-target.ts` calls it from the company
 * directory's search box, where a zero-match query has to be judged on whether
 * `/company/<what was typed>` can terminate at all; that module states the rule
 * and the two clauses it decides on. The reconstruction is the whole of what it
 * borrows: the ticker half of the answer is `TICKER_RE` on the RECONSTRUCTED
 * string, which is what `resolveAlias` tests too, because `page.tsx` hands it
 * `canonicalize(slugToCompanyName(id))` rather than the raw slug. Reading it as
 * "is the slug ticker-shaped" is the misreading to avoid.
 *
 * That path puts `aliasResolver` in the directory's client chunk;
 * `company-intel` was already there for `canonicalize`, and neither module
 * reads `server-only` or touches a secret. Anything that DOES need a read stays
 * on this side of the line.
 */

/** A watchlist row reduced to the two fields a destination depends on. */
export interface LinkableEntry {
  kind: WatchlistKind;
  identifier: string;
}

/**
 * What `/company/[id]` would have to find for a slug to land. Both halves come
 * from one read of `companies`; see `loadWatchLinkProof`.
 */
export interface WatchLinkProof {
  /** Uppercased tickers that exist in `companies`. */
  tickers: ReadonlySet<string>;
  /** Lower-cased names that exist in `companies`. */
  names: ReadonlySet<string>;
}

/** Nothing proved. Every href comes back null, which draws every card as a card. */
export const NO_PROOF: WatchLinkProof = { tickers: new Set(), names: new Set() };

/**
 * The string `page.tsx` hands to `getCompanyDetail`, and therefore the string
 * `resolveAlias` sees as its input.
 *
 * `null` FOR A SLUG THAT CANNOT BE READ. `slugToCompanyName` opens with
 * `decodeURIComponent`, which throws `URIError` on a malformed percent escape,
 * and every string a person types is a candidate: "100%", "50%off", "a%b". The
 * throw is not catchable at the useful end of the call, so a caller that ran
 * this inside an event handler took an uncaught `URIError` on a keypress. A
 * string the decoder rejects is not a slug and cannot name a company, so it is
 * an absence rather than an error, and every caller here already has an
 * absence path: no link, no navigation.
 *
 * Only `URIError` is swallowed. Anything else is a real fault and rethrows.
 */
function reconstruct(slug: string): string | null {
  try {
    return canonicalize(slugToCompanyName(slug)).trim();
  } catch (err) {
    if (err instanceof URIError) return null;
    throw err;
  }
}

/**
 * The two lookups the route would perform for this slug, as the values they
 * would be performed with. Exported so the loader can ask for exactly these
 * rows and nothing else.
 */
export function linkLookups(identifier: string): { ticker: string | null; name: string } | null {
  const slug = identifier.trim();
  if (slug.length === 0) return null;
  const first = reconstruct(slug);
  if (first === null || first.length === 0) return null;
  const upper = first.toUpperCase();
  // A decoded string can still carry a bare `%` ("100%25" -> "100%"), so the
  // second pass needs the same guard as the first.
  const second = reconstruct(first);
  if (second === null) return null;
  return {
    ticker: TICKER_RE.test(upper) ? upper : null,
    name: second,
  };
}

/**
 * Does `/company/<slug>` land on a real company?
 *
 * Ticker branch first, then the name branch, in the order `resolveAlias`
 * takes them.
 */
export function resolvesTo(identifier: string, proof: WatchLinkProof): boolean {
  const lookups = linkLookups(identifier);
  if (lookups === null) return false;
  if (lookups.ticker !== null && proof.tickers.has(lookups.ticker)) return true;
  return lookups.name.length > 0 && proof.names.has(lookups.name.toLowerCase());
}

/**
 * Where a watchlist card goes, by kind. One kind can have a destination and
 * two never do.
 *
 * PUBLIC, and only when the slug is proved. The slug is the stored identifier,
 * which is what `watchlist-widget.tsx:141` already links on the desk, so the
 * phone and the desk reach the same place from the same value.
 *
 * PRIVATE goes nowhere, and this is a PRODUCT CHOICE rather than a measurement.
 * The measurement says the reverse and is recorded here so nobody re-derives
 * the wrong reason from it: 9 of 10 distinct private identifiers resolve today,
 * against 73 of 97 public ones. The choice is about which failure a reader can
 * make sense of. A private entry's identifier is a free-text company name, so
 * it can only ever take the name branch, which is the fragile one: it is exact,
 * it moves when an editor renames a row, and it has no second chance behind it.
 * A ticker is a stable key with a dedicated branch. Until a private entry
 * carries something with a key behind it, the card stays a card.
 *
 * INDUSTRY goes nowhere and there is nothing to weigh. The design opens an
 * industry on `/signal`, `/signal` does not exist, and an industry is not a
 * company so `/company/[id]` is not a substitute for it.
 *
 * See #643. The follow rows below the watchlist are the other half of that
 * issue and are untouched here.
 */
export function watchlistHref(entry: LinkableEntry, proof: WatchLinkProof): string | null {
  if (entry.kind !== "public") return null;
  const slug = entry.identifier.trim();
  if (slug.length === 0) return null;
  if (!resolvesTo(slug, proof)) return null;
  return `/company/${encodeURIComponent(slug)}`;
}
