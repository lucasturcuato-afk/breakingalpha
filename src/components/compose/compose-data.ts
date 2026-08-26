import {
  DEFAULT_ADOPT_HORIZON,
  HORIZON_TYPES,
  resolveAdoptWindow,
  type HorizonType,
} from "@/lib/call-horizons";

/**
 * Compose's SHAPE, its caps, its horizons and its date helpers. No content.
 *
 * Split out of `./fixture` so the client component can reach all of this
 * without pulling the sample draft, the sample note and the two invented
 * proposals into the browser bundle. A `"use client"` module that value-imports
 * from `./fixture` downloads every string in it: the gate stops the render, not
 * the download, so the invented NVDA proposal reached `.next/static` even on a
 * production build where `?stage=` cannot select it.
 *
 * Nothing in this file states a fact about a market or a reader. The only
 * numbers are two character caps, two design minimums and one fixed anchor
 * date. That is the property that makes it safe on both sides of the boundary,
 * and it is the property to check before adding anything to it.
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

/** What the composer opens on: a draft, a note and a proposal. */
export interface ComposeSeed {
  draft: string;
  note: string;
  proposal: ComposeProposal | null;
}

/**
 * A composer that has been given nothing. Two blank fields and no proposal,
 * which is what a real composer opens on and what production draws.
 *
 * Content-free on purpose. It is not a spread of anything in `./fixture` and
 * it asserts nothing: no claim, no instrument, no window, no note. This is the
 * value the screen falls to when the gate is shut, so it is the one constant
 * here that must never grow a sentence.
 */
export const EMPTY_SEED: ComposeSeed = { draft: "", note: "", proposal: null };
