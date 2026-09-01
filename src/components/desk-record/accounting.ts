import { DESK_RECORD_COPY, type Resolution } from "@/lib/desk-record.ts";

/**
 * The sentences that reconcile a count in the strip with the list under it.
 *
 * A MODULE OF ITS OWN BECAUSE IT IS THE ONE THING ON THIS SCREEN THAT MAY NOT
 * LIE. The standing rule is exact: nothing may filter, hide or reorder rows
 * such that a count disagrees with a list without a line on screen accounting
 * for the gap. Two sentences did that work before the strip became a control.
 * They are both here, unchanged in wording, plus the third the filter needs.
 *
 * PURE. No React, no DOM, no data access, so `tests/unit/desk-record-accounting.test.ts`
 * can hold every branch without a browser. That matters more here than
 * anywhere else on the screen: a sentence that silently stops covering a case
 * is indistinguishable, in review, from one that never needed to.
 *
 * ── THE DEFECT THIS REPLACES ──────────────────────────────────────────────
 *
 * The first cut of the filter kept the GLOBAL sentence and appended a line
 * naming the chosen bucket. That put three denominators on one screen: the
 * bucket's count in the strip, the number of rows drawn, and the record's
 * total, with no clause tying the first two together. It is the exact failure
 * the sentence exists to stop, one level down, and the filter made it worse
 * rather than better: an unfiltered reader can at least reconcile the strip
 * against the whole list, and a filtered one could reconcile nothing.
 *
 * So a chosen bucket gets that BUCKET's arithmetic: how many the record counts
 * in it, how many of those are in the list, and why the two differ. Nothing is
 * hidden to make the numbers agree, which was the other way out and is not
 * available: a count that disagrees with a list is a fact about the read, and
 * the fix is to say it.
 */

/** Every number the accounting is allowed to use. All of them come off the model. */
export interface AccountingInput {
  /** The chosen bucket, or null for the whole list. */
  bucket: Resolution | null;
  /** What the strip counts for the chosen bucket. Ignored when bucket is null. */
  countedInBucket: number;
  /** How many rows the list is drawing right now. */
  listed: number;
  /** The cap the read applied, or null when it did not bite. */
  listCap: { read: number; counted: number } | null;
  /** True when the record holds not-graded calls, which are never listed. */
  hasUnlistedNotGraded: boolean;
  /** The word on the chosen bucket's cell. */
  label: string;
}

/**
 * The not-graded clause, which is drawn in BOTH the filtered and the unfiltered
 * state.
 *
 * It is the only thing on the screen that explains why one cell of four does
 * not respond to a press, so dropping it while filtering would have left that
 * cell unexplained exactly when a reader is most likely to try it.
 */
function notGradedClause(hasUnlistedNotGraded: boolean): string[] {
  if (!hasUnlistedNotGraded) return [];
  return [
    "Not-graded calls are counted in the strip above and are not listed here, because they carry no verdict.",
  ];
}

/**
 * The sentences, in render order. Empty means there is no gap to account for
 * and the screen draws no paragraph at all, rather than a line saying a cap did
 * not bite.
 */
export function accountingSentences(input: AccountingInput): string[] {
  const { bucket, countedInBucket, listed, listCap, hasUnlistedNotGraded, label } = input;

  if (bucket === null) {
    const out: string[] = [];
    if (listCap !== null) {
      out.push(
        `Only the ${listCap.read} most recent calls in the record are read into this list. All ${listCap.counted} are counted in the strip above.`,
      );
    }
    out.push(...notGradedClause(hasUnlistedNotGraded));
    return out;
  }

  const outside = countedInBucket - listed;
  const out: string[] = [];

  if (outside > 0) {
    /* The bucket's own arithmetic, and the reason for the difference in the
       same breath. The cap is what causes it: the list is read from the newest
       page of the record and the strip counts every row read, so a bucket's
       older rows are outside the page rather than missing from the record. */
    out.push(
      listCap !== null
        ? `Showing ${listed} of the ${countedInBucket} calls the record counts as ${label}. The other ${outside} sit outside this list, which is read from the ${listCap.read} most recent calls in the record only.`
        : `Showing ${listed} of the ${countedInBucket} calls the record counts as ${label}. The other ${outside} sit outside this list.`,
    );
  } else {
    out.push(`Showing all ${listed} calls the record counts as ${label}.`);
  }

  out.push(`Press ${label} again for the whole list.`);
  out.push(...notGradedClause(hasUnlistedNotGraded));
  return out;
}

/** The strip's own note for the bucket that has no rows. Re-exported so the
 *  screen names it from the model rather than retyping it. */
export const NOT_GRADED_NOTE = DESK_RECORD_COPY.bucketNote.notGraded;
