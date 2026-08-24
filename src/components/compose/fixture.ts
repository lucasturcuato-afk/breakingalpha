import {
  DEFAULT_ADOPT_HORIZON,
  HORIZON_TYPES,
  resolveAdoptWindow,
  type HorizonType,
} from "@/lib/call-horizons";

/**
 * Sample content for Compose.
 *
 * This screen never reaches the network in this unit. `/api/radar/claims/author`
 * produces its proposal through Gemini and `/api/radar/claims` POST is the
 * authored insert; neither is called here, so the proposal below IS the shape a
 * real loader has to satisfy. It carries every field of `AuthorProposal` in
 * `src/app/api/radar/claims/author/route.ts` that this screen renders or
 * branches on. `evidence_entities` and `confidence_in_reduction` are the two
 * the route sets and this screen does not read, so they are left out rather
 * than invented.
 *
 * Compliance note on sample content: nothing here is a rate or an aggregate
 * figure. The only numbers are one character count and four calendar dates.
 */

/**
 * The session date every window on this screen is measured from.
 *
 * A fixed anchor, never a clock. The Ledger unit set the same precedent: a
 * screen with no loader must not read the wall clock, or its own captures stop
 * matching themselves a day later. 2026-08-06 is the date PR #643 quotes on the
 * Review screen for the same draft.
 */
export const COMPOSE_ANCHOR_ISO = "2026-08-06";

/** The claim routes cap a claim at 400 characters. Mirrored, not guessed. */
export const MAX_CLAIM_CHARS = 400;

/**
 * The note cap proposed in PR #643 (`parseCommitNote`, 2000 characters).
 * Mirrored here so the field cannot accept text the column would refuse.
 */
export const MAX_NOTE_CHARS = 2000;

/** Characters of draft before the claim box reads as a claim. Design value. */
export const DRAFT_MIN_CHARS = 24;

/** Characters of note before the commit control unlocks. Design value. */
export const NOTE_MIN_CHARS = 12;

export type Direction = "bullish" | "bearish" | "neutral";

/**
 * The lifecycle states Compose can be in.
 *
 * Lives here rather than beside the component because the route reads it, and
 * a value exported from a "use client" module arrives on the server as a
 * client reference rather than as the array itself.
 */
export type ComposeStage =
  | "empty"
  | "analyzing"
  | "gradeable"
  | "context"
  | "analyze-error"
  | "saving"
  | "save-error"
  | "committed"
  | "committed-context";

export const COMPOSE_STAGES: ComposeStage[] = [
  "empty",
  "analyzing",
  "gradeable",
  "context",
  "analyze-error",
  "saving",
  "save-error",
  "committed",
  "committed-context",
];

export interface ComposeAlternative {
  claim_type: string;
  target_symbol: string;
  expected_direction: Direction;
  resolution_window_start: string;
  resolution_window_end: string;
  rationale: string;
}

export interface ComposeProposal {
  claim_type: string;
  target_symbol: string | null;
  expected_direction: Direction | null;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
  gradeable: boolean;
  gradeability_note: string | null;
  gradeable_alternative: ComposeAlternative | null;
}

/**
 * The horizons Compose offers.
 *
 * `session` is dropped because `/api/radar/claims` POST line 169 requires
 * `windowEnd > todayIso`, so a same-day window is refused by the server that
 * would have to grade it. Every other member of HORIZON_TYPES is offered,
 * including `week`, which is DEFAULT_ADOPT_HORIZON. See the PR body.
 */
export const COMPOSE_HORIZONS: HorizonType[] = HORIZON_TYPES.filter(
  (t) => t !== "session",
);

export const COMPOSE_DEFAULT_HORIZON: HorizonType = DEFAULT_ADOPT_HORIZON;

/** The settlement date for one horizon, derived rather than transcribed. */
export function settlementDate(horizon: HorizonType): string {
  return resolveAdoptWindow(COMPOSE_ANCHOR_ISO, horizon);
}

/** ISO date as the screen states it. Fixed locale so a capture is stable. */
export function longDate(iso: string): string {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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
  resolution_window_end: settlementDate(COMPOSE_DEFAULT_HORIZON),
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
    resolution_window_end: settlementDate("month"),
    rationale:
      "The regulated book the claim names is the utilities sector, so utilities against the market over a month is the closest priceable reading of it.",
  },
};
