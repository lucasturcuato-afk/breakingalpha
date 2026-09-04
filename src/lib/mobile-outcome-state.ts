import type { ScoredState } from "@/components/scored-object/ScoredObject";
import type { OutcomeState } from "@/components/ledger/claim-anatomy";
import { RESOLUTION_BY_STATE, type Resolution } from "./verdict-vocabulary.ts";

/**
 * mobile-outcome-state - the bridge from the scored-object state a call carries
 * to the four words a mobile surface may render.
 *
 * WHY A BRIDGE AND NOT A SECOND TABLE. The judgement about a call is made in
 * exactly one place, `RESOLUTION_BY_STATE`, and nothing here re-derives it: a
 * verdict row is read by `scoredCallProps` or `claimCardProps`, those produce a
 * `ScoredState`, and that maps to a `Resolution` through the shared table. This
 * module only decides which WORD a phone puts on the resolution it was handed.
 *
 * THE WORD DIFFERS BETWEEN THE TWO SURFACES AND THAT IS DELIBERATE, not drift.
 * `VERDICT_WORD` renders `noCleanRead` as "No clean read", which is the desk's
 * phrasing and reads well beside a desktop card's benchmark detail. The mobile
 * outcome vocabulary is CLOSED at four words, supported / challenged /
 * developing / awaiting, and `OUTCOME_STATES` in `claim-anatomy.tsx` fixes the
 * set so a fifth cannot be added without that file changing. "No clean read" is
 * a fifth word. So on a phone a confounded call reads Developing, which is not
 * a decision taken here for the first time: `deskRecordToScreenData` already
 * maps `noCleanRead` to `developing` for the mobile record, and the mobile
 * record's own count strip already labels that bucket Developing. This module
 * is those two lines of agreement written once and given a name, so Radar's
 * Calls section and Radar's Desk record section cannot come to call the same
 * bucket two different things.
 *
 * `notGraded` HAS NO WORD, AND THAT IS THE POINT. It gives back null. There is
 * no honest member of a four-word set for it: Awaiting means a call still
 * inside its window, and a not-graded call is one where no credible grade
 * exists and never will. Labelling it Awaiting tells a reader a verdict is
 * coming for a call that can never get one. `deskRecordToScreenData` reaches
 * the same conclusion and drops those rows from the record's list; the Calls
 * section cannot drop them, because they are the reader's OWN claims, so it
 * renders them with their honest reason and no state word instead.
 *
 * Pure. No React, no DOM, no fetch. Both imports are type-only, so this module
 * has no runtime dependency on either component that owns a vocabulary.
 */

const WORD_BY_RESOLUTION: Record<Resolution, OutcomeState | null> = {
  supported: "supported",
  challenged: "challenged",
  /* Confounded, or under the attribution bar. Never counted as supported. */
  noCleanRead: "developing",
  /* No credible grade exists and none is coming. See the header. */
  notGraded: null,
};

/**
 * The mobile outcome word for a scored state, or null when the honest answer is
 * that there is no verdict and there will not be one.
 *
 * `open` is the one state that does not travel through the resolution table.
 * `RESOLUTION_BY_STATE` maps it to `notGraded` to stay exhaustive, with its own
 * comment saying a row with an outcome never maps to open. On this surface open
 * is the common case rather than an impossibility: a call inside its window has
 * no outcome row yet, and the word for that is Awaiting.
 */
export function mobileOutcomeState(state: ScoredState): OutcomeState | null {
  if (state === "open") return "awaiting";
  return WORD_BY_RESOLUTION[RESOLUTION_BY_STATE[state]];
}
