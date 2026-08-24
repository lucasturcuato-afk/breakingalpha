import "server-only";

import type { DealsFixture, MobileDeal } from "./types";

/**
 * The four deals the design draws, and the chip counts it draws beside them.
 *
 * THIS IS INVENTED DATA ABOUT REAL COMPANIES. `/deal-flow` serves live
 * `deal_flow` rows today, so a fixture that reached a reader would show
 * transactions that did not happen, attributed by name.
 *
 * SERVER ONLY, and the `server-only` import on line 1 is the enforcement
 * rather than a label. A runtime gate was not enough and the first pass of this
 * screen proved it: `fixtureAllowed()` did fail closed at runtime, so no reader
 * ever saw a fabricated deal drawn on the page, but the module was imported by
 * a "use client" file, so every string below was bundled into the client graph
 * and served as a public asset. Measured on a production build of that pass:
 * "Blackstone and TPG weigh a joint take-private of Hologic" and "Electronic
 * Arts' Saudi-backed take-private completes" were readable in three chunks
 * under `.next/static/chunks/`, on the product's own domain, with no session
 * required. A gate that runs after the bytes have already shipped is not a
 * gate.
 *
 * `import "server-only"` makes that a build error instead of a review finding.
 * If anyone reaches for this module from a client component again, the build
 * fails and says so.
 *
 * That mattered more than it looks. `isPublicPath` in `src/proxy.ts` blocks
 * only when there is no user (line 141), so `MOBILE_REDESIGN_DEV_PATHS` never
 * gated production for a signed-in reader: they reach `/deal-flow` today. This
 * gate is the only defence the fixture has.
 *
 * Every string is transcribed from the rendered prototype, lines 2510 to 2544.
 * Parity keys elements on tag plus the first 24 characters of their text, so
 * these have to be the design's own words for the diff to pair anything at all.
 *
 * The chip counts and the row count disagree on purpose: the design writes
 * "All 61" over four drawn rows. That is the prototype's own arithmetic and it
 * is preserved rather than corrected, because correcting it would change the
 * chip labels parity is measuring.
 */

const DEALS_FIXTURE: MobileDeal[] = [
  {
    id: "fixture-rumored",
    stage: "rumored",
    figure: "$4.1B",
    claim: "Sponsors circle Smartsheet again after the last process lapsed.",
    rationale:
      "Two names are said to have revisited the file. Nothing is under exclusivity and no debt has been sounded.",
    slug: "SMAR · SOFTWARE · AUG 5",
  },
  {
    id: "fixture-announced",
    stage: "announced",
    figure: "$9.4B",
    claim: "Xylem agrees to acquire Evoqua's industrial water division.",
    rationale: "All-stock. Antitrust review expected to run into Q1.",
    slug: "XYL · INDUSTRIALS · AUG 3",
  },
  {
    id: "fixture-under-loi",
    stage: "under_loi",
    figure: "$18.3B",
    claim: "Blackstone and TPG weigh a joint take-private of Hologic.",
    rationale:
      "Diagnostics platform with a recurring consumables base. Exclusivity runs to Aug 22.",
    slug: "HOLX · MEDTECH · AUG 4",
  },
  {
    id: "fixture-closed",
    stage: "closed",
    figure: "$55.0B",
    claim: "Electronic Arts' Saudi-backed take-private completes.",
    rationale:
      "The comp every sponsor will cite in interactive entertainment for the next two years.",
    slug: "EA · SOFTWARE · AUG 6",
  },
];

/** The design's chip figures, which its four drawn rows do not add up to. */
const DEALS_FIXTURE_COUNTS: Record<string, number> = {
  all: 61,
  rumored: 16,
  announced: 22,
  under_loi: 14,
  closed: 9,
};

/**
 * Fails closed. Anything other than a local dev run or a Vercel preview
 * deployment gets the real table, whatever else is true of the request. Read on
 * the server, where `process.env` is the deployment's own and not an inlined
 * build-time copy a client bundle carries around.
 */
function fixtureAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"
  );
}

/**
 * The single export, and deliberately the only one.
 *
 * Answering `null` rather than exposing the array plus a boolean means a caller
 * cannot keep the data and still get the gate wrong. There is no arrangement of
 * query parameters or props that produces a fixture in production, because in
 * production this function yields nothing to produce one from.
 */
export function dealsFixture(): DealsFixture | null {
  if (!fixtureAllowed()) return null;
  return { deals: DEALS_FIXTURE, counts: DEALS_FIXTURE_COUNTS };
}
