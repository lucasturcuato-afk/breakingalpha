// A COMPANY PAGE WITH NO WAY OFF IT, and a back control that walks the reader
// out of the product, are the two defects this file exists to keep out.
//
// WHAT WAS WRONG, so a reader knows what is being defended.
//
//   THE DESK HAD NO BACK CONTROL AT ALL. `CompanyDetailLayout` drew a header,
//   an alias ribbon, a KPI strip, seven tab panels and a right rail, and
//   nothing that returns a reader to the directory row, search result or
//   watchlist entry they arrived from. The sidebar can offer "Company Intel".
//   It cannot offer the screen the reader was actually on.
//
//   THE PHONE HAD ONE AND IT WAS THE UNGUARDED KIND.
//   `company-intel-screen.tsx` drew `<button onClick={() => router.back()}>`
//   with nothing in front of it. On a COLD ENTRY that has two outcomes and
//   neither is navigation inside Signalera: on the first entry of a tab the
//   call is a no-op, so the control is dead on a reader who is already stuck;
//   with a foreign page behind it the reader is put back on Slack. A company
//   URL is the URL that gets pasted into a message, so a cold entry here is the
//   ordinary arrival and not the edge case.
//
//   AND THE RULE HAD TWO IMPLEMENTATIONS. `EmptyState.tsx` carried a private
//   `hasOurPageBehind()`, written while `history-back.ts` was still in flight
//   on a sibling branch. Same expression, two authors, one of them under a
//   test. That is the shape this repo has paid for five times (#713, #721,
//   #738, `slugToCompanyName`, #736's three back controls) and issue 755 was
//   filed for this instance of it.
//
// WHAT EACH TEST STOPS, and every one of them was verified by mutation rather
// than by reading: the guard was deleted, the suite was run, and the named test
// went red.
//
//   1. The desk route mounts the control AND the layout renders the slot.
//      Either half alone is a green test over a control nobody can see.
//   2. The desk control asks the shared rule and computes nothing itself.
//   3. The phone screen delegates to BackHeader and no longer hand-rolls it.
//   4. NOTHING under src/components/company/ computes the index. This is the
//      one that would have caught `hasOurPageBehind` the day it was written.
//   5. All three controls read one destination constant, not a literal.
//   6. That destination is reachable on BOTH surfaces, which is the half a
//      desk-only reading of it would miss.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  COMPANY_BACK_HREF,
  COMPANY_BACK_LABEL,
} from "../../src/components/company/back-destination";
import { resolveTwinPath } from "../../src/components/mobile/desk-redirect-map";

const DESK_LINK = "src/components/company/CompanyBackLink.tsx";
const DESK_LAYOUT = "src/components/company/CompanyDetailLayout.tsx";
const ROUTE = "src/app/company/[id]/page.tsx";
const PHONE_SCREEN = "src/components/company/mobile/company-intel-screen.tsx";
const MISS_BRANCH = "src/components/company/states/EmptyState.tsx";

/** The company tree, which is what test 4 walks. */
const COMPANY_TREE = "src/components/company";

/**
 * The only two files under the company tree allowed to call `router.back()`.
 *
 * Two and not one because the two anatomies are different objects: the phone
 * miss branch draws a 48px row padded to line up with the card under it, and
 * the desk draws an inline link inside the layout's own column. What must not
 * fork is the RULE, and test 4 is what proves it has not.
 */
const SANCTIONED_STEPPERS = new Set([
  "src/components/company/CompanyBackLink.tsx",
  "src/components/company/states/EmptyState.tsx",
]);

/** Verbatim from the prototype path data, which every hand-rolled copy carried. */
const CHEVRON_PATH = "M15 6l-6 6 6 6";

/**
 * A file's CODE, with every comment removed.
 *
 * IT SCANS RATHER THAN REGEXES, AND THE REASON IS A FALSE NEGATIVE. Stripping
 * from `//` to end of line with a regex eats the rest of a line that merely
 * contains `https://` inside a string, and what it eats is CODE. A detector
 * that silently deletes the line a violation is sitting on passes, which is
 * worse than one that fires on prose. So this tracks quote state and only
 * treats `//` and the block form as comments outside a string.
 *
 * WHY IT IS NEEDED AT ALL. Every file this walks documents the defect by name:
 * `CompanyBackLink.tsx` explains at length why `history.length` is the wrong
 * question, and `company-intel-screen.tsx` records the `router.back()` it used
 * to draw. The first build of this test read raw source and went red on all of
 * it. `ask-pole-href.test.ts` states the cost: a detector that goes red at a
 * file explaining the very rule it guards teaches the next author to delete it.
 */
