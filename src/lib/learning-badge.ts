/**
 * learning-badge - the one predicate behind the "Learning active" badge.
 *
 * The badge asserts that a feedback loop is running. That is a claim about the
 * system, so it needs evidence, and the evidence is narrow: the calibrator has
 * published a FITTED weight row (lead_weights, is_default false) trained on a
 * non-zero number of graded days.
 *
 * A seed row does not count. lead_weights shipped with one hand-tuned default
 * (version 0, is_default true, n_train 0) whose own note says it is the
 * reversion target "until the calibrator has N >= 20 confidence-weighted
 * graded days". While that is the only row, nothing has been learned from
 * outcomes and the badge must not render.
 *
 * Missing evidence is never treated as a yes: null/undefined returns false.
 */

export interface LearningEvidence {
  /** True only when a non-default lead_weights row exists with n_train > 0. */
  calibrated?: boolean | null;
  fitTs?: string | null;
  nTrain?: number | null;
}

export function shouldShowLearningBadge(
  evidence: LearningEvidence | null | undefined,
): boolean {
  if (!evidence) return false;
  return evidence.calibrated === true && (evidence.nTrain ?? 0) > 0;
}
