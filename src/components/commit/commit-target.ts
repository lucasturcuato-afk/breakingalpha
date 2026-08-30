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

/**
 * Floor on a stored note, in characters, counted AFTER trimming.
 *
 * WHICH SURFACES APPLY IT IS NO LONGER "ALL OF THEM", and the split is ruled
 * rather than incidental. `decisions/commit-note-optional-when-adopting.md`
 * reverses the second half of ruling 11: authoring a claim still requires the
 * reasoning, because the reasoning is the claim, so Compose keeps this floor.
 * Adopting a call the desk already reasoned about does not, so the commit
 * sheet asks for a note and requires none. `./commit-gate` is where that
 * decision is made and is the only place that should decide it; this module
 * still owns the literal, so the surfaces that DO gate cannot drift to two
 * different numbers, which is the half of ruling 11 that still stands.
 *
 * Desktop /radar/calls (`src/components/calls/TrackCallControl.tsx`) still
 * gates and is out of this change's scope. It adopts, so the ruling reaches
 * it; nothing here is what stops it, and the recon records it as the one
 * surface left to follow.
 *
 * Trimming is the load-bearing half. `sql/proposals/0033` writes the same
 * semantic into the column as `length(btrim(commit_note)) > 0`, and the adopt
 * route trims before it stores, so a field counting raw characters would let
 * twelve spaces through to a constraint that reads them as nothing.
 *
 * It sits beside the ceiling below, for the reason the ceiling gives.
 */
export const COMMIT_NOTE_MIN = 12;

/**
 * Ceiling on a stored note, in characters.
 *
 * The floor is COMMIT_NOTE_MIN, directly above. Both are enforced in the
 * CLIENT: the adopt route accepts a note and does not require one, so a caller
 * with nothing to send is not broken by a rule about length. See the route's
 * header.
 *
 * They sit in THIS module, which is pure and imports nothing, because both
 * sides need them and neither may import the other: the route is server code
 * that must not reach the browser bundle, and the sheet is a client component
 * the route must not pull in. Two copies of either number would let a field
 * disagree with the column behind it: the reader would lose the tail of their
 * own sentence, or be handed a bar no other screen sets, with nothing saying
 * so.
 */
export const COMMIT_NOTE_MAX = 2000;
