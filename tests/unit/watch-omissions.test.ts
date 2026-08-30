// Unit tests for the omission copy Radar states on screen
// (src/components/watch/omissions.ts).
//
// WHY A UNIT TEST AND NOT A BROWSER SPEC. `/watch` is a server component and
// its copy is static, so the only thing a browser could add here is a second
// place for the same strings to be typed. What needs enforcing is not that the
// strings render, it is WHICH absences are allowed to speak and what they are
// ALLOWED TO SAY, and both are properties of the constant.
//
// THE RULE LOCKED HERE, given 2026-08-29: "The app must never assert something
// false, but it does not have to enumerate everything absent. Omit silently
// unless absence would mislead." That NARROWS the rule this file first shipped
// under (PR #731: every omitted tier states its reason on screen). The honesty
// half is untouched; the enumeration half is now conditional.
//
// Applied per entry, three of the four absences went silent and one stayed:
//
//   tracked-views  dropped. No figure counts claims, nothing names a third
//                  tier, no rendered line becomes wrong without the note.
//   lead-story     dropped. Every entry renders as the same card, so no rank
//                  is implied and none is then missing.
//   theme-names    dropped. `ThemeCluster` already draws no heading where there
//                  is no label; the rows read as the list they are.
//   staleness      KEPT. The screen renders dated claims off an undated store,
//                  so silence would let "No news today" read as a check made
//                  today, which is a check the product did not make.
//
// SO THE SET ITSELF IS THE ASSERTION, in both directions. Deleting the survivor
// is red, and so is restoring any of the three, because "the notes were dropped
// by accident" is the mistake the next reader is most likely to make.
//
//   the survivor states WHAT is absent and WHY       -> both halves non-empty
//   a reason is about the PRODUCT, never the READER  -> no second person
//   the three dropped absences stay silent           -> named individually
//   the block is drawn, and stands down where it
//   would contradict the line above it               -> asserted on the element
//
// The reader/product distinction is the half of PR #731 that did not move. "You
// have no tracked views yet" is an empty state, needs a read behind it, and
// there is none; "nothing records when the last pass ran" is a reason, needs no
// read, and is true whatever the reader has. It is exactly the distinction
// three shipped empty states missed (see `src/app/watch/page.tsx`).
//
// WHAT IS DELIBERATELY NOT ASSERTED HERE: the closed compliance vocabulary.
// `npm run design:lint` already reads `src/components/watch/omissions.ts` and
// fails on it, and restating that list in this file would put every one of the
// banned substrings into a second source file for the linter to find.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WATCH_OMISSIONS } from "../../src/components/watch/omissions.ts";

/** Second person, in every form the copy could reach for. */
const READER = /\b(you|your|yours|yourself)\b/i;

/** Silenced by the narrowed ruling. Restoring one is a regression, not a fix. */
const DROPPED = ["tracked-views", "lead-story", "theme-names"];

test("every omission states both what is absent and why", () => {
  assert.ok(WATCH_OMISSIONS.length > 0, "an empty list is a mechanism with no consumers");
  for (const o of WATCH_OMISSIONS) {
    assert.ok(o.absent.trim().length > 0, `${o.id}: names nothing`);
    assert.ok(o.reason.trim().length > 0, `${o.id}: gives no reason`);
    // A reason is a sentence, not a label. The bar is low on purpose; it is
    // here to catch a stub, not to judge prose.
    assert.ok(o.reason.trim().length >= 40, `${o.id}: reason is too short to be one`);
  }
});

test("no omission is a sentence about the reader", () => {
  for (const o of WATCH_OMISSIONS) {
    assert.ok(!READER.test(o.absent), `${o.id}: names the reader in "${o.absent}"`);
    assert.ok(!READER.test(o.reason), `${o.id}: addresses the reader in "${o.reason}"`);
  }
});

test("ids are unique, so one omission cannot quietly shadow another", () => {
  const ids = WATCH_OMISSIONS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("the surviving set is exactly the one absence whose silence would mislead", () => {
  // Equality rather than a membership check, so this is red both when the
  // survivor is deleted and when an unrelated entry is added beside it.
  assert.deepEqual(
    WATCH_OMISSIONS.map((o) => o.id),
    ["staleness"],
  );
});

test("the three narrowed-away absences stay silent", () => {
  // Named individually rather than counted. They were correct copy under the
  // rule that preceded this one, which is exactly why someone will be tempted
  // to put them back as a lost-in-a-refactor fix. They were not lost.
  const ids = new Set(WATCH_OMISSIONS.map((o) => o.id));
  for (const gone of DROPPED) {
    assert.ok(!ids.has(gone), `${gone} was narrowed away by the 2026-08-29 ruling`);
  }
});

test("the staleness reason is about the undated store, not about the reader's day", () => {
  const o = WATCH_OMISSIONS.find((x) => x.id === "staleness");
  assert.ok(o, "the survivor is gone; see omissions.ts before restoring anything");
  // What earns it its place is that the screen renders dated claims off a store
  // whose fill time nothing records. The copy has to keep saying that, because
  // a reason that stops naming the undated pass stops correcting anything.
  assert.match(o.reason, /pass/i);
  assert.match(o.reason, /date/i);
});

test("the surviving reason is rendered by the screen rather than kept as a comment", () => {
  // A reason in a constant that nothing draws is the state this unit was built
  // to end: the reasons lived in comments and PR bodies, and a recon measured
  // no string about any omitted thing anywhere on the rendered screen. If the
  // render is deleted the import goes with it and this goes red.
  const screen = readFileSync("src/components/watch/watch-screen.tsx", "utf8");
  // BOTH halves, and the first draft asserted only the second. Deleting
  // `<OmittedNotes />` from the tree while leaving the function defined left
  // `WATCH_OMISSIONS` in the file and the old test green, which is a test that
  // passes both ways. The element is what makes the reason rendered.
  assert.match(screen, /<OmittedNotes\s*\/>/, "the block is defined but nothing draws it");
  assert.match(screen, /WATCH_OMISSIONS/, "the block draws something other than the reason");
});

test("the block stands down in the one stage that dates the readings", () => {
  // At `?stage=stale` the screen draws "Last checked <time>" above this block.
  // A foot note saying it never dates the readings above, under a line that
  // just dated them, is a false assertion, and the ruling loosened enumeration
  // rather than honesty. The gate is on the stage, not on the reader's data.
  const screen = readFileSync("src/components/watch/watch-screen.tsx", "utf8");
  assert.match(
    screen,
    /\{stale \? null : <OmittedNotes \/>\}/,
    "the omission block is drawn in a stage where the screen contradicts it",
  );
});
