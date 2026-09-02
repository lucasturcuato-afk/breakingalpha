// The 2px state edge on a disclosure card, pinned as a mapping rather than as
// a rendered pixel.
//
// WHY THIS FILE EXISTS. The separation build gave `LedgerDisclosureRow` a
// REQUIRED `state: OutcomeState | null` prop and wrote the token mapping as an
// inline ternary inside the component. Two screens pass it,
// `radar-mobile/calls-screen.tsx` and `desk-record/desk-record-screen.tsx`, and
// nothing in `test:unit` asserted a single arm of it. The only verification the
// prop ever had was a tester looking at a card in a browser, which is a check
// that cannot run again and cannot fail a build.
//
// THE EDGE IS A FILL, SO IT TAKES THE BASE TOKEN AND NEVER THE INK ONE.
// `claim-anatomy.tsx` records swapping those two as the single most common
// defect the design found, which is exactly why the table separates `dot` from
// `text` at all. An edge painted `--c-greenink` is legal CSS, builds clean,
// lints clean, and draws a 2px band in a type colour no surface uses as a fill.
// The assertions below make that unrepresentable rather than unlikely.
//
// WHAT MUST NOT HAPPEN IS PINNED TOO, and one of those is a decision this file
// would otherwise be free to break. `developing` and `awaiting` SHARE A HUE BY
// DESIGN: they are separated by their word and by the card's own boundary, never
// by colour, and a test asserting the two edges differ would be asserting the
// opposite of a documented ruling. It is asserted as an equality here so that a
// later edit splitting them has to come through this file and argue.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTCOME_EDGE_NEUTRAL,
  OUTCOME_STATES,
  OUTCOME_TOKENS,
  outcomeEdgeToken,
  type OutcomeState,
} from "../../src/components/ledger/claim-anatomy";

/* Derived from the closed set, never listed. A fifth state added to
   `OUTCOME_STATES` is covered by every case below on the day it lands rather
   than skipped by a list nobody updated. */
const STATES = [...OUTCOME_STATES];
const INK_TOKENS = new Set(STATES.map((s) => OUTCOME_TOKENS[s].text));

test("every state paints its own base token", () => {
  for (const state of STATES) {
    assert.equal(
      outcomeEdgeToken(state),
      OUTCOME_TOKENS[state].dot,
      `${state} must paint the fill half of its own row in the token table`,
    );
  }
});

test("the edge is a fill and never an ink token", () => {
  for (const state of STATES) {
    const edge = outcomeEdgeToken(state);
    assert.notEqual(edge, OUTCOME_TOKENS[state].text, `${state} painted its own ink token`);
    assert.ok(!INK_TOKENS.has(edge), `${state} painted an ink token: ${edge}`);
  }
  assert.ok(!INK_TOKENS.has(outcomeEdgeToken(null)), "the neutral edge painted an ink token");
});

test("null paints the neutral, and the neutral is no state's hue", () => {
  assert.equal(outcomeEdgeToken(null), OUTCOME_EDGE_NEUTRAL);
  assert.equal(OUTCOME_EDGE_NEUTRAL, "var(--c-edge)");
  for (const state of STATES) {
    assert.notEqual(
      outcomeEdgeToken(null),
      outcomeEdgeToken(state),
      `a card with no grade would be indistinguishable from ${state}`,
    );
  }
});

test("developing and awaiting share a hue, deliberately", () => {
  // NOT AN OVERSIGHT AND NOT A DEFECT. `claim-anatomy.tsx` states it, and
  // `ledger-disclosure-row.tsx` argues the card's boundary exists precisely
  // because no scheme that separates rows by colour could separate these two.
  // Whoever makes them differ is changing a ruling, not fixing a bug.
  assert.equal(outcomeEdgeToken("developing"), outcomeEdgeToken("awaiting"));
});

test("there is no fifth edge token", () => {
  // Four states plus null draw exactly four distinct fills: three semantic
  // hues, two of which are shared, plus the neutral. A fifth value arriving
  // here is a fifth thing a reader can learn to read as a state.
  const drawn = new Set([...STATES.map(outcomeEdgeToken), outcomeEdgeToken(null)]);
  assert.equal(drawn.size, 4, `edge fills drawn: ${[...drawn].join(", ")}`);
  assert.deepEqual(Object.keys(OUTCOME_TOKENS).sort(), [...STATES].sort());
});

test("every edge is a token reference, never a literal a caller could invent", () => {
  // The mapping is the only way a colour reaches the edge, and every value it
  // can produce is a custom property. A hex, an rgb() or a bare keyword landing
  // in the table would fail here before it could reach a card.
  for (const value of [...STATES.map(outcomeEdgeToken), outcomeEdgeToken(null)]) {
    assert.match(value, /^var\(--c-[a-z]+\)$/, `${value} is not a design token reference`);
  }
});

/**
 * THE HALF RUNTIME CANNOT REACH, asserted in the type system instead.
 *
 * `tsconfig.json` includes `tests/**` and `npx tsc --noEmit` is a hard gate, so
 * these are checked on every preflight. They are TYPES rather than calls on
 * purpose: a call with a bad argument would have to execute to be a test, and
 * executing it proves nothing about the contract.
 *
 * Widen the parameter to `string` and both of these stop compiling, which is
 * the point. The closed union is what stops a caller reaching for a hex, for an
 * ink token, or for a fifth hue.
 */
type Assert<T extends true> = T;
type EdgeArg = Parameters<typeof outcomeEdgeToken>[0];

export type EdgeArgIsTheClosedUnionPlusNull = Assert<
  [EdgeArg] extends [OutcomeState | null] ? true : false
>;
export type EdgeArgRejectsARawColour = Assert<
  "var(--c-gold)" extends EdgeArg ? false : true
>;
export type EdgeArgRejectsAFifthWord = Assert<"settled" extends EdgeArg ? false : true>;
