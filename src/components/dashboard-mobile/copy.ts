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
 * The desk record's intro. True whether or not the desk has graded anything.
 */
export const DASH_DESK_RECORD_INTRO =
  "Signalera's own graded calls. A separate record from yours, on the same four states.";

/**
 * The sentence that describes the bars, and the only place they are described.
 *
 * It used to live in the closing disclaimer, which renders in every state
 * including the ones where the desk record did not answer and no bar is on
 * screen. Moving it up beside the bars fixed that case and left one more: the
 * intro renders whenever the desk record was READ, and the bars render only
 * when that record has entries. On day one, with nothing graded, the section
 * draws "No graded calls yet" and four words about bars that are not there and
 * a record there is none of to be proportional to.
 *
 * So it is a separate string, appended by `deskRecordIntro` only when the
 * record has entries. One paragraph either way, so the populated state that
 * parity fingerprints is byte-identical to before.
 */
export const DASH_DESK_RECORD_BARS =
  "The bars draw each bucket's share of the whole record.";

/**
 * The desk intro as the section should state it, given whether the record has
 * anything in it. `total > 0` is the same test the screen uses to decide
 * between the bars and the day-one absence, so the sentence and the element it
 * describes cannot come apart.
 */
export function deskRecordIntro(hasEntries: boolean): string {
  return hasEntries ? `${DASH_DESK_RECORD_INTRO} ${DASH_DESK_RECORD_BARS}` : DASH_DESK_RECORD_INTRO;
}

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
 * clause moved to `DASH_DESK_RECORD_BARS`, appended beside the bars only when
 * they draw, and what is left here is true whether or not a single record
 * section drew.
 */
export const DASH_DISCLAIMER =
  "Informational only and never investment advice. Every record figure here is a count; no rate or score is stated as a figure.";
