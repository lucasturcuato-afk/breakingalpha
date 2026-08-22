import type { Resolution } from "@/lib/desk-record.ts";
import type { OutcomeState } from "@/components/ledger";

/**
 * Fixture for the mobile Desk record. This unit renders from data, not from a
 * loader: `src/lib/desk-record-query.ts` already exists and the desktop route
 * already calls it, so wiring it here would be a second call site for a screen
 * whose layout is not yet reviewed.
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
  /** Ticker and brief date, on the trailing edge of the state row. */
  instrument: string;
  /** Verbatim, as the desk published it. Never rewritten. */
  claim: string;
  /** The grader's benchmark evidence line. */
  result: string;
}

export interface DeskRecordData {
  /** The window the record covers, stated rather than implied. */
  since: string;
  /** Ordered by `RESOLUTION_ORDER`; the view does not sort. */
  counts: DeskCountCell[];
  /** Where the desk is weakest, given its own section above the list. */
  weaknessHeading: string;
  weaknessProse: string;
  listHeading: string;
  entries: DeskEntryFixture[];
  /**
   * Rendered by the stale state only. The date the grader last completed.
   *
   * Must never be EARLIER than the newest entry's date. The stale notice says
   * calls that closed after this run are not on the record yet, so a listed
   * entry dated after it makes the screen contradict its own notice.
   */
  lastGradedOn: string;
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
