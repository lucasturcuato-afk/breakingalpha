import type { OutcomeState } from "@/components/ledger/claim-anatomy";

/**
 * Search's SHAPE, its jump list and its matcher. No invented content.
 *
 * Split out of `./fixture` so the client component can reach all of this
 * without pulling the invented result set into the browser bundle. A
 * `"use client"` module that value-imports from `./fixture` downloads every
 * string in it: the gate stops the render, not the download, so an invented
 * entry claiming the reader wrote a call about Constellation Energy reached
 * `.next/static` even on a production build where it can never paint.
 *
 * The jump list below is NOT a fixture. Every row is a real destination that
 * exists on this branch today, so it renders in every environment and belongs
 * on the client side of the boundary. The matcher is a pure function over
 * whatever it is handed. Neither states a fact about a reader.
 */

/* ── The jump list ────────────────────────────────────────────────────
 *
 * Labels and grouping are the command palette's own, read off
 * `src/components/shell/command-palette.tsx` lines 21 to 34. The palette
 * renders by section rather than by array order, so Settings is the fifth
 * Pages row and not the twelfth row overall; the prototype's empty state
 * matches that rendered order exactly and so does this.
 *
 * TWO ROWS ARE DELIBERATELY ABSENT, and this is a deviation from the design.
 *
 *   Radar          the mobile navigation model dismantles it. Its Calls tab
 *                  becomes the Ledger, Following and Watchlist merge into
 *                  Watch, and Desk record keeps its own screen. There is no
 *                  Radar destination left to send a phone to.
 *   Thesis Tracker demoted in production before this programme started.
 *                  `RadarTabs.tsx` calls it an auxiliary workspace rendered as
 *                  a quiet suffix, and `/radar/theses` is a redirect shim
 *                  whose own header says it is retired as a standalone
 *                  destination. Drawing it here as a first-class row would
 *                  reinstate a surface the product demoted.
 *
 * Every href below resolves to a route that exists on this branch. FIVE ROWS
 * are not a plain copy of the palette, and they are not the same case: four
 * differ from the palette's href, one differs from the prototype instead.
 *
 * DIFFER FROM THE PALETTE:
 *
 *   Morning Brief  the palette sends this to /morning-brief; the prototype
 *                  fires goLedger. The Ledger IS the mobile morning brief, so
 *                  it goes to /ledger.
 *   Trends         the palette sends this to /trends, which is the desk page.
 *                  This list is only ever tapped on a phone, and /trends at
 *                  390 carries no breakpoint prefixes anywhere in the file and
 *                  does not pass `mobileFullBleed`. /trends-mobile is the
 *                  mobile screen for the same table, is live on `main`, and is
 *                  in the Ask pole's `owns` list, so the pole still lights.
 *                  The desk page keeps its route; it is simply not where a
 *                  phone reader should be dropped.
 *   Watchlist      the palette sends this to /radar/watchlist, the desk. The
 *                  mobile watchlist is /watch/watchlist, which is where the
 *                  desk route now sends a phone anyway. IT IS NOT /watch. PR
 *                  #790 split mobile Radar into four sections and the bare
 *                  path kept Following, so /watch would land a reader who
 *                  asked for their watchlist on the wrong section.
 *   Company Intel  the palette sends this to /company, the desk directory,
 *                  which draws no mobile treatment. /ask is the twin.
 *
 * THE LAST TWO ARE NOT DECORATION. `src/components/mobile/desk-redirect.tsx`
 * now sends both desk routes to exactly these twins below `md`, so a row left
 * pointing at the desk would still arrive, by way of a redirect it did not need
 * to spend a navigation on. Pointing straight at the twin costs one hop less
 * and keeps this table honest about where a phone reader ends up.
 *
 * DIFFERS FROM THE PROTOTYPE, AND KEEPS THE PALETTE'S HREF:
 *
 *   Tracked Views  the prototype fires goRecord, which is the Desk record
 *                  screen. That screen is not built, so this keeps the
 *                  palette's live href rather than aiming at a 404. Against
 *                  `command-palette.tsx` this row is character-identical
 *                  (/radar/calls?views=open); it is listed here because it is
 *                  a deviation from the design, not from the palette.
 *
 *                  IT IS DELIBERATELY NOT REPOINTED at /watch/calls, which
 *                  exists and is the mobile section for the same rows. The
 *                  href carries `?views=open`, and `src/app/watch/calls/page.tsx`
 *                  takes no searchParams, so the swap would silently drop the
 *                  filter this row is named after. /radar/calls is also not one
 *                  of the six routes `desk-redirect.tsx` sends anywhere, so
 *                  nothing about this row loops. Left alone on purpose.
 */

