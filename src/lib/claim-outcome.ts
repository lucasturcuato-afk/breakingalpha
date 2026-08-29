/**
 * claim-outcome.ts - which outcome row is a user claim's verdict.
 *
 * One rule, for both sources: a claim's verdict is its OWN user_claim_outcomes
 * row, keyed on the claim id. Nothing else.
 *
 * Adopted claims used to read through adopted_from_call_id to the originating
 * brief call's morning_brief_call_outcomes row. That made sense when adopting
 * was a bookmark, but an adopted claim now carries its own forward window (the
 * user picks the horizon) and is graded independently by
 * backend/grading/grade_user_claims.py over that window. Borrowing the brief's
 * verdict answers a different question than the one the user asked, and in the
 * live data it was strictly wrong: an adopted claim whose window had not even
 * closed yet was rendering the brief call's same-session verdict from weeks
 * earlier.
 *
 * The inheritance is prevented structurally, not by discipline: resolveClaimOutcome
 * never receives the brief-call outcomes map, so it cannot read one. If a claim
 * has no own outcome row it is simply not resolved yet, and the caller renders
 * it open. No verdict is ever substituted or fabricated.
 *
 * adopted_from_call_id remains on the claim for provenance and linking. It is
 * just never a verdict source.
 */

/** The outcome shape both tables share (see sql/0012: user_claim_outcomes is a mirror). */
export interface ClaimOutcomeRow {
  claim_id?: string;
  call_id?: string;
  verdict?: string | null;
  attribution?: string | null;
  actual_pct_change?: number | null;
  actual_direction?: string | null;
  verdict_notes?: string | null;
  graded_at?: string | null;
  metadata?: unknown;
}

/** The subset of a user_claims row this resolution needs. */
export interface ClaimLike {
  id: string;
  source?: string | null;
  adopted_from_call_id?: string | null;
  /**
   * REQUIRED, and deliberately not optional and not defaulted.
   *
   * `user_claims.gradeable` is `boolean NOT NULL DEFAULT false` (sql/0012), so
   * every row that exists carries one. Making it optional here, or reading it
   * through a `??`, would let a caller that forgot to select the column look
   * exactly like a caller whose claim IS gradeable, which is the shape of the
   * defect this field exists to close. A caller that cannot supply it is a
   * caller that has not read the row yet.
   */
  gradeable: boolean;
}

/**
 * The claim's own outcome, or null when it has none.
 *
 * Deliberately takes ONLY the own-outcome map. There is no parameter through
 * which a brief-call verdict could arrive, so no future edit can reintroduce
 * the inheritance without changing this signature.
 *
 * `call_id` is normalized onto the returned row because the ScoredObject
 * mappers key on it; it is set to the CLAIM's id, never the brief call's.
 */
export function resolveClaimOutcome(
  claim: ClaimLike,
  ownOutcomes: Record<string, ClaimOutcomeRow | undefined>,
): (ClaimOutcomeRow & { call_id: string }) | null {
  const own = ownOutcomes[claim.id];
  if (!own) return null;
  return { ...own, call_id: own.claim_id ?? claim.id };
}

/**
 * Is this claim still awaiting its own verdict?
 *
 * True for a GRADEABLE claim with no own outcome row, including legacy adopted
 * claims created before independent grading existed. Those will never receive
 * one (the grader is live-forward and does not backfill), so they read as
 * unresolved permanently. That is the honest state: the user's claim, over the
 * user's window, was never graded. Showing the brief's verdict instead would be
 * asserting a result nobody produced for that claim.
 *
 * FALSE for a context claim, and that is the fix. A `gradeable: false` row is
 * written with `resolution_method.method = "none"`, and the grader gates twice
 * on the other value: `fetch_due_claims` filters `.eq("gradeable", True)` and
 * `is_price_gradeable` requires `method == "price_attribution"`. Nothing else
 * in the pipeline writes `user_claims.status` after insert. So there is no
 * verdict on the way and no process that will ever produce one, and calling
 * that "awaiting" told the reader to wait for something that is not coming.
 * A row whose window closed 57 days ago sat under copy reading "Claims still
 * inside their window are awaiting a grade."
 *
 * A context claim is not awaiting, and it is not any of the four outcome
 * states either. Its own category belongs OUTSIDE that set; see
 * `buildYourRecord` in your-record.ts, which is where it is counted.
 *
 * The claim's status is not consulted and is not written anywhere by this
 * change. `gradeable: false` + `method: "none"` + `status: "open"` already
 * describes reality accurately; the read side was the part that was wrong.
 */
export function isAwaitingOwnVerdict(
  claim: ClaimLike,
  ownOutcomes: Record<string, ClaimOutcomeRow | undefined>,
): boolean {
  if (!claim.gradeable) return false;
  return !ownOutcomes[claim.id];
}
