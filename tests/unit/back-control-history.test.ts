// A BACK CHEVRON THAT IS NOT A BACK IS WORSE THAN NO CHEVRON, and this file is
// the only thing that keeps these three from regressing to one.
//
// WHAT WENT WRONG, twice, so a reader knows what is being defended.
//
//   PR 736 moved the Ask pole from /intelligence to /ask and left three mobile
//   screens pointing at the old route. `tests/unit/ask-pole-href.test.ts` is
//   the guard that came out of that: no back control may carry a pole route as
//   a literal.
//
//   PR 740 fixed the literal and shipped HALF the rule. `href={ASK_POLE_HREF}` is
//   correct only for a reader who ARRIVED FROM ASK, and these three screens have
//   more non-Ask entrances than Ask ones:
//
//     /live-feed   dashboard-screen.tsx:381 "The whole feed", ONE TAP from
//                  /dashboard, plus search-data.ts:77
//     /deal-flow   mobile-saved-screen.tsx:82 and :288, search-parts.tsx:345,
//                  search-data.ts:69
//     /trends-mobile  search-data.ts:79
//
//   For every one of those the chevron was a LATERAL JUMP into a directory the
//   reader had never seen. Nothing failed. tsc, lint, the build and the PR 736
//   guard above all passed, because a wrong destination and a right one are the
//   same shape.
//
// THE RULE, and it has exactly one implementation: step back through history
// when there is a history to step through, and fall through to ASK_POLE_HREF
// when there is not. The fallback half is not optional. `history.back()` is a
// NO-OP on the first entry of a tab, which is what `search-screen.tsx:157-161`
// already writes its own fallback for, in a comment that argues the case.
//
// WHAT EACH TEST STOPS:
//
//   1. The decision itself, both directions, on the pure function.
//   2. The modifier-click carve-out, both directions. Cmd-click asks for a NEW
//      context, which has no history, so it must reach the anchor untouched.
//   3. The three screens delegate to `BackHeader` and pass `historyAware`. This
//      is the one that would have caught PR 740 the day it merged.
//   4. No screen hand-rolls the chevron again. Three copies of one anatomy is
//      how one rule came to need fixing in three places; the same shape is how
//      PR 713, PR 721, PR 738 and `slugToCompanyName` each cost a second PR.
//   5. `historyAware` stays OPT-IN, so `mobile-saved-screen.tsx:82` keeps
//      meaning what it means: Saved to Deal Flow is a deliberate lateral link
//      with its destination in its own label, not a back.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPlainLeftClick, shouldStepBack } from "../../src/components/mobile/history-back";

/* The three screens that draw a back control labelled Ask, and the file each
   one's back row must now come from. */
const ASK_BACK_SCREENS = [
  "src/components/deals-mobile/deals-screen.tsx",
  "src/components/feed/mobile/feed-mobile-screen.tsx",
  "src/components/trends-mobile/trends-screen.tsx",
];

const BACK_HEADER = "src/components/mobile/screen-chrome.tsx";

/* The chevron the design draws. Verbatim from the prototype path data, which is
   what every one of the three copies carried. */
const CHEVRON_PATH = "M15 6l-6 6 6 6";

const read = (file: string) => readFileSync(file, "utf8");

test("the decision fires only when there is a history to step back through", () => {
  /* Entry one of a tab. `back()` here does nothing at all, and on a screen that
     draws no other exit that is a dead control. */
  assert.equal(shouldStepBack(1), false);
  /* Two entries means the reader came from somewhere, whatever it was. */
  assert.equal(shouldStepBack(2), true);
  assert.equal(shouldStepBack(17), true);
  /* Server render and any environment without a window. */
  assert.equal(shouldStepBack(undefined), false);
  /* Not reachable from a live browser, and it must not read as "go back". */
  assert.equal(shouldStepBack(0), false);
});

