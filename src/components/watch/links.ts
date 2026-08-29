import type { WatchlistItem } from "./fixture";

/**
 * Where a watchlist card goes, by kind. One kind has a destination and two do
 * not, and the two that do not are the point of this function existing.
 *
 * WHY IT IS NOT IN `watch-screen.tsx`. That module imports a CSS module, and
 * the unit runner (`tsx --test`) cannot load one, so a mapping declared beside
 * the card would be provable only through a browser. `/watch` is a server
 * component, so `page.route()` cannot reach its reads either. A pure module is
 * the only place this decision can be asserted on directly, and the assertion
 * that matters is the negative one: that a row with nowhere to go does not
 * become a link.
 *
 * PUBLIC -> `/company/<ticker>`. The route takes a RAW TICKER as its slug, and
 * that is measured rather than assumed: `/company/NVDA`, `/company/CEG` and
 * `/company/ZUMZ` each render the company they name. No slugification, no
 * lookup and no write. `watchlist-widget.tsx:141` already links the desk's rows
 * exactly this way, so the phone and the desk reach the same place from the
 * same value. A ticker the corpus has never indexed is not a broken link
 * either: `/company/BRK.B` answers 200 with the route's own "isn't on Signalera
 * yet" surface, which names the ticker and offers the directory.
 *
 * PRIVATE -> NOWHERE. A private entry's `identifier` is a company name, not a
 * symbol, and the route resolves a slug to a company by an exact name match. A
 * name that does not match lands on a miss state, so linking every private
 * entry would send an unknown share of them somewhere that cannot answer. The
 * card stays a plain container until a private entry carries something the
 * route can resolve.
 *
 * INDUSTRY -> NOWHERE, and this half is not a judgement call. The design opens
 * an industry on `/signal`, and `/signal` does not exist. Inventing a
 * destination for it would be a 404 with a card shape around it.
 *
 * See #643. The follow rows below the watchlist are a separate half of that
 * issue and are not touched here.
 */
export function watchlistHref(
  item: Pick<WatchlistItem, "kind" | "identifier">,
): string | null {
  if (item.kind !== "public") return null;
  /* Uppercased for the same reason the quote key is: the column is free text,
     and the route is case insensitive, so this only keeps one written form. An
     entry with no symbol left after trimming has nothing to link to. */
  const ticker = item.identifier.trim().toUpperCase();
  if (ticker.length === 0) return null;
  return `/company/${encodeURIComponent(ticker)}`;
}
