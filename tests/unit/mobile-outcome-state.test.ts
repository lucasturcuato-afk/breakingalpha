// The mobile outcome vocabulary is closed at four words, and Radar's Calls
// section may not open it.
//
// WHY THIS FILE EXISTS. Radar's Calls section reuses the desk's judgement
// (`scoredCallProps`, `claimCardProps`) and NOT the desk's words. The desk
// renders a confounded call as "No clean read", which is a fifth word. On a
// phone the set is fixed at supported / challenged / developing / awaiting by
// `OUTCOME_STATES` in `claim-anatomy.tsx`, and the whole point of a closed set
// is that a fifth member cannot arrive without that file changing.
//
// The bridge that keeps both true is `src/lib/mobile-outcome-state.ts`. It is
// one small function, which is exactly the kind of thing a later edit
// "simplifies" by mapping the state straight to a label. This file is what makes
// that red.
//
// THE `notGraded` CASE IS THE ONE THAT MATTERS. It gives back null, and null is
// NOT "awaiting". Awaiting means a call still inside its window and a verdict on
// its way; a not-graded call is one where no credible grade exists and none ever
// will. Mapping it to Awaiting tells a reader a verdict is coming that is not.
// `deskRecordToScreenData` reached the same conclusion and drops those rows from
// the record's list; Calls cannot drop them, because they are the reader's own
// claims, so it renders them with no state word at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileOutcomeState } from "../../src/lib/mobile-outcome-state.ts";
import { RESOLUTION_BY_STATE } from "../../src/lib/verdict-vocabulary.ts";
import { OUTCOME_STATES } from "../../src/components/ledger/claim-anatomy";
import type { ScoredState } from "../../src/components/scored-object/ScoredObject";

/* DERIVED, NOT LISTED, and that is deliberate twice over.
   `RESOLUTION_BY_STATE` is keyed by every `ScoredState` and is exhaustive by
   construction, so a sixth state added to the scored object is covered by every
   test below on the day it lands rather than silently skipped by a list nobody
   updated. It also keeps two of the desk's state ids, which are among the words
   the outcome-vocabulary rule bans, out of a file that has no reason to render
   them. */
const ALL_STATES = Object.keys(RESOLUTION_BY_STATE) as ScoredState[];

test("the mobile set is exactly the four closed words", () => {
  assert.deepEqual([...OUTCOME_STATES], ["supported", "challenged", "developing", "awaiting"]);
});

test("every scored state maps into the closed set, or to nothing", () => {
  for (const state of ALL_STATES) {
    const word = mobileOutcomeState(state);
    if (word === null) continue;
    assert.ok(
      (OUTCOME_STATES as readonly string[]).includes(word),
      `${state} produced "${word}", which is not one of the four`,
    );
  }
});

test("a confounded call reads Developing, never a fifth word", () => {
  // This is the one place the phone and the desk deliberately differ. The desk
  // says "No clean read"; the mobile record's own count strip already says
  // Developing for the same bucket, and Calls has to agree with the record it
  // sits beside.
  assert.equal(mobileOutcomeState("inconclusive"), "developing");
});

test("an open call is Awaiting", () => {
  // `RESOLUTION_BY_STATE` maps open to notGraded to stay exhaustive, with a
  // comment saying a row with an outcome never maps to open. On this surface
  // open is the common case: a call inside its window has no outcome row yet.
  assert.equal(mobileOutcomeState("open"), "awaiting");
});

test("a not-graded call gets no word at all", () => {
  assert.equal(mobileOutcomeState("notGraded"), null);
});

test("every resolution keeps its meaning across the two vocabularies", () => {
  // Driven off the shared resolution table rather than off state ids, so this
  // asserts the property that matters: whatever the desk decided a call
  // resolved to, the phone says the same thing in its own closed vocabulary.
  const EXPECTED = {
    supported: "supported",
    challenged: "challenged",
    noCleanRead: "developing",
    notGraded: null,
  } as const;

  for (const state of ALL_STATES) {
    // `open` is the one state that does not travel through the table; it has
    // its own test above.
    if (state === "open") continue;
    assert.equal(
      mobileOutcomeState(state),
      EXPECTED[RESOLUTION_BY_STATE[state]],
      `${state} resolved to ${RESOLUTION_BY_STATE[state]} and the phone drew the other word`,
    );
  }
});
