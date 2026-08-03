/**
 * your-record - the pure model behind the USER's own record of their claims.
 *
 * The desk's record (src/lib/desk-record.ts) and the user's record are two
 * different objects and are never mixed. This module reads only user_claims
 * and their own user_claim_outcomes rows, through resolveClaimOutcome, which
 * by construction cannot see a morning-brief verdict. There is no parameter
 * here through which the desk's numbers could arrive.
 *
 * HONESTY RULES:
 *  - Bucketing goes through RESOLUTION_BY_STATE and scoredCallProps, the same
 *    decision path the desk record uses, so the two can never disagree about
 *    what "supported" means.
 *  - A claim with no own outcome row is AWAITING. It is never counted as
 *    anything else and never borrows a result.
 *  - With zero resolved claims the model says so explicitly (`hasResolved`
 *    is false) so the surface can render an honest empty state instead of a
 *    zeroed scoreboard.
 *  - No aggregate. No hit rate, no ratio, no percentage of any kind is
 *    computed here, because the surface must not be able to render one.
 *
 * COMPLIANCE: observational vocabulary only (supported, challenged, no clean
 * read, awaiting). Asserted by tests/unit/dashboard-honesty.test.ts.
 */

import {
  RESOLUTION_BY_STATE,
  DESK_RECORD_COPY,
  type Resolution,
} from "./desk-record.ts";
import { resolveClaimOutcome, type ClaimLike, type ClaimOutcomeRow } from "./claim-outcome.ts";
import { scoredCallProps, type CallOutcomeRow } from "./scored-object-map.ts";

/** The subset of a user_claims row this model needs. */
export interface UserClaimLike extends ClaimLike {
  user_claim: string;
  claim_type?: string | null;
  target_symbol?: string | null;
  created_at?: string | null;
  status?: string | null;
}

export interface YourRecord {
  /** Live claims the user holds (archived already filtered by the caller). */
  totalClaims: number;
  /** Claims with their OWN outcome row, whatever it said. */
  resolved: number;
  /** Claims with no own outcome row yet. */
  awaiting: number;
  /** Bucket counts over resolved claims only. Sums to `resolved`. */
  byResolution: Record<Resolution, number>;
  /** False when nothing of the user's has ever been graded. */
  hasResolved: boolean;
}

const EMPTY: Record<Resolution, number> = {
  supported: 0,
  challenged: 0,
  noCleanRead: 0,
  notGraded: 0,
};

/**
 * Copy the personal record surface authors. Kept beside the model so the
 * compliance test can assert over all of it at once.
 *
 * Bucket labels are re-exported from DESK_RECORD_COPY rather than re-written:
 * one vocabulary, two records.
 */
export const YOUR_RECORD_COPY = {
  heading: "Your record",
  bucketLabel: DESK_RECORD_COPY.bucketLabel,
  awaitingLabel: "Awaiting",
  /** Rendered when the user holds claims but none has resolved. */
  noneResolvedTitle: "None of your calls has resolved yet.",
  noneResolvedBody:
    "Each one is graded on its own window, against real prices, whichever way it goes. Nothing of the desk's is shown here in the meantime.",
  /** Rendered when the user holds no claims at all. */
  noClaimsTitle: "You have not made a call yet.",
  noClaimsBody:
    "Commit one in Radar. It is graded on its own window and the result stands, supported or challenged.",
  cta: "Make a call →",
  /** Rendered under the buckets once something has resolved. */
  awaitingNote: "Claims still inside their window are awaiting a grade.",
  unavailable: "Your calls are not available right now. Nothing is estimated in their place.",
} as const;

/**
 * How ONE of the user's claims resolved, or null when it is still awaiting its
 * own verdict. The single place a claim becomes a bucket, so the row chip and
 * the summary counts cannot say different things about the same claim.
 */
export function resolutionForClaim(
  claim: UserClaimLike,
  ownOutcomes: Record<string, ClaimOutcomeRow | undefined>,
  todayIso: string,
): Resolution | null {
  const own = resolveClaimOutcome(claim, ownOutcomes);
  if (!own) return null;
  // user_claim_outcomes is a mirror of the brief-call outcome shape (sql/0012),
  // so the shared mapper reads it directly. Normalized here because the row
  // arrives from JSON with every field optional.
  const outcome: CallOutcomeRow = {
    call_id: own.call_id,
    verdict: own.verdict ?? "",
    attribution: (own.attribution ?? null) as CallOutcomeRow["attribution"],
    actual_pct_change: own.actual_pct_change ?? null,
    actual_direction: own.actual_direction ?? null,
    verdict_notes: own.verdict_notes ?? null,
    graded_at: own.graded_at ?? null,
    metadata: (own.metadata ?? null) as CallOutcomeRow["metadata"],
  };
  const props = scoredCallProps(
    {
      claim_text: claim.user_claim,
      target_symbol: claim.target_symbol ?? null,
      claim_type: claim.claim_type ?? null,
      created_at: claim.created_at ?? null,
      brief_date: null,
    },
    outcome,
    todayIso,
  );
  return RESOLUTION_BY_STATE[props.state];
}

/**
 * Build the user's record from their claims and their OWN outcome rows.
 *
 * `todayIso` is today's date, passed through to the shared mapper only to tell
 * a live window from a closed one. It never influences a verdict.
 */
export function buildYourRecord(
  claims: UserClaimLike[],
  ownOutcomes: Record<string, ClaimOutcomeRow | undefined>,
  todayIso: string,
): YourRecord {
  const byResolution: Record<Resolution, number> = { ...EMPTY };
  let resolved = 0;
  let awaiting = 0;

  for (const claim of claims) {
    const resolution = resolutionForClaim(claim, ownOutcomes, todayIso);
    if (!resolution) {
      awaiting += 1;
      continue;
    }
    resolved += 1;
    byResolution[resolution] += 1;
  }

  return {
    totalClaims: claims.length,
    resolved,
    awaiting,
    byResolution,
    hasResolved: resolved > 0,
  };
}

/** Bucket render order, identical to the desk record: misses are never last. */
export { RESOLUTION_ORDER } from "./desk-record.ts";

/**
 * Every string the personal record surface can author for a given model.
 * Used by the compliance test.
 */
export function yourRecordAuthoredStrings(record: YourRecord | null): string[] {
  const copy = YOUR_RECORD_COPY;
  const out: string[] = [
    copy.heading,
    copy.awaitingLabel,
    copy.noneResolvedTitle,
    copy.noneResolvedBody,
    copy.noClaimsTitle,
    copy.noClaimsBody,
    copy.cta,
    copy.awaitingNote,
    copy.unavailable,
    ...Object.values(copy.bucketLabel),
  ];
  if (record) {
    for (const r of Object.keys(record.byResolution) as Resolution[]) {
      out.push(String(record.byResolution[r]));
    }
    out.push(String(record.awaiting));
  }
  return out;
}
