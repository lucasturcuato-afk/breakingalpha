/**
 * claim-card - the ScoredObject props for ONE of the reader's own claims.
 *
 * Lifted out of src/app/radar/calls/page.tsx so the decision it makes is
 * testable without a browser. The decision is small and was wrong in a way
 * nobody could see from the screen: an ADOPTED context claim fell past a
 * `source === "authored"` guard and rendered the open card, which reads
 * "Resolves when the window closes, against the market close." about a claim
 * no grader will ever look at.
 *
 * The guard looked defensible while the adopt route stamped
 * `method: "price_attribution"` on every row it wrote, gradeable or not. It is
 * not defensible: gradeability is decided by the same server-side rules on both
 * write paths, and backend/grading/grade_user_claims.py gates on the flag and
 * the method, never on the source.
 *
 * Pure: no fetch, no React, no DOM.
 */

import { scoredCallProps, type CallOutcomeRow } from "./scored-object-map.ts";
import type { ScoredObjectProps } from "@/components/scored-object/ScoredObject";

/** The subset of a user_claims row a card is drawn from. */
export interface ClaimCardInput {
  user_claim: string;
  claim_type: string | null;
  target_symbol: string | null;
  created_at: string | null;
  resolution_window_end: string | null;
  /** Required, never defaulted. See ClaimLike in claim-outcome.ts. */
  gradeable: boolean;
  gradeability_note: string | null;
}

/** Fallback reason when a context row carries no note of its own. */
export const CONTEXT_ONLY_REASON = "Tracked as context only.";

/**
 * The card for a claim, given its own outcome row or null.
 *
 * A claim with an outcome renders that outcome, whatever the flag says: a
 * verdict that exists is never hidden. A claim with no outcome and
 * `gradeable: false` renders the honest absence, because nothing will ever
 * grade it. Everything else is the ordinary open card.
 */
export function claimCardProps(
  c: ClaimCardInput,
  outcome: CallOutcomeRow | null,
  todayIso: string,
): ScoredObjectProps {
  const props = scoredCallProps(
    {
      claim_text: c.user_claim,
      target_symbol: c.target_symbol,
      claim_type: c.claim_type,
      created_at: c.created_at,
      // The window's CLOSE is what tells a live card from a closed one.
      brief_date: c.resolution_window_end ?? c.created_at?.slice(0, 10) ?? null,
    },
    outcome,
    todayIso,
  );
  if (outcome || c.gradeable) return props;
  return {
    ...props,
    state: "notGraded",
    // Cleared for the same reason scored-object-map clears it on every
    // notGraded path: nothing resolves this, so there is no basis to name.
    resolvesSource: undefined,
    resolvesWhen: undefined,
    notGradedReason: c.gradeability_note ?? CONTEXT_ONLY_REASON,
  };
}
