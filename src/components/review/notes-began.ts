/**
 * The session on which the user's commit note began to exist.
 *
 * `sql/proposals/0033_user_claim_commit_note.sql` added `commit_note text` and
 * `commit_note_at timestamptz` to `user_claims`. Applied to production by hand
 * on 2026-08-25. Both confirmed against production: the REST endpoint answers
 * 200 for each rather than 42703.
 *
 * Two consumers, and they are why this is a module rather than two literals.
 * `src/lib/review-data.ts` compares a claim's creation date against it to
 * decide whether a null note is history or an absence, and the Review screen
 * prints the label in the sentence that says so. If those two drifted apart
 * the screen would date the feature to one day and classify claims by another.
 *
 * NOT a general-purpose feature flag. It answers exactly one question: was
 * this row written before there was anywhere to put a note.
 */

/** PT session date, the format `src/lib/session-date.ts` produces. */
export const COMMIT_NOTES_BEGAN_PT = "2026-08-25";

/** The same date, as the Review screen says it out loud. */
export const COMMIT_NOTES_BEGAN_LABEL = "25 August 2026";
