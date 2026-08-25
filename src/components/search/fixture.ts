import type { SearchFixture } from "./search-data";

/**
 * The Search result fixture. SERVER ONLY.
 *
 * NOTHING IN THIS FILE MAY BE IMPORTED BY A CLIENT COMPONENT. The gate in
 * `./fixture-gate` is a runtime constant, so it stops the render and not the
 * download: every string below reaches `.next/static` the moment a
 * `"use client"` module imports this path, whether or not it can ever paint.
 * One of those strings is a first-person claim, "you have 2 entries on this
 * name", about a reader who has no entries at all.
 *
 * `src/app/search/page.tsx` is a server component, resolves the gate there and
 * passes this down as a required prop. The screen matches against what it was
 * handed. The shape, the jump list and the matcher live in `./search-data`,
 * which carries no invented content and is safe to import anywhere.
 */

/**
 * The design's own result set, transcribed. The prototype resolves it from a
 * prefix test on "constellation" or "ceg", answering every match with the same
 * four objects, which is why the second company is a near-miss on the first.
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