export function codeOf(source: string): string {
  let out = "";
  let quote: string | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      if (c === "\\") {
        out += c + (next ?? "");
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const read = (file: string) => readFileSync(file, "utf8");

/** What every detector below actually reads. */
const code = (file: string) => codeOf(read(file));

/** Every .tsx and .ts under a directory, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
      continue;
    }
    if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("the comment stripper keeps code and drops prose, both directions", () => {
  /* BOTH DIRECTIONS, driven against strings that DO violate as well as ones
     that do not, so a stripper that silently stopped matching anything would
     fail rather than pass. */
  assert.equal(codeOf("const a = 1; // history.length is wrong\n").trim(), "const a = 1;");
  assert.equal(codeOf("/* router.back() */ const a = 1;").trim(), "const a = 1;");
  assert.equal(codeOf("{/* currentEntry */}\n<div />").trim(), "{}\n<div />");
  /* Multi-line block comments, which is how every one of these files opens. */
  assert.equal(
    codeOf("/**\n * history.length counts the TAB.\n */\nconst a = 1;").trim(),
    "const a = 1;",
  );

  /* THE FALSE NEGATIVE THIS SCANNER EXISTS FOR. A regex stripper eats from the
     `//` in a URL to the end of the line, and the violation on that line goes
     with it. */
  assert.ok(
    codeOf('const u = "https://x.dev"; router.back();').includes("router.back()"),
    "the stripper ate code after a URL inside a string, which hides violations",
  );
  /* And a comment marker inside a string is not a comment. */
  assert.equal(codeOf('const s = "a // b";').trim(), 'const s = "a // b";');

  /* The code forms must survive, or every ban below passes vacuously. */
  assert.ok(codeOf("router.back();").includes("router.back()"));
  assert.ok(codeOf("if (history.length > 1) {}").includes("history.length"));
});

test("the desk route mounts a back control, and the layout renders the slot", () => {
  /* BOTH HALVES, and that is the point of putting them in one test. A route
     that passes `backSlot` into a layout that drops it renders nothing, and a
     layout that renders `{backSlot}` for a route that passes none renders
     nothing, and either half on its own is a green assertion over a reader who
     still cannot leave the page. */
  const route = code(ROUTE);
  assert.ok(
    /backSlot=\{<CompanyBackLink\s*\/>\}/.test(route),
    `${ROUTE} must hand CompanyBackLink to the desk layout. Without it the desk ` +
      `tree has no way off the route at all, which is the defect this file exists for.`,
  );

  const layout = code(DESK_LAYOUT);
  assert.ok(
    /\{backSlot\}/.test(layout),
    `${DESK_LAYOUT} accepts a backSlot and never renders it, so the control the ` +
      `route passes is dropped on the floor and the page has no way off it.`,
  );

  /* It has to sit ABOVE the header, which is where a reader looks for it and
     is the only position that does not put it below a full screen of tabs. */
  const order = layout.indexOf("{backSlot}");
  const headerAt = layout.indexOf("{header}");
  assert.ok(order > 0 && headerAt > 0, "expected both slots to be rendered");
  assert.ok(
    order < headerAt,
    `${DESK_LAYOUT} renders the back control below the header. A control a reader ` +
      `has to scroll to find is a control they do not find.`,
  );
});

