import type { DealStage } from "./deal-stage";

/**
 * The four deals the design draws, and the chip counts it draws beside them.
 *
 * THIS IS INVENTED DATA ABOUT REAL COMPANIES. `/deal-flow` serves live
 * `deal_flow` rows today, so a fixture that reached production would show
 * transactions that did not happen, attributed by name. It is gated at the one
 * call site in `src/app/deal-flow/page.tsx` and the gate fails closed.
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

export interface MobileDeal {
  id: string;
  stage: DealStage;
  /** The figure on the stage baseline. `deal_flow.valuation` in production. */
  figure: string | null;
  /** The Playfair line. The whole card's headline and its only tap target. */
  claim: string;
  /** One line of prose under the claim. `deal_flow.thesis` in production. */
  rationale: string;
  /** The monospace slug. Already in the case it renders in. */
  slug: string;
}

export const DEALS_FIXTURE: MobileDeal[] = [
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
export const DEALS_FIXTURE_COUNTS: Record<string, number> = {
  all: 61,
  rumored: 16,
  announced: 22,
  under_loi: 14,
  closed: 9,
};

/**
 * Fails closed. Anything other than a local dev run or a Vercel preview
 * deployment gets the real table, whatever else is true of the request.
 */
export function fixtureAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"
  );
}
