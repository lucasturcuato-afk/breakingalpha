// The grouping rule and the two resolution sentences, now that two surfaces
// draw them.
//
// WHY THIS FILE EXISTS. Every declaration in `src/lib/radar-calls-model.ts` was
// module-private inside `src/app/radar/calls/page.tsx`, a 1100-line client
// component, and was therefore untestable without a browser. Radar's Calls
// section on a phone draws the same groups and states the same resolution
// rules, so the alternative to lifting them was a second copy that would drift.
//
// THE SENTENCES ARE THE HALF WORTH LOCKING. `briefResolutionSentence` states
// the grading contract in prose: "only a move beyond sector and market counts".
// Two surfaces drifting on a card's padding is a design inconsistency. Two
// surfaces drifting on that sentence is the product describing its own grader
// two different ways, to the same reader, on the same account.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefResolutionSentence,
  groupBriefCalls,
  groupSlug,
  resolutionSentence,
  type BriefCallRow,
  type UserClaim,
} from "../../src/lib/radar-calls-model.ts";

function call(over: Partial<BriefCallRow>): BriefCallRow {
  return {
    id: "c1",
    claim_text: "A claim.",
    claim_type: "ticker",
    target_symbol: "NVDA",
    brief_date: "2026-08-20",
    resolve_on: null,
    created_at: "2026-08-20T12:00:00Z",
    confidence: null,
    ...over,
  };
}

function claim(over: Partial<UserClaim>): UserClaim {
  return {
    id: "u1",
    user_claim: "In my own words.",
    claim_type: "ticker",
    target_symbol: "NVDA",
    expected_direction: "bullish",
    resolution_window_start: null,
    resolution_window_end: "2026-09-01",
    gradeable: true,
    gradeability_note: null,
    status: "open",
    source: "authored",
    adopted_from_call_id: null,
    created_at: "2026-08-20T12:00:00Z",
    ...over,
  };
}

test("a ticker with a known sector lands under that sector", () => {
  const groups = groupBriefCalls([call({ id: "a", target_symbol: "NVDA" })], {
    NVDA: "Semiconductors",
  });
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Semiconductors"],
  );
});

test("a ticker with no resolved sector is not guessed into one", () => {
  // The honest bucket. Inventing a sector for a name the companies table does
  // not carry would put a fact on the screen nothing read.
  const groups = groupBriefCalls([call({ id: "a", target_symbol: "ZZZZ" })], {});
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Single names"],
  );
});

test("the four non-ticker types keep their own buckets", () => {
  const groups = groupBriefCalls(
    [
      call({ id: "a", claim_type: "sector" }),
      call({ id: "b", claim_type: "index" }),
      call({ id: "c", claim_type: "aggregate" }),
      call({ id: "d", claim_type: "something-else" }),
    ],
    {},
  );
  assert.deepEqual(
    [...groups.map((g) => g.label)].sort(),
    ["Indices", "Macro", "Other", "Sector calls"],
  );
});

test("groups are ordered by size, largest first", () => {
  const groups = groupBriefCalls(
    [
      call({ id: "a", claim_type: "index" }),
      call({ id: "b", claim_type: "sector" }),
      call({ id: "c", claim_type: "sector" }),
    ],
    {},
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Sector calls", "Indices"],
  );
});

test("group ids are slugs a DOM id can carry", () => {
  assert.equal(groupSlug("Single names"), "single-names");
  assert.equal(groupSlug("Health Care & Pharma"), "health-care-pharma");
});

test("a call with a real horizon states its real window", () => {
  const s = briefResolutionSentence(call({ brief_date: "2026-08-20", resolve_on: "2026-08-27" }));
  assert.match(s, /Resolves over 2026-08-20 to 2026-08-27/);
  assert.match(s, /only a move beyond sector and market counts/);
});

test("a pre-horizons call does not imply a window it does not have", () => {
  const s = briefResolutionSentence(call({ resolve_on: null }));
  assert.match(s, /against the 2026-08-20 market close/);
  assert.doesNotMatch(s, /Resolves over/);
});

test("a context-only claim states its own honest note", () => {
  const s = resolutionSentence(
    claim({ gradeable: false, gradeability_note: "Not price-gradeable as written." }),
  );
  assert.equal(s, "Not price-gradeable as written.");
});

test("a gradeable single name is graded against its sector and the market", () => {
  const s = resolutionSentence(claim({ claim_type: "ticker" }));
  assert.match(s, /beats its sector ETF and SPY/);
  assert.match(s, /a move the market explains is not credited/);
});

test("an index is graded on its absolute move, not against a benchmark", () => {
  const s = resolutionSentence(claim({ claim_type: "index", target_symbol: "SPX" }));
  assert.match(s, /indices are graded on their absolute move/);
  assert.doesNotMatch(s, /beats its sector ETF/);
});

/* THE BANNED-SUBSTRING CHECK ON THESE SENTENCES LIVES IN `design:lint`, NOT
   HERE, and this note is why, so nobody adds it back.

   A test asserting that no sentence contains a banned position word has to
   write those words down to check for them, which makes the test file an error
   under the rule it is checking. The first draft of this file did exactly that
   and `design:lint` reported six errors against it. `scripts/design-lint.mjs`
   already scans `radar-calls-model.ts` for the whole list on every added line,
   in comments and identifiers as well as in copy, which is strictly more than a
   test here could check. One owner for the rule, and the linter is it.

   What DID change under that rule is recorded here instead, because the diff
   alone does not explain it: the neutral direction phrase in
   `resolutionSentence` was reworded when it moved into a shared module, since
   the desk's original wording carried a banned substring. Same meaning, and the
   sentence assertions above pin the wording that shipped. */
