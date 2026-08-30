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
  // What earns it its place is that the screen renders dated claims off rows
  // whose refresh time nothing records. The copy has to keep naming both halves,
  // because a reason that stops saying the readings are undated stops
  // correcting anything.
  assert.match(o.reason, /refresh/i);
  assert.match(o.reason, /date/i);
});

test("the staleness claim is scoped to the desk and is not a product-wide negative", () => {
  const o = WATCH_OMISSIONS.find((x) => x.id === "staleness");
  assert.ok(o);
  // THE STRING PR #731 SHIPPED WAS FALSE, and this is the only note kept on
  // honesty grounds, so it does not get to be the loosest claim on the screen.
  // "Nothing records when the last pass ran" is a product-wide negative and run
  // times ARE recorded: `articles.fetched_at` is read by this very loader to
  // build `lastCheckedLabel`, and `sql/0028_ingest_observability.sql:82-84`
  // creates `ingest_run_stats.run_started_at`, one row per ingest run.
  // `src/lib/watch-data.ts:68` had the accurate version all along and scopes it
  // to a given desk: what is missing is a per-desk refresh record.
  assert.ok(
    !/\bthe last pass ran\b/i.test(o.reason),
    "the product-wide negative is false; scope the claim to this desk's rows",
  );
  // The scope is what makes it true, so the scope is pinned rather than left to
  // care. "these rows" / "this desk" both read as the reader's own set.
  assert.match(o.reason, /\b(these rows|this desk)\b/i);
});

test("the surviving reason is rendered by the screen rather than kept as a comment", () => {
  // A reason in a constant that nothing draws is the state this unit was built
  // to end: the reasons lived in comments and PR bodies, and a recon measured
  // no string about any omitted thing anywhere on the rendered screen.
  //
  // THIS ASSERTION HAS PASSED BOTH WAYS TWICE, in two different shapes, and
  // both are closed here.
  //
  //   1. The first draft asserted only the constant. Deleting `<OmittedNotes />`
  //      from the tree while leaving the function defined kept `WATCH_OMISSIONS`
  //      in the file and the test green. Closed by asserting the ELEMENT.
  //   2. `assert.match(screen, /WATCH_OMISSIONS/)` is satisfied by the IMPORT
  //      LINE ALONE, so gutting `OmittedNotes` to `return null` with the element
  //      and the import intact kept all eight tests green, tsc at 0, and cost
  //      one eslint warning. The comment here claimed that hole was closed. It
  //      closed the element-deleted case, not the element-draws-nothing case.
  //      Closed by pinning the ITERATION, inside the function that does it.
  const screen = readFileSync("src/components/watch/watch-screen.tsx", "utf8");
  assert.match(screen, /<OmittedNotes\s*\/>/, "the block is defined but nothing draws it");

  // Scoped to the function body rather than the whole file, so a dead
  // `WATCH_OMISSIONS.map(` left anywhere else cannot stand in for the render.
  const start = screen.indexOf("function OmittedNotes(");
  assert.ok(start !== -1, "OmittedNotes is gone; the reason has nothing drawing it");
  const rest = screen.slice(start);
  const end = rest.indexOf("\nfunction ", 1);
  const body = end === -1 ? rest : rest.slice(0, end);
  assert.match(
    body,
    /WATCH_OMISSIONS\.map\(/,
    "OmittedNotes draws something other than the reasons, or draws nothing at all",
  );
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
