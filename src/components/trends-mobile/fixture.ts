import type { TrendSignal } from "@/lib/trend-signals";

/**
 * The three clusters the prototype draws at `:2140`, `:2159` and `:2177`, as
 * rows rather than as markup.
 *
 * Every visible figure on this screen is derived from these rows by
 * `trendCounts`, `strengthToLevel`, `timeAgo` and `trendTags`. Nothing is typed
 * into the card. That is the point of shipping the design's copy as data
 * instead of as JSX: the parity run then compares the same derivations
 * production uses, not a second set of literals that happen to agree.
 *
 * SERVER ONLY. This module is imported by `src/app/trends-mobile/page.tsx` and
 * by the unit tests, and by nothing else. `trends-screen.tsx` carries
 * "use client" and must never import it, or every string below would be
 * readable in a public production chunk by anyone who opened the bundle, gated
 * or not. An earlier revision did exactly that: the invented cluster prose
 * shipped inside a production client chunk, unreachable on screen and plainly
 * readable in the asset. The gate stopped it rendering; it could not stop it
 * shipping.
 *
 * The gate lives in `./fixture-gate` for that reason, so a client component can
 * re-check it without pulling this file across the boundary. The page evaluates
 * the same gate before calling either builder below, so on a production build
 * these functions are never called and this module is never in the graph.
 */

/**
 * The session the fixture is measured from. A FIXED anchor, never a clock.
 *
 * `/compose` (PR #650) and `/ledger` set this precedent and the same reasoning
 * applies: a screen rendering sample rows must not read the wall clock, or its own
 * captures stop matching themselves a day later. It also removes a hydration
 * mismatch outright. An earlier revision seeded the clock with
 * `useState(() => Date.now())` inside a client component that this server page
 * renders, so the initialiser ran once on the server and again on hydration and
 * the two landed on different milliseconds. There is no version of a live clock
 * that is safe on both sides of that boundary, so the fixture path does not use
 * one. The live path reads the real clock in the effect that fetches the rows,
 * which is not render and cannot mismatch.
 *
 * The offsets below are relative to this anchor, and each sits at the middle of
 * its bucket, so the three cards read "2h ago", "6h ago" and "1d ago" for good.
 */
export const TRENDS_ANCHOR_ISO = "2026-08-20T12:00:00.000Z";
export const TRENDS_ANCHOR_MS = Date.parse(TRENDS_ANCHOR_ISO);

const HOUR = 3600000;

interface FixtureRow extends Omit<TrendSignal, "created_at"> {
  ageMs: number;
}

const ROWS: FixtureRow[] = [
  {
    id: "fixture-grid-capacity",
    label: "Grid capacity",
    headline:
      "Grid capacity contracting accelerates across four utilities in eleven days",
    tagline:
      "Nine filings and 41 articles in eleven days describe fixed-price supply agreements between merchant generators and data centre operators.",
    article_count: 41,
    source_count: 9,
    strength_score: 0.86,
    top_sectors: ["Utilities"],
    top_themes: ["Capacity", "Emerging"],
    top_companies: ["Constellation Energy", "Vistra"],
    ageMs: 2.5 * HOUR,
  },
  {
    id: "fixture-glp1-supply",
    label: "GLP-1 supply",
    headline: "GLP-1 supply constraints ease as three plants clear qualification",
    tagline:
      "Capacity language shifted from supply-constrained to volume-led across six transcripts this quarter.",
    article_count: 23,
    source_count: 6,
    strength_score: 0.68,
    top_sectors: ["Healthcare"],
    top_themes: ["Recurring"],
    top_companies: ["Eli Lilly"],
    ageMs: 6.5 * HOUR,
  },
  {
    id: "fixture-private-credit",
    label: "Private credit spreads",
    headline: "Private credit spreads compress across three unitranche repricings",
    tagline:
      "Three of the largest direct lenders repriced paper inside 500 over base within the same fortnight.",
    article_count: 17,
    source_count: 5,
    strength_score: 0.45,
    top_sectors: ["Financials"],
    top_themes: ["Credit"],
    top_companies: ["Ares Management"],
    ageMs: 30 * HOUR,
  },
];

export function trendsFixture(): TrendSignal[] {
  return ROWS.map(({ ageMs, ...row }) => ({
    ...row,
    created_at: new Date(TRENDS_ANCHOR_MS - ageMs).toISOString(),
  }));
}

/**
 * The same three clusters, aged past the freshness floor, so the stale notice
 * can be reached and audited. The design draws no stale treatment for Trends,
 * so the notice states the measured age and makes no claim about the tape.
 */
export function trendsStaleFixture(): TrendSignal[] {
  return ROWS.map(({ ageMs, ...row }) => ({
    ...row,
    created_at: new Date(TRENDS_ANCHOR_MS - ageMs - 72 * HOUR).toISOString(),
  }));
}
