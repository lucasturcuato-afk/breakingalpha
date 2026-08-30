// Unit tests for the omission mechanism Radar keeps and does not currently use
// (src/components/watch/omissions.ts).
//
// WHY A UNIT TEST AND NOT A BROWSER SPEC. `/watch` is a server component and
// its copy is static, so the only thing a browser could add here is a second
// place for the same strings to be typed. What needs enforcing is WHICH
// absences are allowed to speak, what they are ALLOWED TO SAY, and that the
// mechanism carrying them survives being empty. All three are properties of the
// constant and of the source that draws it.
//
// THE RULE LOCKED HERE, given 2026-08-29: "The app must never assert something
// false, but it does not have to enumerate everything absent. Omit silently
// unless absence would mislead." That NARROWS the rule this file first shipped
// under (PR #731: every omitted tier states its reason on screen). The honesty
// half is untouched; the enumeration half is now conditional.
//
// Applied per entry, all four absences went silent:
//
//   tracked-views  no figure counts claims, nothing names a third tier, no
//                  rendered line becomes wrong without the note.
//   lead-story     every entry renders as the same card, so no rank is implied
//                  and none is then missing.
//   theme-names    `ThemeCluster` already draws no heading where there is no
//                  label; the rows read as the list they are.
//   staleness      PASSED the misleading test and went anyway, on the owner's
//                  ruling that it is a CAPTION ON A WRONG SENTENCE. "No news
//                  today" is said off a store the screen cannot date, and a
//                  footnote saying nothing is dated does not make it true. The
//                  fix is issue #748, which makes the `stale` branch reachable
//                  so the screen says when it last checked. That is a screen
//                  change, not a copy change.
//
// SO THE EMPTY LIST IS THE ASSERTION, and it is pinned in both directions:
// empty by equality, and each of the four ids named individually, because "the
// notes were dropped by accident" is the mistake the next reader is most likely
// to make. Restoring one on the old reasoning is red.
//
// AND THE MECHANISM IS PINNED SEPARATELY FROM THE DATA. The owner's instruction
// is to keep it: "keep the mechanism with an empty array and a comment saying
// why, rather than deleting it. issue #748 will make the stale branch reachable and
// something will need to render." A suite that passes whether or not
// `OmittedNotes` survives would let the next refactor quietly delete the thing
// issue #748 is going to need. So:
//
//   the list is empty                              -> equality, not length > 0
//   the four ids stay out                          -> named individually
//   `OmittedNotes` still exists and is in the tree  -> asserted on the element
//   it still iterates the constant                  -> the map, inside the body
//   it draws NOTHING while the list is empty        -> the guard, before the
//                                                      section it guards
//
// The reader/product distinction is the half of PR #731 that did not move, and
// it still decides any copy that comes back. "You have no tracked views yet" is
// an empty state, needs a read behind it, and there is none; "this tier draws
// claims carrying no direction and no window" is a reason and needs none. It is
// exactly the distinction three shipped empty states missed (see
// `src/app/watch/page.tsx`).
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

/** Second person, in every form any future copy could reach for. */
const READER = /\b(you|your|yours|yourself)\b/i;

/** Silenced by the narrowed ruling. Restoring one is a regression, not a fix. */
const DROPPED = ["tracked-views", "lead-story", "theme-names", "staleness"];

const SCREEN = () => readFileSync("src/components/watch/watch-screen.tsx", "utf8");

