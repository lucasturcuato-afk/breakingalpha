import type { TrendSignal } from "@/lib/trend-signals";

/**
 * The three clusters the prototype draws at `:2140`, `:2159` and `:2177`, as
 * rows rather than as markup.
 *
 * Every visible figure on this screen is derived from these rows by
 * `trendCounts`, `strengthToLevel`, `timeAgo` and `trendTags`. Nothing is
 * typed into the card. That is the point of shipping the design's copy as data
 * instead of as JSX: the parity run then compares the same derivations
 * production uses, not a second set of literals that happen to agree.
 *
 * NEVER REACHABLE IN PRODUCTION. The gate below fails closed: anything that is
 * not a development build or an explicit Vercel preview gets the live loader
 * and its loading state, never these strings. `/trends` is publicly reachable
 * signed out, and while `/trends-mobile` is gated in production today, an
 * ungated fixture on a sibling route would be three invented themes served to
 * anyone who reached it.
 */
export const FIXTURE_ALLOWED =
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "test" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

/**
 * Offsets, not timestamps. The card renders "2h ago" through the same
 * `timeAgo` the live loader uses, so a fixed date would make the fixture read
 * older every day the branch sits. Each offset sits at the middle of its
 * bucket so the server render and the hydration render cannot land either side
 * of a boundary.
 */
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
    ageMs: 30 * HOUR,
  },
];

export function trendsFixture(now: number): TrendSignal[] {
  return ROWS.map(({ ageMs, ...row }) => ({
    ...row,
    created_at: new Date(now - ageMs).toISOString(),
  }));
}

/**
 * The same three clusters, aged past the freshness floor, so the stale notice
 * can be reached and audited. The design draws no stale treatment for Trends,
 * so the notice states the measured age and makes no claim about the tape.
 */
export function trendsStaleFixture(now: number): TrendSignal[] {
  return ROWS.map(({ ageMs, ...row }) => ({
    ...row,
    created_at: new Date(now - ageMs - 72 * HOUR).toISOString(),
  }));
}
