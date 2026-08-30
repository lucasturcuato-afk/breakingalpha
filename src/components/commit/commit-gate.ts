import { COMMIT_NOTE_MIN } from "./commit-target";

/**
 * Which claims require a note before they can be committed, and the copy the
 * commit sheet asks for one with.
 *
 * THE RULING THIS ENCODES. `decisions/commit-note-optional-when-adopting.md`
 * reverses the second half of DECISIONS.md ruling 11, "the two consequences
 * that need owners". Ruling 11 put the note inside what adopting a call means
 * and accepted the conversion cost as intended. It no longer applies to
 * adopting: authoring a claim is the reader making one, and the note is that
 * claim's reasoning, so it stays required there. Adopting is agreeing with a
 * call the desk already reasoned about, and a restatement demanded at that
 * moment makes a considered note indistinguishable from one typed to clear a
 * gate.
 *
 * WHY THE DISCRIMINATOR IS AN ARGUMENT RATHER THAN A COMPONENT BOUNDARY.
 * Compose and adopt are already two separate component trees writing to two
 * separate routes: `src/components/compose/compose-screen.tsx` posts to
 * `/api/radar/claims`, and `src/components/commit/commit-sheet.tsx` posts to
 * `/api/radar/claims/adopt`. Nothing carries a mode between them, so the two
 * gates could silently drift into three answers the way ruling 11 found three
 * surfaces disagreeing about what a commitment requires. Naming the origin at
 * the call site makes the sheet state which side of the ruling it is on, in
 * one pure module both sides can be tested against.
 *
 * THIS MODULE IMPORTS NOTHING BUT THE TWO CHARACTER LITERALS, for the reason
 * `./commit-target` gives: the routes are server code that must not reach the
 * browser bundle, and the sheet is a client component the routes must not pull
 * in. Both sides read the rule from here.
 *
 * NEITHER GATE IS A SERVER RULE AND NEITHER EVER WAS. `/api/radar/claims` and
 * `/api/radar/claims/adopt` both accept a note and require neither its
 * presence nor its length; each trims, caps at COMMIT_NOTE_MAX, and stores
 * null for anything empty. So this file is the whole of the change, and a
 * caller with nothing to send was never broken by it.
 */

/**
 * Where the claim came from.
 *
 * `authored` is Compose, step 7, where the reader writes the claim itself.
 * `adopted` is the commit sheet, where the reader takes a call the desk
 * published. They are not two shapes of the same act and the ruling turns on
 * exactly that difference.
 */
export type ClaimOrigin = "authored" | "adopted";

/**
 * True when a claim of this origin cannot be committed without a note.
 *
 * One line, and it is the ruling. Authoring requires the reasoning because the
 * reasoning is the claim. Adopting does not.
 */
export function noteRequiredFor(origin: ClaimOrigin): boolean {
  return origin === "authored";
}

/**
 * True when this note clears whatever bar its origin sets.
 *
 * On `adopted` there is no bar, so an empty field clears it and so does a
 * single character. On `authored` the bar is COMMIT_NOTE_MIN characters
 * counted AFTER trimming, unchanged, for the reason `./commit-target` states:
 * `sql/proposals/0033` writes `length(btrim(commit_note)) > 0` into the column
 * and the routes trim before storing, so a count over raw characters would let
 * twelve spaces through to a constraint that reads them as nothing.
 */
export function noteSatisfiesGate(note: string, origin: ClaimOrigin): boolean {
  if (!noteRequiredFor(origin)) return true;
  return note.trim().length >= COMMIT_NOTE_MIN;
}

/* ── the sheet's note copy ─────────────────────────────────────────────────
   Exported so the strings are assertable without mounting a client component
   that value-imports a CSS module. Same reason `TrackCallControl.tsx` exports
   its own. The desk keeps `TRACK_NOTE_HINT`, "A sentence is enough.", because
   the desk still gates; the sheet no longer does, so it no longer says a
   sentence is sufficient for anything. */

/**
 * Under an empty field on the adopt path.
 *
 * IT SAYS WHAT THE NOTE IS FOR AND ASKS FOR NOTHING. The field would read as
 * vestigial the moment the control unlocked without it, and the two obvious
 * repairs are both wrong: "Optional" is an apology for the field existing, and
 * the old "A sentence is enough." describes a floor that is no longer there.
 * This states the payoff instead, in the register the sheet already uses for
 * consequences ("The window is fixed the moment you commit"), and it is the
 * literal truth of the Review screen: `review-screen.tsx` reads this exact
 * field back under "YOU WROTE" when the date arrives.
 *
 * It is also the same length class as the string it replaces, so the hint row
 * it shares with the character counter does not start wrapping at 320.
 */
export const ADOPT_NOTE_HINT = "A sentence is what you will read back.";

/** Once anything is in the field. Unchanged from before the ruling. */
export const ADOPT_NOTE_HINT_WRITTEN = "Timestamped before the outcome is known.";

/**
 * The press control, on every state the reader can act from.
 *
 * There is no second label any more. "Write your reasoning first" was the
 * gate's voice, naming a thing the reader had to do before the control would
 * work, and with nothing to do first a control that still said it would be
 * describing a rule that no longer exists.
 */
export const ADOPT_PRESS_LABEL = "Press to enter this on your ledger";

/**
 * The field's accessible name.
 *
 * There is no VISIBLE label on this field: the question is the sheet's own
 * heading, "Why do you think so?", and the field sits directly under it inside
 * the ruled box. So the accessible name has nothing to disagree with, and the
 * placeholder is a prompt rather than a second copy of a label.
 */
export const ADOPT_NOTE_ARIA_LABEL = "Your reasoning";
