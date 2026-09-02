/**
 * The note gate, after the reversal.
 *
 * `decisions/commit-note-optional-when-adopting.md` splits one rule into two:
 * required when authoring, optional when adopting. Both halves are tested
 * here, and the two halves fail in opposite directions, which is the point.
 * A change that drops the floor everywhere passes the adopt tests and fails
 * the compose ones; a revert that restores it everywhere does the reverse.
 *
 * ON MAIN THIS FILE DOES NOT RESOLVE: `./commit-gate` does not exist there,
 * so every test in it is red. The compose half is asserted against
 * `../compose/compose-data`, which is unchanged by this branch, so it is green
 * on both sides and stays green.
 *
 * Pure, deterministic, no network, no DOM.
 * Run: npx tsx --test src/components/commit/commit-gate.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ADOPT_NOTE_ARIA_LABEL,
  ADOPT_NOTE_HINT,
  ADOPT_NOTE_HINT_WRITTEN,
  ADOPT_PRESS_LABEL,
  noteRequiredFor,
  noteSatisfiesGate,
  type ClaimOrigin,
} from "./commit-gate";
import { COMMIT_NOTE_MAX, COMMIT_NOTE_MIN } from "./commit-target";
import { NOTE_MIN_CHARS } from "../compose/compose-data";

// ---------------------------------------------------------------------------
// Adopting. The half that changed.
// ---------------------------------------------------------------------------

test("adopting does not require a note", () => {
  assert.equal(noteRequiredFor("adopted"), false);
});

test("an EMPTY note clears the adopt gate, which is the whole ruling", () => {
  assert.equal(noteSatisfiesGate("", "adopted"), true);
});

test("a ONE character note clears the adopt gate", () => {
  const one = "x";
  assert.equal(one.length, 1);
  assert.equal(noteSatisfiesGate(one, "adopted"), true);
});

test("nothing a reader can type into the adopt field locks the press", () => {
  const shapes = ["", " ", "\t", "\n".repeat(9), "x", "abcdefghijk", "abcdefghijkl", "x".repeat(400)];
  for (const s of shapes) {
    assert.equal(noteSatisfiesGate(s, "adopted"), true, JSON.stringify(s.slice(0, 20)));
  }
});

test("the adopt gate is open at every length, with no boundary anywhere", () => {
  for (let n = 0; n <= 24; n += 1) {
    assert.equal(noteSatisfiesGate("x".repeat(n), "adopted"), true, `length ${n}`);
  }
});

// ---------------------------------------------------------------------------
// Authoring. The half that did NOT change, asserted so a later sweep cannot
// take it out by reading the ruling as broader than it is.
// ---------------------------------------------------------------------------

test("authoring still requires a note", () => {
  assert.equal(noteRequiredFor("authored"), true);
});

test("compose still counts twelve, from the same single literal", () => {
  assert.equal(COMMIT_NOTE_MIN, 12);
  // compose-screen.tsx no longer reads this constant: it calls
  // noteSatisfiesGate(note, "authored") and gets the floor through this
  // module. NOTE_MIN_CHARS remains compose-data's documented statement of the
  // same number, and this asserts the two cannot say different things.
  assert.equal(NOTE_MIN_CHARS, COMMIT_NOTE_MIN);
});

test("eleven characters still do not clear the compose gate", () => {
  const eleven = "abcdefghijk";
  assert.equal(eleven.length, 11);
  assert.equal(noteSatisfiesGate(eleven, "authored"), false);
});

test("twelve still clear it", () => {
  const twelve = "abcdefghijkl";
  assert.equal(twelve.length, 12);
  assert.equal(noteSatisfiesGate(twelve, "authored"), true);
});

test("compose still trims before counting, so padding is not content", () => {
  assert.equal(noteSatisfiesGate("      abcdefghi      ", "authored"), false);
  assert.equal(noteSatisfiesGate("   abcdefghijkl   ", "authored"), true);
});

test("whitespace alone never clears the compose gate, however much of it", () => {
  for (const blank of ["", " ", "            ", "\t".repeat(12), "\n".repeat(40)]) {
    assert.equal(noteSatisfiesGate(blank, "authored"), false, JSON.stringify(blank));
  }
});

test("the compose boundary is still exact: 11 closed, 12 open", () => {
  for (let n = 0; n <= 24; n += 1) {
    assert.equal(
      noteSatisfiesGate("x".repeat(n), "authored"),
      n >= COMMIT_NOTE_MIN,
      `length ${n}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The split itself
// ---------------------------------------------------------------------------

test("the two origins genuinely disagree, so the reversal is scoped", () => {
  const eleven = "abcdefghijk";
  assert.equal(noteSatisfiesGate(eleven, "authored"), false);
  assert.equal(noteSatisfiesGate(eleven, "adopted"), true);
});

test("every origin is answered, so no third value falls through a default", () => {
  const origins: ClaimOrigin[] = ["authored", "adopted"];
  for (const o of origins) {
    assert.equal(typeof noteRequiredFor(o), "boolean", o);
    assert.equal(typeof noteSatisfiesGate("anything at all", o), "boolean", o);
  }
});

test("the floor sits below the ceiling, so no note is both too short and too long", () => {
  assert.ok(COMMIT_NOTE_MIN < COMMIT_NOTE_MAX);
});

// ---------------------------------------------------------------------------
// The copy. The field has to read as wanted rather than vestigial, and the
// gate's own voice has to be gone from it.
// ---------------------------------------------------------------------------

const SHEET_COPY = [
  ADOPT_NOTE_HINT,
  ADOPT_NOTE_HINT_WRITTEN,
  ADOPT_PRESS_LABEL,
  ADOPT_NOTE_ARIA_LABEL,
] as const;

test("the empty-field hint says what the note is for", () => {
  assert.equal(ADOPT_NOTE_HINT, "A sentence is what you will read back.");
});

test("no sheet copy states a rule, a count, or a validation failure", () => {
  for (const s of SHEET_COPY) {
    assert.equal(/\d/.test(s), false, `no number in: ${s}`);
    assert.equal(/requir|invalid|error|minimum|must\b/i.test(s), false, s);
  }
});

test("no sheet copy apologises for the field or calls it optional", () => {
  // "Optional" is the apology. A field the reader is being asked to want is
  // not introduced by telling them they need not bother.
  for (const s of SHEET_COPY) {
    assert.equal(/optional|if you (like|want)|feel free|no need/i.test(s), false, s);
  }
});

test("the gate's old label is gone from the sheet's copy", () => {
  for (const s of SHEET_COPY) {
    assert.notEqual(s, "Write your reasoning first");
    assert.equal(/\bfirst\b/i.test(s), false, s);
  }
  // And the desk's gated label is NOT reused here: /radar/calls still gates,
  // so it keeps its own string, and the two surfaces are allowed to differ
  // now precisely because they no longer ask the same thing.
  assert.notEqual(ADOPT_PRESS_LABEL, "A sentence is enough.");
  assert.notEqual(ADOPT_NOTE_HINT, "A sentence is enough.");
});

test("no sheet copy promises a verdict, a probability, or a rate", () => {
  for (const s of SHEET_COPY) {
    assert.equal(/%|\bodds\b|\blikel|\bprobab|\bchance\b|\bconfidence\b/i.test(s), false, s);
  }
});

/* The banned vocabulary and the em-dash rule are NOT asserted here. Spelling
   the banned words out to check for them is itself a violation that
   `scripts/design-lint.mjs` reports, and that script already enforces both
   rules across every file in `src/`, this one included. One owner per rule. */

test("the accessible name is a name, not the placeholder repeated", () => {
  // The field has no visible label, so nothing can disagree with this. The
  // placeholder is the sheet's prompt and is deliberately a different string.
  assert.equal(ADOPT_NOTE_ARIA_LABEL, "Your reasoning");
  assert.notEqual(
    ADOPT_NOTE_ARIA_LABEL,
    "What has to be true for this, and what would change your mind.",
  );
});