/** The body of `OmittedNotes`, so a stray match elsewhere cannot stand in. */
function omittedNotesBody(): string {
  const screen = SCREEN();
  const start = screen.indexOf("function OmittedNotes(");
  assert.ok(start !== -1, "OmittedNotes is gone; issue #748 needs it to still be here");
  const rest = screen.slice(start);
  const end = rest.indexOf("\nfunction ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

test("the list is empty, because all four absences are silent now", () => {
  // Equality rather than a length check, so adding an entry back is red and has
  // to argue for itself against the header in omissions.ts.
  assert.deepEqual(WATCH_OMISSIONS, []);
});

test("none of the four narrowed-away absences comes back", () => {
  // Named individually rather than counted. All four were correct copy under
  // the rule that preceded this one, which is exactly why someone will be
  // tempted to put them back as a lost-in-a-refactor fix. They were not lost.
  //
  // Staleness is the one to watch. Its argument ("the quiet line is undated")
  // is still TRUE and is still not sufficient: the owner ruled the note is a
  // caption on a wrong sentence and that issue #748 is the fix. Do not restore it on
  // the old reasoning.
  const ids = new Set(WATCH_OMISSIONS.map((o) => o.id));
  for (const gone of DROPPED) {
    assert.ok(!ids.has(gone), `${gone} was narrowed away by the 2026-08-29 ruling`);
  }
});

test("any entry that ever comes back still states what is absent and why", () => {
  // Vacuous today, and deliberately kept rather than deleted: it is the shape
  // check that whatever issue #748 adds will meet on the way in, and a rule
  // that only exists while it has data gets rediscovered the hard way.
  for (const o of WATCH_OMISSIONS) {
    assert.ok(o.absent.trim().length > 0, `${o.id}: names nothing`);
    assert.ok(o.reason.trim().length >= 40, `${o.id}: reason is too short to be one`);
    assert.ok(!READER.test(o.absent), `${o.id}: names the reader in "${o.absent}"`);
    assert.ok(!READER.test(o.reason), `${o.id}: addresses the reader in "${o.reason}"`);
  }
  const ids = WATCH_OMISSIONS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
});

test("the mechanism survives being empty: OmittedNotes exists and is in the tree", () => {
  // THE OWNER'S INSTRUCTION IS THAT THIS SURVIVES. An empty array is not a
  // reason to delete the component, because issue #748 makes the stale branch
  // reachable and something will need to render here. Without this assertion a
  // tidy-up that removes "dead code" is green.
  assert.match(SCREEN(), /<OmittedNotes\s*\/>/, "the render site is gone; issue #748 needs it");
  assert.match(omittedNotesBody(), /^function OmittedNotes\(/, "OmittedNotes is not a function");
});

test("the mechanism still iterates the constant rather than hardcoding copy", () => {
  // THIS ASSERTION HAS PASSED BOTH WAYS TWICE, in two different shapes, and
  // both are closed here.
  //
  //   1. The first draft asserted only the constant. Deleting `<OmittedNotes />`
  //      from the tree while leaving the function defined kept `WATCH_OMISSIONS`
  //      in the file and the test green. Closed by asserting the ELEMENT above.
  //   2. `assert.match(screen, /WATCH_OMISSIONS/)` is satisfied by the IMPORT
  //      LINE ALONE, so gutting `OmittedNotes` to `return null` with the element
  //      and the import intact kept every test green, tsc at 0, and cost one
  //      eslint warning. Closed by pinning the ITERATION, inside the function
  //      that does it.
  //
  // The distinction that matters now that the array is empty: a component that
  // returns null BECAUSE THE LIST IS EMPTY is the mechanism working, and a
  // component that returns null unconditionally is the mechanism gone. The
  // `.map` is what tells them apart, so it is what is pinned.
  assert.match(
    omittedNotesBody(),
    /WATCH_OMISSIONS\.map\(/,
    "OmittedNotes no longer draws the constant; it cannot render what issue #748 adds",
  );
});

test("it draws nothing at all while the list is empty", () => {
  // NOT AN EMPTY CONTAINER, not a stray margin, not a hairline rule over a
  // heading with no content under it. `.map` over an empty array is not enough:
  // the `section` around it still renders its 26px margin, its border and its
  // "NOT SHOWN HERE" heading, which is a section rule promising a tier that is
  // not there. So the empty case is an explicit guard.
  const body = omittedNotesBody();

  // ANCHORED TO ITS OWN LINE AT THE FUNCTION'S TOP LEVEL, and that is the whole
  // strength of this assertion. A loose `.search(/if \(...\) return null;/)`
  // passed both ways: wrapping the guard in
  // `const dead = () => { if (WATCH_OMISSIONS.length === 0) return null; };`
  // leaves the text present, above the section, and completely inert, and the
  // suite went green on it. Two spaces of indent and end-of-line pin it as a
  // STATEMENT IN THE BODY rather than a string that appears in the file. A
  // nested copy is indented deeper; a wrapped copy does not start the line.
  const guard = body.search(/^ {2}if \(WATCH_OMISSIONS\.length === 0\) return null;$/m);
  assert.ok(guard !== -1, "no empty guard: the block draws a rule and a heading over nothing");

  // REACHABLE. A guard after an earlier `return` is text, not behaviour.
  assert.ok(
    !/\breturn\b/.test(body.slice(0, guard)),
    "the empty guard is unreachable; an earlier exit sits above it",
  );

  // BEFORE the thing it guards, so moving it below the section is red rather
  // than green-and-dead.
  const section = body.indexOf("<section");
  assert.ok(section !== -1, "OmittedNotes draws no section at all");
  assert.ok(guard < section, "the empty guard sits after the element it is supposed to prevent");
});

test("the block still stands down in the one stage that dates the readings", () => {
  // Currently guarding nothing, and kept on purpose. issue #748 is the work that
  // refills the array AND the work that makes this screen date its own
  // readings, so the note most likely to come back is the one most likely to
  // collide with the "Last checked <time>" line the stale notice draws above
  // it. The gate is note-specific and has to be re-decided against whatever
  // issue #748 adds; see the comment at the render site.
  assert.match(
    SCREEN(),
    /\{stale \? null : <OmittedNotes \/>\}/,
    "the stale gate is gone; re-read the render site before removing it",
  );
});
