/**
 * verdict-vocabulary.ts - the ONE mapping from a scored state to the word shown.
 *
 * The vocabulary is observational, never a grade on a person: supported,
 * challenged, no clean read, awaiting. Two reasons it has to be that way.
 *
 * Attribution-based grading cannot support the certainty "wrong" implies. The
 * grader checks whether a move can be told apart from its sector and the
 * market; a direction that did not hold is a claim the evidence challenged, not
 * a person who was wrong. And this same card renders a USER's own claims, where
 * the difference between "the evidence challenged this" and "you were wrong"
 * is the difference between a record someone keeps and a record they abandon.
 *
 * This lived inside desk-record.ts as two module-private constants. The record
 * surface passed the right word explicitly and every other surface fell through
 * to ScoredObject's own Right/Wrong default, so one place was correct and the
 * rest silently were not. Extracting it here means there is nothing left to
 * fall through TO: the component's default and the record's override are now
 * the same table.
 *
 * Pure. No React, no DOM, no fetch. `ScoredState` is a type-only import, so
 * there is no runtime cycle with the component that owns it.
 */

import type { ScoredState } from "@/components/scored-object/ScoredObject";

/**
 * How a call resolved, in observational terms.
 *  supported    - the direction held AND the grader could attribute it
 *  challenged   - the direction did not hold, cleanly attributable
 *  noCleanRead  - the move could not be separated from sector/market, or it
 *                 sat under the attribution bar. Never counted as a hit.
 *  notGraded    - no credible grade exists (ungradable, or a legacy row)
 */
export type Resolution = "supported" | "challenged" | "noCleanRead" | "notGraded";

/** ScoredObject state -> resolution bucket. The mapper owns the decision. */
export const RESOLUTION_BY_STATE: Record<ScoredState, Resolution> = {
  right: "supported",
  wrong: "challenged",
  inconclusive: "noCleanRead",
  notGraded: "notGraded",
  // A row with an outcome never maps to open; kept total for exhaustiveness.
  open: "notGraded",
};

/**
 * The word shown for each resolution.
 *
 * `notGraded` is undefined on purpose: an absence is not a verdict, and the
 * card renders its reason instead of a word.
 */
export const VERDICT_WORD: Record<Resolution, string | undefined> = {
  supported: "Supported",
  challenged: "Challenged",
  noCleanRead: "No clean read",
  notGraded: undefined,
};

/**
 * The two sentences a surface may put under a call that carries no grade.
 *
 * WHY THEY LIVE HERE AND NOT AT EITHER RENDER SITE. There were two literals,
 * both reading "Window closed without a grade.", one in `scored-object-map.ts`
 * and one as a fallback default inside `ScoredObject.tsx`. A grep that found
 * the first and not the second is exactly how a half fix ships looking whole,
 * and the mobile pass did find only the first. This module already exists to be
 * the ONE place a state becomes words, so both sentences are here and both
 * render sites import them.
 *
 * WHY TWO SENTENCES AND NOT ONE. They answer two different questions and only
 * one of them was ever asked.
 *
 * PENDING is the mapper's own branch: no outcome row, and a window that has
 * closed. That row satisfies every condition the grader scans for. The old
 * string described it as a window that closed and produced nothing, which reads
 * as settled, and it is not: the run has not happened. This is the sentence the
 * mobile screens were already writing for themselves, moved to the source so
 * the two surfaces cannot drift and so the desk stops saying the false thing.
 *
 * UNSPECIFIED is the component's fallback, for a caller that gives a notGraded
 * card no reason at all. It must be true on EVERY route to that state, the
 * terminal ones included, so it can assert neither that a grade is coming nor
 * that none ever will. Giving that slot the pending sentence would have moved
 * the falsehood rather than removed it.
 */
export const NOT_GRADED_PENDING_REASON =
  "The window has closed and the grader has not reached this call yet. Nothing has been estimated in the meantime.";

export const NOT_GRADED_UNSPECIFIED_REASON = "No grade has been recorded for this call.";

/**
 * The word for a scored state. This is what the card renders when a caller
 * passes no explicit `verdict`, so the default is correct rather than being
 * something every surface has to remember to override.
 */
export function verdictWordForState(state: ScoredState): string | undefined {
  return VERDICT_WORD[RESOLUTION_BY_STATE[state]];
}
