import type { Resolution } from "@/lib/desk-record.ts";
import type { OutcomeState } from "@/components/ledger";

/**
 * Sample record for the mobile Desk record, DEVELOPMENT AND PREVIEW ONLY.
 *
 * It is no longer what production renders and it must never be again. This
 * unit originally shipped with the screen defaulting `data` to the object
 * below, so production showed SUPPORTED 64 / CHALLENGED 39 under copy
 * promising "Every call the desk has published since June 2 is here", while
 * `/radar/desk-record` showed the desk's TRUE counts on the same deployment.
 * Two different track records, same product, same day. The counts here are
 * invented and always were.
 *
 * The screen now reads the real record through `src/lib/desk-record-query.ts`,
 * the same loader the desktop route calls, mapped by `from-record.ts`. This
 * object survives only so the loading, error, empty and stale states stay
 * reachable in dev, where no query can be made to fail on demand.
 *
 * COUNTS ONLY. There is no rate, ratio, share or percentage anywhere in this
 * file and there must never be one. A graded record is the single most likely
 * place in the product to reach for an aggregate figure, which is exactly why
 * it is the one place the rule is absolute. The three per-entry percentages
 * below are price moves against a named benchmark, which is evidence for one
 * call, not a figure derived from the mix.
 */

/** One cell of the count strip. `bucket` is the model's, never the view's. */
export interface DeskCountCell {
  bucket: Resolution;
  count: number;
}

/** A resolved call as the record lists it. Maps 1:1 to `DeskRecordEntry`. */
export interface DeskEntryFixture {
  id: string;
  state: OutcomeState;
  /**
   * Ticker and brief date, on the trailing edge of the state row. Optional:
   * a macro call has no symbol and an old row can have no brief date, and a
   * lone separator is worse than an absent line.
   */
  instrument?: string;
  /** Verbatim, as the desk published it. Never rewritten. */
  claim: string;
  /** The grader's benchmark evidence line. Absent when the read has none. */
  result?: string;
}

export interface DeskRecordData {
  /**
   * The window the record covers, stated rather than implied. Null when no
   * row carries a brief date, in which case the screen drops the clause
   * rather than naming a month it cannot source.
   */
  since: string | null;
  /** Ordered by `RESOLUTION_ORDER`; the view does not sort. */
  counts: DeskCountCell[];
  /**
   * Where the desk is weakest, given its own section above the list.
   *
   * NULLABLE, and null on the wired path. This is an editorial reading of the
   * record, not a figure in it: `buildDeskRecord` produces no bucket-by-theme
   * grouping and no "early on policy timing" count, so with a real record
   * behind the screen there is nothing to derive it from. The section is
   * dropped rather than filled with a sentence the loader cannot support.
   * Both fields move together; one without the other is a heading over
   * nothing.
   */
  weaknessHeading: string | null;
  weaknessProse: string | null;
  listHeading: string;
  entries: DeskEntryFixture[];
  /**
   * True when the record contains not-graded calls. Those have no verdict word,
   * and `OutcomeState` has no fifth member to give them, so they are counted
   * in the strip and never listed. The screen says that out loud rather than
   * leaving a count and a shorter list silently disagreeing.
   *
   * Derived from the same bucket count the strip renders, NOT from the list.
   * The list is truncated before the view sees it, so a page that happened to
   * carry no not-graded row would have hidden the explanation while the count
   * stayed on screen.
   */
  hasUnlistedNotGraded: boolean;
  /**
   * Non-null only when the read truncated the list, which is the second and
   * larger reason the list is shorter than the strip's counts.
   *
   * `read` is how many of the most recent calls were read into the list;
   * `counted` is how many the strip counts. Both come off the model, never
   * off the rendered rows: the rendered rows are fewer again, because
   * not-graded calls carry no verdict word and are dropped, which is what
   * `hasUnlistedNotGraded` explains. Null when nothing was truncated, and the
   * line is then absent rather than saying a cap did not bite.
   *
   * This existed unstated before it existed stated. The strip could count 99
   * over a list of 35 rows with two of the three reasons named and the
   * largest one silent, which is the same "count against a shorter list,
   * unexplained" shape as the not-graded gap, one size up.
   */
  listCap: { read: number; counted: number } | null;
  /**
   * Rendered by the stale state only. The date the grader last completed, or
   * null when nothing supplies one.
   *
   * Must never be EARLIER than the newest entry's date. The stale notice says
   * calls that closed after this run are not on the record yet, so a listed
   * entry dated after it makes the screen contradict its own notice.
   */
  lastGradedOn: string | null;
}

export const DESK_FIXTURE: DeskRecordData = {
  since: "June 2",
  counts: [
    { bucket: "supported", count: 64 },
    { bucket: "challenged", count: 39 },
    { bucket: "noCleanRead", count: 18 },
    { bucket: "notGraded", count: 22 },
  ],
  weaknessHeading: "where the desk has been challenged most",
  weaknessProse:
    "Rates calls resolve challenged more often than any other category here. The desk has been early on policy timing in eleven of them, which is a stated weakness rather than a discovered one.",
  listHeading: "recent",
  hasUnlistedNotGraded: false,
  /* Null, so the cap line is absent on this path. The cap line reports a real
     truncation performed by a real read, and there is no read behind this
     object: its three rows are the design's three rows and its counts are
     invented. A number here would be a fourth invented figure. */
  listCap: null,
  entries: [
    {
      id: "d1",
      state: "challenged",
      instrument: "CEG · AUG 27",
      claim:
        "Constellation Energy trades above the utilities sector index through the next PJM capacity auction result.",
      result: "CEG +2.10% against XLU +6.44%. Clean read.",
    },
    {
      id: "d2",
      state: "supported",
      instrument: "MSFT · JUL 31",
      claim: "Azure growth reaccelerates above 30% when the June quarter prints.",
      result: "MSFT +6.41% against XLK +1.02%. Clean read.",
    },
    {
      id: "d3",
      state: "developing",
      instrument: "SOFI · JUL 28",
      claim: "SoFi's deposit costs peak in the June quarter.",
      result: "SOFI +4.02% against XLF +3.71%. The move could not be separated from the sector.",
    },
  ],
  lastGradedOn: "August 28",
};
