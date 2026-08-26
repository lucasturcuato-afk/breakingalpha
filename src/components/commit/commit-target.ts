/**
 * The commit sheet's trigger contract.
 *
 * THIS TYPE IS THE DELIVERABLE, as much as the screen is. The sheet is a
 * GLOBAL OVERLAY, not a child of the Ledger: prototype `:2579` gates it on
 * `sheetOpen` at the same depth as every screen block, with no reference to
 * which screen is showing, and three separate surfaces open it. The Ledger is
 * simply the first one built.
 *
 * So a surface opens it by calling `useCommitSheet()?.open(target)` with the
 * four fields below and nothing else. Claim (step 6) and Deal detail (step 10)
 * open the SAME overlay the same way when they are built, and neither this
 * type nor the sheet changes when they do. That is the whole point of putting
 * the contract in its own module: a screen can import the shape without
 * importing the overlay.
 *
 * It carries no copy, no styling and no window arithmetic. The sheet derives
 * the window from `resolveOn` and `sessionIso` through `src/lib/call-horizons.ts`,
 * which is the same module the adopt route resolves the stored window with, so
 * the phrase a reader agrees to and the window the row is written with cannot
 * come apart.
 */
export interface CommitTarget {
  /**
   * `morning_brief_calls.id`. The only id `/api/radar/claims/adopt` accepts,
   * and the reason a surface with no brief call cannot open this sheet.
   */
  callId: string;
  /** The falsifiable sentence being committed to. Shown, never edited. */
  claim: string;
  /**
   * The call's own `resolve_on`, ISO date, or null when it has none. Null and
   * the sheet offers the shared default window rather than inventing a span.
   */
  resolveOn: string | null;
  /**
   * The reader's session date, ISO. Passed in rather than read off a clock
   * here so a server render and a client render cannot disagree about which
   * day it is, which is the defect `displayLoggedDate` exists to contain.
   */
  sessionIso: string;
}
