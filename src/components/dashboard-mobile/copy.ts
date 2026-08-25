/**
 * Authored copy for the mobile Dashboard.
 *
 * Every string here is a label or a compliance line. None of them is a claim
 * about the reader, their record or the tape, so all of them are safe to
 * render whether or not a loader has answered. Anything that IS such a claim
 * lives in `DashboardData` and is null when there is no source for it.
 *
 * Kept out of `fixture.ts` on purpose: the fixture and the real loader both
 * need these lines, and the real path must never import the fixture.
 */

/** The link above the record sections. A label on /ledger, not a claim that a brief exists today. */
export const DASH_BRIEF_TITLE = "The morning brief";

/** The eyebrow on the resolved-overnight card. */
export const DASH_WAITING_EYEBROW = "RESOLVED OVERNIGHT";

export const DASH_YOUR_RECORD_INTRO =
  "Your own calls, graded on their own outcomes. Nothing here borrows the desk's result.";

export const DASH_DESK_RECORD_INTRO =
  "Signalera's own graded calls. A separate record from yours, on the same four states.";

export const DASH_DISCLAIMER =
  "Informational only and never investment advice. No rate, ratio or score is computed over either record.";
