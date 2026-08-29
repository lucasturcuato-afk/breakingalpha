/**
 * Sample content for Compose. SERVER ONLY.
 *
 * NOTHING IN THIS FILE MAY BE IMPORTED BY A CLIENT COMPONENT. The gate in
 * `./fixture-gate` is a runtime constant, so it stops the render and not the
 * download: every string below reaches `.next/static` the moment a
 * `"use client"` module imports this path, whether or not `?stage=` can ever
 * select it. `src/app/compose/page.tsx` is a server component, calls
 * `seedFor` here behind the gate, and passes the result down as a required
 * prop. The shape, the caps, the horizons and the date helpers live in
 * `./compose-data`, which carries no content and is safe to import anywhere.
 *
 * The screen now DOES reach the network: `/api/radar/claims/author` produces
 * the real proposal and `/api/radar/claims` POST is the real insert. What is
 * below is the dev and preview SEED, the only way a runtime audit can reach a
 * lifecycle state without a model call and a row, so the proposals here still
 * have to be exactly the shape the author route answers with.
 * `evidence_entities` and `confidence_in_reduction` are on them now: the screen
 * still does not draw either, but it forwards both to the insert, and a seed
 * missing them would be a shape the real path never produces.
 *
 * Compliance note on sample content: nothing here is a rate or an aggregate
 * figure. The only numbers are one character count and four calendar dates.
 */

import {
  COMPOSE_ANCHOR_ISO,
  COMPOSE_DEFAULT_HORIZON,
  settlementDate,
  type ComposeProposal,
  type ComposeSeed,
  type ComposeStage,
  EMPTY_SEED,
} from "./compose-data";
/**
 * A draft that names an instrument the grader can price. The sentence is the
 * placeholder the repo composer already ships, reproduced verbatim in the
 * prototype at line 2417.
 */
export const GRADEABLE_DRAFT =
  "NVDA gives back the ramp hype by earnings";

/**
 * A draft that names no instrument. Taken from PR #643, which quotes it as the
 * note the Review screen reads back, so the two screens carry one example.
 */
export const CONTEXT_DRAFT =
  "Data centre contracting is repricing faster than the regulated book.";

export const SAMPLE_NOTE =
  "If the auction clears high the sector index still carries too much regulated drag to keep pace.";

export const GRADEABLE_PROPOSAL: ComposeProposal = {
  claim_type: "ticker",
  target_symbol: "NVDA",
  expected_direction: "bearish",
  resolution_window_start: COMPOSE_ANCHOR_ISO,
  resolution_window_end: settlementDate(COMPOSE_ANCHOR_ISO, COMPOSE_DEFAULT_HORIZON),
  evidence_entities: ["NVDA"],
  confidence_in_reduction: null,
  gradeable: true,
  gradeability_note: null,
  gradeable_alternative: null,
};

export const CONTEXT_PROPOSAL: ComposeProposal = {
  claim_type: "other",
  target_symbol: null,
  expected_direction: null,
  resolution_window_start: null,
  resolution_window_end: null,
  evidence_entities: [],
  confidence_in_reduction: null,
  gradeable: false,
  gradeability_note: "Not price-gradeable in v1; tracked as context only.",
  /*
   * Authored sample, not a quotation. The prototype draws no alternative at
   * all, and the live one is written by Gemini at request time, so there is no
   * rendered string to copy. The shape is the route's, the words are mine, and
   * the PR body says so.
   */
  gradeable_alternative: {
    claim_type: "sector",
    target_symbol: "XLU",
    expected_direction: "bearish",
    resolution_window_start: COMPOSE_ANCHOR_ISO,
    resolution_window_end: settlementDate(COMPOSE_ANCHOR_ISO, "month"),
    rationale:
      "The regulated book the claim names is the utilities sector, so utilities against the market over a month is the closest priceable reading of it.",
  },
};

/**
 * The draft, the note and the proposal each stage opens on.
 *
 * Called on the SERVER, by `src/app/compose/page.tsx`, behind
 * `COMPOSE_FIXTURE_ENABLED`. It used to live inside the client component,
 * which is what put all five sample strings into the browser bundle.
 */
export function seedFor(stage: ComposeStage): ComposeSeed {
  switch (stage) {
    case "context":
    case "committed-context":
      return { draft: CONTEXT_DRAFT, note: SAMPLE_NOTE, proposal: CONTEXT_PROPOSAL };
    case "gradeable":
    case "saving":
    case "save-error":
    case "committed":
      return { draft: GRADEABLE_DRAFT, note: SAMPLE_NOTE, proposal: GRADEABLE_PROPOSAL };
    /*
     * A read-back is only reachable from `readyToRead`, which requires the
     * note as well as the draft. Seeding these two with an empty note drew a
     * state the real flow cannot produce, and left the analyze error with no
     * retry: the control stayed locked at "Write the claim and your
     * reasoning" over an error telling the user to try again.
     */
    case "analyzing":
    case "analyze-error":
      return { draft: GRADEABLE_DRAFT, note: SAMPLE_NOTE, proposal: null };
    default:
      return EMPTY_SEED;
  }
}
