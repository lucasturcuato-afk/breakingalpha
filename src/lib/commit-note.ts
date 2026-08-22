/**
 * The user's own commit note: what they wrote in the Commit sheet at the
 * moment they took a view, and what the Review screen reads back to them
 * months later under "YOU WROTE".
 *
 * Three notes exist on this data and they are easy to confuse:
 *
 *   commit_note        the USER's reasoning. This file. Written once, at
 *                      commitment, read back verbatim by Review.
 *   gradeability_note  the SERVER's explanation of why a claim cannot be
 *                      graded. Written by the claim routes.
 *   verdict_notes      the GRADER's reading, written at resolution onto
 *                      user_claim_outcomes.
 *
 * Storage is `user_claims.commit_note`, proposed and NOT YET APPLIED in
 * `sql/proposals/0033_user_claim_commit_note.sql`. Until that runs, the
 * helpers here let a route refuse cleanly instead of writing a row without
 * the note. See `missingColumnResponse` for why refusing is the only
 * acceptable behaviour.
 */

/**
 * Server-side sanity bound. The design shows a live character count beside the
 * note field (prototype line 2594, `noteCount`) but states no ceiling in its
 * markup, so this is ours, not the design's. Report it in any PR that relies
 * on it as a value not sourced from the design.
 */
export const COMMIT_NOTE_MAX = 2000;

export type CommitNoteParse =
  | { ok: true; note: string }
  | { ok: false; error: string };

/**
 * Trims and bounds a note off a request body. An absent or blank note parses
 * to `ok` with an empty string: the sheet requires one before its button
 * unlocks, but the routes here are also reached by the desktop Track control,
 * which has no sheet and has never sent one. Requiring it at this layer would
 * break that surface. The sheet enforces its own requirement client-side, and
 * the DB CHECK rejects a note that is present but blank.
 */
export function parseCommitNote(raw: unknown): CommitNoteParse {
  if (raw === undefined || raw === null) return { ok: true, note: "" };
  if (typeof raw !== "string") {
    return { ok: false, error: "commit_note must be a string" };
  }
  const note = raw.trim();
  if (note.length > COMMIT_NOTE_MAX) {
    return {
      ok: false,
      error: `commit_note must be ${COMMIT_NOTE_MAX} characters or fewer`,
    };
  }
  return { ok: true, note };
}

/**
 * Postgres 42703 is "column does not exist". PostgREST reports the same
 * condition as PGRST204 through its schema cache, so both are checked, plus a
 * message fallback for clients that surface neither code.
 *
 * Call this BEFORE any generic missing-table branch. The existing guards in
 * these routes match any "does not exist" and would otherwise swallow this.
 */
export function isMissingCommitNoteColumn(error: {
  code?: string;
  message?: string;
}): boolean {
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = error.message ?? "";
  return /commit_note/.test(msg) && /does not exist|could not find/i.test(msg);
}

/**
 * The body of the 503 a route sends when a note was supplied but the column
 * does not exist yet.
 *
 * This refuses the whole write. The tempting alternative, dropping the column
 * from the insert and letting the row succeed, answers 200 to someone who
 * typed their reasoning and watched it disappear. The Commit sheet exists
 * precisely to record that reasoning, so a commitment stored without it is not
 * a degraded success, it is a lie about what was saved. Failing loudly leaves
 * the user able to retry with their words intact; succeeding quietly does not.
 */
export function missingColumnResponse(): {
  error: string;
  reason: string;
} {
  return {
    error:
      "Your note cannot be saved yet, so nothing was tracked. " +
      "Your words were not discarded. Try again once note storage is set up.",
    reason: "commit_note_column_missing",
  };
}
