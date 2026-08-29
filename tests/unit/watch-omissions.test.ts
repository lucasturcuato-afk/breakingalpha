// Unit tests for the omission copy Radar states on screen
// (src/components/watch/omissions.ts).
//
// WHY A UNIT TEST AND NOT A BROWSER SPEC. `/watch` is a server component and
// its copy is static, so the only thing a browser could add here is a second
// place for the same strings to be typed. What needs enforcing is not that the
// strings render, it is what they are ALLOWED TO SAY, and that is a property of
// the constant.
//
// THE RULE LOCKED HERE:
//
//   an omission states WHAT is absent and WHY        -> both halves non-empty
//   a reason is about the PRODUCT, never the READER  -> no second person
//   the four omitted things each keep a reason       -> deleting one is red
//   the tracked-views reason does not rest on the
//   retracted "no headline source" premise           -> named explicitly
//
// The second one is the whole ruling. "You have no tracked views yet" is an
// empty state, needs a read behind it, and there is none; "the tier draws
// claims that carry no direction and no window" is a reason, needs no read, and
// is true whatever the reader has. Without this test the distinction survives
// only as care, and it is exactly the distinction three shipped empty states
// got wrong (see `src/app/watch/page.tsx`).
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

test("every omission states both what is absent and why", () => {
  assert.ok(WATCH_OMISSIONS.length > 0, "an empty list is a screen that states no reason at all");
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

test("each of the four omitted things keeps a stated reason", () => {
  // Named individually rather than counted, so removing one and adding an
  // unrelated one is red rather than green.
  const ids = new Set(WATCH_OMISSIONS.map((o) => o.id));
  for (const required of ["tracked-views", "lead-story", "theme-names", "staleness"]) {
    assert.ok(ids.has(required), `${required} is omitted from the screen and states no reason`);
  }
});

test("the tracked-views reason is the measured one, not the retracted one", () => {
  const o = WATCH_OMISSIONS.find((x) => x.id === "tracked-views");
  assert.ok(o);
  // The reason recorded for two releases was that `TrackedView.headline` had
  // no source. `sql/0012_radar_user_claims.sql:10-11` says `user_claim` IS the
  // headline, `/radar/calls` renders it as one, and `src/lib/review-data.ts`
  // already reads it that way. That premise is retracted and must not come
  // back through this string.
  assert.ok(
    !/headline/i.test(o.reason),
    "the headline premise was measured wrong and was retracted; see omissions.ts",
  );
  // What IS measured: no claim carries a null direction or a null window, so
  // the row shape this tier is defined around does not exist.
  assert.match(o.reason, /direction/i);
  assert.match(o.reason, /window/i);
});

test("the reasons are rendered by the screen rather than kept as comments", () => {
  // A reason in a constant that nothing draws is the state this unit was built
  // to end: the reasons lived in comments and PR bodies, and a recon measured
  // no string about any omitted thing anywhere on the rendered screen. If the
  // render is deleted the import goes with it and this goes red.
  const screen = readFileSync("src/components/watch/watch-screen.tsx", "utf8");
  // BOTH halves, and the first draft asserted only the second. Deleting
  // `<OmittedNotes />` from the tree while leaving the function defined left
  // `WATCH_OMISSIONS` in the file and this test green, which is a test that
  // passes both ways. The element is what makes the reasons rendered.
  assert.match(screen, /<OmittedNotes\s*\/>/, "the block is defined but nothing draws it");
  assert.match(screen, /WATCH_OMISSIONS/, "the block draws something other than the reasons");
});
