import type { OutcomeState } from "@/components/ledger";

/**
 * Sample content for the Entry screen, in the shape of
 * `src/components/ledger/fixture.ts` and following the same rule: this screen
 * has no data source yet, so the shape below IS the contract a real loader has
 * to satisfy. Swapping the fixture for a fetch should not touch a component.
 *
 * The four records are the same claims the Ledger fixture carries, so a row
 * opened on `/ledger` and the screen it opens state the same claim rather than
 * two unrelated demos. `e1` is the entry the prototype draws, verbatim.
 *
 * Compliance notes on sample content:
 *
 * - Nothing here is a rate. Every figure is one instrument's move against one
 *   benchmark over one window, which is the evidence for a single claim.
 * - Every date is a formatted string supplied by the loader. There is no clock
 *   on this screen: a settled entry states when it was checked, and an open one
 *   states when it will be, and neither is derived from the current time.
 * - Capitals appear in `ledgerLine` and nowhere else. That is the machine
 *   record, which is the one carve-out the design grants.
 * - The challenged entry is first and carries the same slots as the supported
 *   one. Nothing about it is shorter, quieter or later.
 */

/**
 * The lifecycle states this screen draws. Declared here rather than beside the
 * component because the page is a server component and reads this list to
 * validate a search param: a value exported from a "use client" module reaches
 * the server as a client reference, not as the array.
 */
export const ENTRY_STAGES = ["ready", "loading", "error", "none", "stale"] as const;
export type EntryStage = (typeof ENTRY_STAGES)[number];

export interface EntryWindow {
  /** What the window showed. Absent while the window is still open. */
  result?: string;
  /** Whether the move separated from the sector and the market. */
  detail?: string;
  /** What has not settled yet. Present only while the window is open. */
  pending?: string;
}

export interface EntryRecord {
  id: string;
  state: OutcomeState;
  /** Sector, on the trailing edge of the state row. */
  sector: string;
  /** The claim as it was written, before the outcome was known. */
  claim: string;
  /** The mono stamp above the note, already formatted. Never a clock. */
  wroteStamp: string;
  /** The reader's own note, in their words, unedited. */
  note: string;
  window: EntryWindow;
  /** What the entry meant. Written once the window closed, so open entries have none. */
  meaning?: string;
  /**
   * The machine record line, already formatted. The separators around each
   * middot are non-breaking spaces, as the design writes them: a record line
   * that wraps between a label and its date reads as two facts, not one.
   */
  ledgerLine: string;
  /**
   * Date of the last completed check, already formatted. Drives the stale
   * notice. Absent on an entry whose window has never closed: an open entry has
   * no completed check, and a notice naming one would state a check that did
   * not happen.
   */
  checkedOn?: string;
}

export const ENTRY_FIXTURES: EntryRecord[] = [
  {
    id: "e1",
    state: "challenged",
    sector: "Pharmaceuticals",
    claim: "Novo Nordisk narrows the US script gap against Lilly by the July IQVIA prints.",
    wroteStamp: "YOU WROTE, 2026-06-24 07:11 PT",
    note: "CagriSema's label read better than the print suggested and the compounding crackdown should have pulled scripts back to branded. I read the June slowdown as inventory, not demand.",
    window: {
      result: "NVO −8.13% against XLV −0.44% and SPY +1.71% over 28 days.",
      detail:
        "The move separates cleanly from both the sector and the market, so the read counts. Weekly prints widened the gap in three of four weeks. The compounding crackdown landed, and the scripts went to Lilly.",
    },
    meaning:
      "You were more confident than the street and the evidence ran the other way. The inventory read was the weak link and it was testable at the time.",
    ledgerLine: "ENTERED 2026-06-24  ·  CHECKED 2026-07-22  ·  WINDOW FIXED AT ENTRY",
    checkedOn: "2026-07-22",
  },
  {
    id: "e2",
    state: "supported",
    sector: "Technology",
    claim: "Azure growth reaccelerates above 30% when the June quarter prints.",
    wroteStamp: "YOU WROTE, 2026-05-19 06:58 PT",
    note: "Capacity came online in three regions at once and backlog conversion had already turned. I read the March quarter as supply constrained rather than demand constrained.",
    window: {
      result: "MSFT +6.41% against XLK +1.02% and SPY +0.88% over 34 days.",
      detail:
        "The move separates from both the sector and the market, so the read counts. Azure printed 31% and the guide moved with it.",
    },
    meaning:
      "The supply read was the part carrying the claim and it stood up. Nothing in the quarter tested the second half of the reasoning, which is still open.",
    ledgerLine: "ENTERED 2026-05-19  ·  CHECKED 2026-06-22  ·  WINDOW FIXED AT ENTRY",
    checkedOn: "2026-06-22",
  },
  {
    id: "e3",
    state: "developing",
    sector: "Financial services",
    claim: "SoFi's deposit costs peak in the June quarter.",
    wroteStamp: "YOU WROTE, 2026-06-02 07:24 PT",
    note: "Direct deposit share kept climbing while promotional pricing came off, and the mix was doing more work than the rate.",
    window: {
      result: "SOFI +4.02% against XLF +3.71% and SPY +2.90% over 28 days.",
      detail:
        "The move could not be separated from the sector, so nothing was tested. The window is extended to the next print.",
    },
    ledgerLine: "ENTERED 2026-06-02  ·  CHECKED 2026-06-30  ·  WINDOW FIXED AT ENTRY",
    checkedOn: "2026-06-30",
  },
  {
    id: "e4",
    state: "awaiting",
    sector: "Rates",
    claim: "The 10-year Treasury yield closes under 4.50% before the September FOMC decision.",
    wroteStamp: "YOU WROTE, 2026-08-06 06:52 PT",
    note: "Two soft payroll prints moved the front end without the long end following, and I read the term premium as carrying more of the level than the market is pricing.",
    window: {
      pending:
        "Nothing has settled yet. The window closes on 2026-09-04, and it was fixed when you entered.",
    },
    ledgerLine: "ENTERED 2026-08-06  ·  CHECKS 2026-09-04  ·  WINDOW FIXED AT ENTRY",
    /* No checkedOn. The window is still open, so no check has completed, and
       the entry date is not one. */
  },
];

/**
 * The entry this screen draws by default. `e1` is the prototype's own record,
 * and it is a challenged one on purpose: the screen that gets looked at most
 * during the build should be the state the design is least tempted to flatter.
 */
export const ENTRY_FIXTURE: EntryRecord = ENTRY_FIXTURES[0];

/**
 * Resolve the route param against the fixture set.
 *
 * A real loader reads `user_claims` by uuid and 404s on a miss. Until it
 * exists, an unknown id falls back to the default record rather than rendering
 * the not-found state, so `/entry/demo` draws the screen. The not-found state
 * is still reachable, by `?stage=none`, which is how the audit gets at it.
 */
export function entryFixture(id: string | undefined): EntryRecord {
  return ENTRY_FIXTURES.find((e) => e.id === id) ?? ENTRY_FIXTURE;
}

/** Resolve a state name to the record that carries it. */
export function entryFixtureForState(state: OutcomeState): EntryRecord {
  return ENTRY_FIXTURES.find((e) => e.state === state) ?? ENTRY_FIXTURE;
}