export type JumpRow = { label: string; href: string };
export type JumpGroup = { eyebrow: string; rows: JumpRow[] };

export const JUMP_GROUPS: JumpGroup[] = [
  {
    eyebrow: "PAGES",
    rows: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Morning Brief", href: "/ledger" },
      { label: "Evening Wrap", href: "/evening-wrap" },
      { label: "Live Feed", href: "/live-feed" },
      { label: "Settings", href: "/settings/profile" },
    ],
  },
  {
    eyebrow: "RESEARCH",
    rows: [
      { label: "Tracked Views", href: "/radar/calls?views=open" },
      { label: "Deal Flow", href: "/deal-flow" },
      { label: "Watchlist", href: "/watch/watchlist" },
      { label: "Trends", href: "/trends-mobile" },
      { label: "Company Intel", href: "/ask" },
    ],
  },
];

/* ── The entity results ───────────────────────────────────────────────── */

export type CompanyResult = {
  id: string;
  ticker: string;
  name: string;
  /** Sector, then this reader's own relation to the name. Never a rate. */
  detail: string;
  href: string;
};

export type LedgerResult = {
  id: string;
  state: OutcomeState;
  /** Already formatted. A date the entry carries, never a clock read here. */
  date: string;
  claim: string;
  href: string;
};

export type DealResult = {
  id: string;
  name: string;
  /** Stage, size, and the date the process runs to. */
  detail: string;
};

export type SearchFixture = {
  companies: CompanyResult[];
  ledger: LedgerResult[];
  deals: DealResult[];
};

/**
 * Fixture matching. The prototype hardcodes a prefix regex over one name; this
 * matches the query against the objects that are actually in the fixture, so
 * the three query states are reached by typing rather than by a switch.
 *
 * Prefix on the ticker, substring on everything else. Case-insensitive.
 */
export function matchFixture(query: string, data: SearchFixture): SearchFixture {
  const q = query.trim().toLowerCase();
  if (!q) return { companies: [], ledger: [], deals: [] };
  const hit = (haystack: string) => haystack.toLowerCase().includes(q);
  const companies = data.companies.filter(
    (c) => c.ticker.toLowerCase().startsWith(q) || hit(c.name),
  );
  // A ledger entry surfaces when the query names the company the entry is
  // ABOUT, which is what makes one keystroke fill three groups at once. Tested
  // against the companies that actually matched, never against "some company
  // matched": YOUR LEDGER is a first-person claim that the reader wrote this
  // about the name they typed, and `cep` must not answer with a claim about
  // CEG. A ticker query reaches the entry through the matched company's name,
  // so `ceg` still surfaces it.
  const about = (text: string) =>
    hit(text) || companies.some((c) => text.toLowerCase().includes(c.name.toLowerCase()));
  return {
    companies,
    ledger: data.ledger.filter((l) => about(l.claim)),
    // DEALS is deliberately looser, and it is the design's own behaviour: the
    // prototype answers every match with the same four objects, so the drawn
    // state for `constellation` carries a deal that names no company in it.
    // A deal row asserts nothing about the reader, so a loose match here is a
    // weak suggestion rather than a false attribution.
    deals: data.deals.filter((d) => companies.length > 0 || hit(d.name)),
  };
}

export function isEmptyResult(r: SearchFixture): boolean {
  return r.companies.length === 0 && r.ledger.length === 0 && r.deals.length === 0;
}