test("modified and non-primary clicks are left to the browser", () => {
  const plain = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  assert.equal(isPlainLeftClick(plain), true);
  /* Each modifier on its own, so a carve-out that silently stopped matching
     would fail rather than pass. */
  assert.equal(isPlainLeftClick({ ...plain, metaKey: true }), false);
  assert.equal(isPlainLeftClick({ ...plain, ctrlKey: true }), false);
  assert.equal(isPlainLeftClick({ ...plain, shiftKey: true }), false);
  assert.equal(isPlainLeftClick({ ...plain, altKey: true }), false);
  /* Middle-click opens a new tab, which has no history of its own. */
  assert.equal(isPlainLeftClick({ ...plain, button: 1 }), false);
  assert.equal(isPlainLeftClick({ ...plain, defaultPrevented: true }), false);
});

test("the history rule has exactly one implementation, in BackHeader", () => {
  const chrome = read(BACK_HEADER);
  assert.ok(
    chrome.includes("shouldStepBack("),
    `${BACK_HEADER} must call shouldStepBack; it is the only place the rule may live`,
  );
  assert.ok(
    chrome.includes("router.back()"),
    `${BACK_HEADER} must actually step back when the rule says so`,
  );

  /* And nowhere else among the screens that use it. A second copy is the exact
     failure mode this repo has paid for five times. */
  for (const file of ASK_BACK_SCREENS) {
    const source = read(file);
    assert.ok(
      !source.includes("router.back()"),
      `${file} implements its own back. The rule lives in ${BACK_HEADER}, once.`,
    );
    assert.ok(
      !source.includes("history.length"),
      `${file} reads history.length itself. The rule lives in ${BACK_HEADER}, once.`,
    );
  }
});

test("all three Ask back controls are history-aware, not a fixed href", () => {
  const offenders: string[] = [];

  for (const file of ASK_BACK_SCREENS) {
    const source = read(file);
    /* Comments in these files discuss `historyAware` at length, so the assertion
       is on the JSX prop and not on the word. */
    if (!/<BackHeader\b[^>]*\bhistoryAware\b/.test(source)) {
      offenders.push(
        `${file} draws a back control that always lands on the Ask pole, ` +
          `which is a lateral jump for every reader who did not arrive from Ask`,
      );
    }
    /* The destination is still the pole and still a prop, so
       tests/unit/ask-pole-href.test.ts keeps seeing the call site. */
    if (!source.includes("ASK_POLE_HREF")) {
      offenders.push(`${file} lost its ASK_POLE_HREF fallback`);
    }
  }

  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("no screen hand-rolls the back chevron beside the shared one", () => {
  const offenders: string[] = [];

  for (const file of ASK_BACK_SCREENS) {
    if (read(file).includes(CHEVRON_PATH)) {
      offenders.push(
        `${file} draws its own chevron. Import BackHeader from ` +
          `@/components/mobile so the history rule reaches it.`,
      );
    }
  }

  assert.deepEqual(offenders, [], offenders.join("\n"));
  /* The shared one must still draw it, or the loop above passes vacuously the
     day the chevron moves and nothing renders a back control at all. */
  assert.ok(
    read(BACK_HEADER).includes(CHEVRON_PATH),
    `${BACK_HEADER} no longer draws the chevron, so the check above proves nothing`,
  );
});

test("historyAware is opt-in, so the lateral BackHeader call sites still mean it", () => {
  const chrome = read(BACK_HEADER);
  assert.ok(
    /historyAware\s*=\s*false/.test(chrome),
    "historyAware must default to false. Saved's 'Back to Deal Flow', Alerts' " +
      "and Learned's 'Settings' and Settings' 'Ledger' each NAME their " +
      "destination, and mobile-saved-screen.tsx:82 is a deliberate lateral " +
      "link rather than a back. Defaulting to history would make all four lie.",
  );

  const saved = read("src/components/saved/mobile-saved-screen.tsx");
  assert.ok(
    /<BackHeader\s+href="\/deal-flow"\s+label="Back to Deal Flow"\s*\/>/.test(saved),
    "Saved's lateral link to Deal Flow changed shape; it must stay a plain destination",
  );
  assert.ok(
    !/<BackHeader\b[^>]*\bhistoryAware\b/.test(saved),
    "Saved is reached from the tab bar, so its previous entry is usually some " +
      "other pole. A back there would not be 'Back to Deal Flow'.",
  );
});
