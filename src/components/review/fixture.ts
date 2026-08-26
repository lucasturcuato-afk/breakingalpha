import type { OutcomeState } from "@/components/ledger/claim-anatomy";

/**
 * Review, build step 4: the moment one of the reader's own calls resolves.
 *
 * This file is the CONTRACT and the sample content, in that order. The shape
 * below is what `src/lib/review-data.ts` has to satisfy; the sample beneath it
 * exists so the screen can be fingerprinted against the design and so the four
 * lifecycle states stay reachable in an audit once a real query sits behind
 * them. It is invented content and it is gated. Nothing here is ever a default:
 * `src/app/review/page.tsx` resolves the gate and passes the result down.
 *
 * NEVER import this from a "use client" module. The gate is a runtime
 * constant, so a client import ships the prose to `.next/static` whether or
 * not it can paint. Import the TYPES from here freely; they erase.
 */

/**
 * The user's own commit note, and the moment it was WRITTEN.
 *
 * `writtenAt` is `user_claims.commit_note_at` and nothing else. It is NEVER
 * `user_claims.created_at`.
 *
 * Ruled by Noah on 2026-08-25, recorded in
 * `sql/proposals/0033_user_claim_commit_note.sql`: the two values diverge the
 * moment a note is edited, and nothing in the schema stops that. `created_at`
 * is right only for as long as a note can never change after commitment. A
 * screen whose entire subject is what you said and when you said it reads the
 * field that means that.
 *
 * Null is legal and is not an error: a row can carry a note with no note
 * timestamp. The eyebrow then reads "YOU WROTE" with no time rather than
 * borrowing one from another column.
 */
export interface ReviewNote {
  /** `user_claims.commit_note`, verbatim. Never summarized, never trimmed. */
  text: string;
  /** `user_claims.commit_note_at`, formatted "YYYY-MM-DD HH:MM PT". */
  writtenAt: string | null;
}

/** How the resolution is dated. The lead phrase is data, not a constant. */
export interface ReviewResolvedAt {
  /**
   * True only when the grade landed on the session before this one. The design
   * writes "resolved overnight" unconditionally (prototype line 501); a grade
   * from three weeks ago is not overnight, and saying so would be a claim about
   * when something happened that the row contradicts.
   */
  overnight: boolean;
  /** "Thursday, August 27", from `user_claim_outcomes.graded_at` in PT. */
  day: string;
}

export interface ReviewData {
  resolvedAt: ReviewResolvedAt;
  /** One of the four permitted words. The closed set lives in claim-anatomy. */
  state: OutcomeState;
  /** The falsifiable sentence, `user_claims.user_claim`, verbatim. */
  claim: string;
  /**
   * The grader's benchmark line, verbatim from the attribution grader. Null
   * when the outcome row carries none; the screen then draws no line rather
   * than a sentence written here.
   */
  result: string | null;
  /** `user_claim_outcomes.verdict_notes`, the grader's own reading, or null. */
  reading: string | null;
  /**
   * The note read, in three states, because three things can be true of it and
   * each one is drawn differently. Same shape the Dashboard's Top Stories read
   * uses, deliberately, rather than a fourth invention.
   *
   *   an object   the read ANSWERED and this claim carries a note.
   *   null        the read ANSWERED and this claim carries NO note.
   *   "failed"    the read ANSWERED WITH AN ERROR. The note block says so and
   *               only the note block does; the resolution above it stands.
   */
  note: ReviewNote | null | "failed";
  /**
   * True when this claim was taken before commit notes existed at all.
   *
   * It splits the `note: null` case into the two different things it can mean,
   * and it is the whole reason the null case reads as history rather than as a
   * missing value. Every claim adopted before 2026-08-25 has a permanently
   * null note and there is no backfill: nothing recorded when those notes would
   * have been written, because there were no notes. That is not a note that
   * failed to load, and the screen does not draw it as one.
   *
   * Resolved in the loader from the claim's own creation date against the
   * session the column was applied. The screen never sees `created_at`, which
   * is how it cannot accidentally render it as the note's time.
   */
  predatesNotes: boolean;
  /**
   * The closing paragraph, prototype line 512. NULL FROM EVERY REAL READ.
   *
   * It is a written interpretation of one person's reasoning, and nothing in
   * the repo generates prose about a user's reasoning. It is either an
   * unspecified model output or a template keyed on the verdict and
   * attribution pair, and the design does not say which. Until something
   * produces it the well is absent rather than filled with a sentence this
   * screen made up about the reader.
   */
  meaning: string | null;
}

/**
 * The design's own sample, prototype lines 499 to 518, verbatim.
 *
 * Every string here is invented: an invented call, an invented benchmark line
 * and an invented note attributed to a reader. It never reaches production.
 */
export const REVIEW_FIXTURE: ReviewData = {
  resolvedAt: { overnight: true, day: "Thursday, August 27" },
  state: "challenged",
  claim:
    "Constellation Energy trades above the utilities sector index through the next PJM capacity auction result.",
  result: "CEG +2.10% against XLU +6.44% and SPY +1.71% over 21 days.",
  reading:
    "The move separates cleanly from both the sector and the market, so the read counts. The auction cleared inside the forward curve and the regulated book carried the sector.",
  note: {
    text: "Data centre contracting is repricing faster than the regulated book. If the auction clears high the sector index still carries too much regulated drag to keep pace.",
    writtenAt: "2026-08-06 06:58 PT",
  },
  predatesNotes: false,
  meaning:
    "Your reasoning held together. Its condition did not arrive: the auction cleared inside expectations, so the drag you priced never got tested. That is a different thing from being mistaken, and the record shows which one it was.",
};
