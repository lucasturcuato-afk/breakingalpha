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

test("the decision fires only when a page of OURS is behind this one", () => {
  /* Every case below is a MEASURED navigation.currentEntry.index from the
     production-build walk in the PR body, not an invented number.

     ARRIVED FROM A FOREIGN ORIGIN, no in-app navigation yet. This is the one
     that ejected the reader out of Signalera when the rule asked
     `history.length > 1` instead: length was 2 and the entry behind us was
     Slack. entries() is same-origin and contiguous by spec, so the foreign page
     is not in it and the index is 0. */
  assert.equal(shouldStepBack({ index: 0 }), false);

  /* Cold entry, history.length === 1. Same answer, same reason. */
  assert.equal(shouldStepBack({ index: 0 }), false);

  /* One in-app hop later. Now there is a page of ours behind us. */
  assert.equal(shouldStepBack({ index: 1 }), true);
  assert.equal(shouldStepBack({ index: 9 }), true);

  /* AND BACK AGAIN, which is the case `history.length` provably cannot answer:
     it stayed at 3 through both of these, so a length test would step back a
     second time and eject. The index goes 1 -> 0 and this stops. */
  assert.equal(shouldStepBack({ index: 0 }), false);

  /* No Navigation API, and any server render. We do not guess; the control
     falls through to its href, which is a lateral jump and never an ejection. */
  assert.equal(shouldStepBack(undefined), false);

  /* The spec allows an entry that is not in our slice at all. Not a reason to
     move the reader. */
  assert.equal(shouldStepBack({ index: -1 }), false);
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
  /* The rule that ejected a reader. `history.length` counts entries from before
     we existed and never decreases on back, so it can never answer "is there a
     page of ours behind this one". It must not come back anywhere in the
     header. */
  assert.ok(
    !chrome.includes("history.length"),
    `${BACK_HEADER} reads history.length, which walks readers out of Signalera ` +
      `when they arrive from Slack or a search result. Ask the Navigation API ` +
      `for our own slice instead.`,
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

test("a history-aware control says Back, a destination control names it", () => {
  /* THE VISIBLE WORD HAS TO MATCH WHAT THE CONTROL DOES. These three said "Ask"
     while stepping back, which closed a loop a reader could not get out of:

       /saved -> "Back to Deal Flow" -> /deal-flow -> "Ask" -> /saved -> repeat

     A reader who reached Deal Flow from Saved could never reach Ask from the
     control named Ask. And the element is an anchor with an aria-hidden
     chevron, so a screen reader announced "Ask, link" and then delivered
     /dashboard, /saved, or another website entirely: a link-purpose failure.

     An aria-label over a visible "Ask" would only trade that for a
     label-in-name failure, so the assertion is on the VISIBLE prop. */
  for (const file of ASK_BACK_SCREENS) {
    const source = read(file);
    assert.ok(
      /<BackHeader\b[^>]*\blabel="Back"/.test(source),
      `${file}: a historyAware control must be labelled "Back". It does not ` +
        `always deliver Ask, and the visible word is what a screen reader reads.`,
    );
    assert.ok(
      !/<BackHeader\b[^>]*\blabel="Ask"/.test(source),
      `${file} still says "Ask" on a control that steps back`,
    );
  }
});

test("the four destination-naming controls keep their labels", () => {
  /* The other half of the same rule. A control that promises a specific place
     goes on promising it, and none of these four is a back. */
  const expected: [string, string, string][] = [
    ["src/components/saved/mobile-saved-screen.tsx", "/deal-flow", "Back to Deal Flow"],
    ["src/components/settings/mobile-alerts-screen.tsx", "/settings/profile", "Settings"],
    ["src/components/settings/mobile-learned-screen.tsx", "/settings/profile", "Settings"],
    ["src/components/settings/mobile-settings-screen.tsx", "/ledger", "Ledger"],
  ];
  for (const [file, href, label] of expected) {
    const source = read(file);
    assert.ok(
      source.includes(`<BackHeader href="${href}" label="${label}" />`),
      `${file} must keep <BackHeader href="${href}" label="${label}" /> unchanged`,
    );
  }
});
