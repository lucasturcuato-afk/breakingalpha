import type { OutcomeState } from "@/components/ledger/claim-anatomy";

/**
 * Search fixture and the jump list.
 *
 * Two different kinds of data live in this file and they are gated
 * differently on purpose.
 *
 * The jump list is NOT a fixture. Every row is a real destination that exists
 * on this branch today, so it renders in every environment. The entity results
 * below it are invented, and they are gated out of production.
 */

/* ── The production gate ──────────────────────────────────────────────
 *
 * There is no search backend. `GET /api/companies?q=` covers companies only,
 * `/api/company-search` is a Clearbit autocomplete proxy, and nothing in the
 * repo searches a user's own entries or the deal table. Until one route
 * answers all three, the typed state is invented data and must not reach a
 * production reader.
 *
 * Fails closed: anything that is not development and not an explicit preview
 * deploy is treated as production.
 */
export const SEARCH_FIXTURE_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

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
 * Every href below resolves to a route that exists on this branch. Two differ
 * from the palette's own href because the prototype wires them somewhere else,
 * and the prototype is the design:
 *
 *   Morning Brief  the palette sends this to /morning-brief; the prototype
 *                  fires goLedger. The Ledger IS the mobile morning brief, so
 *                  it goes to /ledger.
 *   Tracked Views  the prototype fires goRecord, which is the Desk record
 *                  screen. That screen is not built, so this keeps the
 *                  palette's live href rather than aiming at a 404.
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
      { label: "Watchlist", href: "/radar/watchlist" },
      { label: "Trends", href: "/trends" },
      { label: "Company Intel", href: "/company" },
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
 * The design's own result set, transcribed. The prototype resolves it from a
 * prefix test on "constellation" or "ceg" and returns these four objects for
 * every match, which is why the second company is a near-miss on the first.
 *
 * One thing in here is wrong and is kept anyway: Centrus Energy trades as LEU,
 * not CEP. Changing it would put the build's text out of step with the design
 * on a parity-fingerprinted string for the sake of a fixture nobody trades
 * off. Recorded in the PR body instead.
 */
export const SEARCH_FIXTURE: SearchFixture = {
  companies: [
    {
      id: "ceg",
      ticker: "CEG",
      name: "Constellation Energy",
      detail: "Utilities · you have 2 entries on this name",
      href: "/company",
    },
    {
      id: "cep",
      ticker: "CEP",
      name: "Centrus Energy",
      detail: "Energy · not followed",
      href: "/company",
    },
  ],
  ledger: [
    {
      id: "ledger-ceg",
      state: "challenged",
      date: "AUG 27",
      claim:
        "Constellation Energy trades above the utilities sector index through the next PJM capacity auction result.",
      href: "/ledger",
    },
  ],
  deals: [
    {
      id: "hologic",
      name: "Hologic take-private",
      detail: "Under LOI · $18.3B · exclusivity to Aug 22",
    },
  ],
};

/**
 * Fixture matching. The prototype hardcodes a prefix regex over one name; this
 * matches the query against the objects that are actually in the fixture, so
 * the three query states are reached by typing rather than by a switch.
 *
 * Prefix on the ticker, substring on everything else. Case-insensitive.
 */
export function matchFixture(query: string, data: SearchFixture = SEARCH_FIXTURE): SearchFixture {
  const q = query.trim().toLowerCase();
  if (!q) return { companies: [], ledger: [], deals: [] };
  const hit = (haystack: string) => haystack.toLowerCase().includes(q);
  const companies = data.companies.filter(
    (c) => c.ticker.toLowerCase().startsWith(q) || hit(c.name),
  );
  // A ledger entry or a deal surfaces when the query names a company it is
  // about, which is what makes one keystroke fill three groups at once.
  const named = companies.length > 0;
  return {
    companies,
    ledger: data.ledger.filter((l) => named || hit(l.claim)),
    deals: data.deals.filter((d) => named || hit(d.name)),
  };
}

export function isEmptyResult(r: SearchFixture): boolean {
  return r.companies.length === 0 && r.ledger.length === 0 && r.deals.length === 0;
}