test("the desk control asks the shared rule and computes nothing of its own", () => {
  const source = code(DESK_LINK);

  /* PIN THE CALL, NOT THE IMPORT. An import line satisfies a test that greps
     for the identifier while the handler goes on asking something else, which
     is exactly how `call-horizons.test.ts` stayed green over a diverged
     predicate. */
  assert.ok(
    /shouldStepBack\(readAppHistory\(\)\)/.test(source),
    `${DESK_LINK} must ask shouldStepBack(readAppHistory()). The rule lives in ` +
      `src/components/mobile/history-back.ts, once, with the measured indices ` +
      `behind it.`,
  );
  assert.ok(
    /isPlainLeftClick\(event\)/.test(source),
    `${DESK_LINK} must let modified and non-primary clicks reach the browser: a ` +
      `cmd-click asks for a NEW context, and a new context has no history of ours.`,
  );
  assert.ok(
    source.includes("router.back()"),
    `${DESK_LINK} must actually step back when the rule says so`,
  );

  /* THE FALLBACK IS THE HALF THAT IS ALWAYS DROPPED. It is an anchor, and the
     handler returning without preventDefault is what lets the anchor run, so
     the cold-entry branch is the `href` and not a second navigation call. */
  assert.ok(
    /href=\{COMPANY_BACK_HREF\}/.test(source),
    `${DESK_LINK} must keep an href fallback. On a cold entry the handler does ` +
      `nothing and the anchor navigates itself, to a destination that is stated ` +
      `rather than guessed.`,
  );
  assert.ok(
    !/router\.push\(/.test(source),
    `${DESK_LINK} pushes instead of falling through to its href, which breaks ` +
      `cmd-click and middle-click on the stated destination.`,
  );
});

test("the phone screen delegates to BackHeader instead of hand-rolling a back", () => {
  const source = code(PHONE_SCREEN);

  assert.ok(
    /<BackHeader\b[^>]*\bhistoryAware\b/.test(source),
    `${PHONE_SCREEN} must draw <BackHeader ... historyAware />. Without the flag ` +
      `BackHeader is a plain link to the directory, which is a lateral jump for ` +
      `every reader who did not arrive from it.`,
  );
  assert.ok(
    !source.includes("router.back()"),
    `${PHONE_SCREEN} hand-rolls its own back again. Unguarded, on this route, ` +
      `that is a dead control on a cold entry or an ejection out of Signalera.`,
  );
  assert.ok(
    !source.includes(CHEVRON_PATH),
    `${PHONE_SCREEN} draws its own chevron beside the shared one. Three copies of ` +
      `one anatomy is how one rule came to need fixing in three places.`,
  );
});

test("nothing under src/components/company computes the history index itself", () => {
  /* THE ONE THAT WOULD HAVE CAUGHT `hasOurPageBehind` THE DAY IT WAS WRITTEN.
     `history.length` counts entries that existed before we did and never
     decreases on back, so it can never answer "is a page of OURS behind this
     one"; `currentEntry` is the right reading and a second copy of it is the
     failure this file is named for. Neither may appear in this tree. */
  const offenders: string[] = [];
  const steppers: string[] = [];
  const files = walk(COMPANY_TREE);

  for (const file of files) {
    const source = code(file);
    if (source.includes("history.length")) {
      offenders.push(
        `${file} reads history.length, which walks readers out of Signalera when ` +
          `they arrive from Slack or a search result`,
      );
    }
    if (source.includes("currentEntry")) {
      offenders.push(
        `${file} reads navigation.currentEntry itself. The rule lives in ` +
          `src/components/mobile/history-back.ts, once.`,
      );
    }
    if (source.includes("router.back()")) {
      steppers.push(file);
      if (!SANCTIONED_STEPPERS.has(file)) {
        offenders.push(
          `${file} steps back on its own. Import shouldStepBack/readAppHistory, ` +
            `or draw <BackHeader ... historyAware />.`,
        );
      }
    }
  }

  assert.deepEqual(offenders, [], offenders.join("\n"));

  /* VACUITY GUARDS, both directions. A ban that passes because the tree moved,
     or because nothing draws a back control any more, is decoration with an
     exit code. */
  assert.ok(
    files.length >= 30,
    `expected to walk the company tree, walked ${files.length} files`,
  );
  assert.deepEqual(
    steppers.sort(),
    [...SANCTIONED_STEPPERS].sort(),
    "the two sanctioned back controls are not the two that exist, so the ban " +
      "above is either passing vacuously or a control has gone missing",
  );

  /* And each sanctioned stepper reaches the shared rule rather than a local
     one. Without this the ban only proves nobody spelled `currentEntry`; it
     does not prove the guard is consulted at all. */
  for (const file of SANCTIONED_STEPPERS) {
    assert.ok(
      /shouldStepBack\(readAppHistory\(\)\)/.test(code(file)),
      `${file} calls router.back() without asking shouldStepBack(readAppHistory()) ` +
        `first, so it steps back on a cold entry and leaves the product.`,
    );
  }
});

test("all three back controls read one destination, and one label", () => {
  assert.equal(COMPANY_BACK_HREF, "/company");
  assert.equal(COMPANY_BACK_LABEL, "Back");

  /* THE ROUTE HAS TO EXIST. `mobile-tab-bar.tsx` records the cost of the other
     way round: a pole pointed at a screen with no read behind it. */
  assert.ok(
    existsSync("src/app/company/page.tsx"),
    `COMPANY_BACK_HREF is ${COMPANY_BACK_HREF} and no route renders it`,
  );

  for (const file of [DESK_LINK, MISS_BRANCH, PHONE_SCREEN]) {
    const source = code(file);
    assert.ok(
      /href=\{COMPANY_BACK_HREF\}/.test(source),
      `${file} must read COMPANY_BACK_HREF. #736 is the recorded cost of three ` +
        `copies of a route: the route moved, the literals did not, and tsc, lint ` +
        `and the build were green while readers landed on the wrong screen.`,
    );
    assert.ok(
      !/href="\/company"/.test(source),
      `${file} carries the destination as a literal beside the constant`,
    );
  }
});

test("the cold-entry destination is reachable on a phone as well as a desk", () => {
  /* THE HALF A DESK-ONLY READING MISSES. `/company` is a desk route: below
     `md` it is redirected to its twin, and a fallback that landed a phone
     reader on a desk-only screen would be a cold-entry branch that works on
     one surface and strands the reader on the other. The mapping is asked for
     rather than restated, so the twin table can move and this stays true. */
  const twin = resolveTwinPath(COMPANY_BACK_HREF);
  assert.ok(
    twin,
    `${COMPANY_BACK_HREF} has no mobile twin in desk-redirect-map.ts, so a phone ` +
      `reader falling through the back control lands on the desk directory.`,
  );
  assert.ok(
    existsSync(join("src/app", twin, "page.tsx")),
    `the mobile twin of ${COMPANY_BACK_HREF} is ${twin}, and no route renders it`,
  );
});
