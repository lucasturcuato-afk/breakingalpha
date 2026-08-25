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

/**
 * The desk record's intro, and the only place the bars are described.
 *
 * The bars clause used to live in the closing disclaimer, which renders in
 * every state including the ones where the desk record did not answer and no
 * bar is on screen. A sentence describing an element that is not there is
 * harmless but it is still a sentence about something nobody can see. It sits
 * with the bars now, so it renders exactly when they do.
 */
export const DASH_DESK_RECORD_INTRO =
  "Signalera's own graded calls. A separate record from yours, on the same four states. The bars draw each bucket's share of the whole record.";

/**
 * The closing line, and it has to be true in every state this screen has.
 *
 * It used to read "No rate, ratio or score is computed over either record",
 * and that rendered a few hundred pixels under four desk bars whose width is
 * `count / total`. A share is a ratio and the bars compute one, so the line
 * contradicted what the screen draws. The bars stay, because they state no
 * figure and removing them is a change to the record component's design rather
 * than to this screen's honesty.
 *
 * The replacement then described the bars, which was accurate whenever they
 * rendered and stranded whenever the record read did not answer. So the bars
 * clause moved to `DASH_DESK_RECORD_INTRO`, beside the bars, and what is left
 * here is true whether or not a single record section drew.
 */
export const DASH_DISCLAIMER =
  "Informational only and never investment advice. Every record figure here is a count; no rate or score is stated as a figure.";
