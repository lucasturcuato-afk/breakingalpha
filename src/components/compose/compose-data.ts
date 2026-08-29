import {
  DEFAULT_ADOPT_HORIZON,
  HORIZON_TYPES,
  resolveAdoptWindow,
  type HorizonType,
} from "@/lib/call-horizons";
import { COMMIT_NOTE_MAX, COMMIT_NOTE_MIN } from "@/components/commit/commit-target";

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
 * The anchor the FIXTURE's two sample proposals are dated from.
 *
 * FIXTURE ONLY. It used to be the anchor every window on this screen was
 * measured from, and that was safe exactly as long as the screen wrote
 * nothing. It is not safe now. `/api/radar/claims` POST requires
 * `resolution_window_end > todayIso`, so a wired screen resolving its window
 * off a date in the past sends a window that has already closed, and every
 * write comes back `gradeable: false` while looking to the reader as though it
 * worked. The live window is resolved from `sessionIso`, a required prop the
 * server page supplies from `todayPt()`, the same way `src/lib/ledger-data.ts`
 * supplies it to /ledger and `commit-target.ts` documents for the sheet.
 *
 * What survives of the original argument: a sample proposal must not read the
 * wall clock, or `src/components/compose/fixture.ts` stops matching itself a
 * day later. 2026-08-06 is the date PR #643 quotes on the Review screen for
 * the same draft.
 */
export const COMPOSE_ANCHOR_ISO = "2026-08-06";

/** The claim routes cap a claim at 400 characters. Mirrored, not guessed. */
export const MAX_CLAIM_CHARS = 400;

/**
 * The note's floor and ceiling, RE-EXPORTED rather than restated.
 *
 * Both numbers live in `@/components/commit/commit-target`, which is pure and
 * imports nothing, so a client screen and a server route can each reach them
 * without reaching each other. They were literals here, and a second copy of
 * either is how a field starts disagreeing with the column behind it: the
 * ceiling is what `readCommitNote` slices at in both write routes, and the
 * floor is what the commit sheet unlocks on. One ruling, one module.
 */
export const MAX_NOTE_CHARS = COMMIT_NOTE_MAX;

/** Characters of draft before the claim box reads as a claim. Design value. */
export const DRAFT_MIN_CHARS = 24;

/** Characters of note before the commit control unlocks. See above. */
export const NOTE_MIN_CHARS = COMMIT_NOTE_MIN;

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

/**
 * A read-back, as the screen keeps it.
 *
 * CARRIES TWO FIELDS THE SCREEN NEVER RENDERS, and that is deliberate.
 * `evidence_entities` and `confidence_in_reduction` are produced by
 * `/api/radar/claims/author` and accepted by the `/api/radar/claims` insert,
 * and while this was a presentation unit they were left out of this type on
 * the grounds that nothing drew them. The moment the screen writes, dropping
 * them stops being tidiness and becomes data loss: every authored claim would
 * store an empty array and a null for values the model actually produced.
 * So they are carried and forwarded, and still not rendered.
 */
export interface ComposeProposal {
  claim_type: string;
  target_symbol: string | null;
  expected_direction: Direction | null;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
  /** Entities the claim references. Carried through the write, never drawn. */
  evidence_entities: string[];
  /**
   * The model's confidence that its REDUCTION is faithful, 0 to 1, or null.
   * Never a probability of the call being right and never rendered as one.
   * Carried through the write so the stored row keeps what the route produced.
   */
  confidence_in_reduction: number | null;
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

/**
 * The settlement date for one horizon, derived rather than transcribed.
 *
 * THE ANCHOR IS A PARAMETER, not a module constant, and it has to be. This
 * used to close over `COMPOSE_ANCHOR_ISO`, which meant the date the screen
 * showed a reader and the date a write would have resolved to were the same
 * fixed day in the past. The live screen passes its `sessionIso`; the fixture
 * passes `COMPOSE_ANCHOR_ISO`. Both callers say which day they mean.
 */
export function settlementDate(anchorIso: string, horizon: HorizonType): string {
  return resolveAdoptWindow(anchorIso, horizon);
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
