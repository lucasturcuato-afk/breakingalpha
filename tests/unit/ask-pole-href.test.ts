// The Ask pole's destination has ONE definition, and these two tests are the
// only thing that keeps it that way.
//
// WHAT WENT WRONG, so a reader knows what is being defended. PR #736 moved the
// Ask pole from /intelligence to /ask. Three mobile screens drew a back control
// labelled Ask, each hardcoded `href="/intelligence"`, and each carried a
// comment saying it pointed at "the Ask pole's own destination". The comments
// stayed true and the values went stale, so a reader who tapped Ask, then Deal
// Flow, then back landed on the desk chat instead of the directory they came
// from. Nothing failed. tsc passed, lint passed, the build passed, and the
// three screens rendered perfectly.
//
// The fix was `ASK_POLE_HREF` in `mobile-tab-bar.tsx`. That removes the three
// copies but it does NOT stop a fourth: a new screen can hardcode the literal
// tomorrow and nothing notices. Test 1 is that stop.
//
//   1. NO BACK CONTROL CARRIES THE LITERAL. Reads the three screen directories
//      as TEXT. Reading source as text is deliberate: it needs no import, so
//      it never has to care that these are `"use client"` modules, and it
//      catches a literal in a file that no test would otherwise load.
//   2. THE POLE TABLE DOES NOT DRIFT. `isActive` reads `owns` alone and never
//      `href`, so a pole whose href is missing from its own list lights
//      nothing the moment the reader arrives on it. That is currently defended
//      by a comment at the pole's entry and by nothing else.
//   3. NO BACK CONTROL CARRIES THE LABEL EITHER, and this one is new.
//
// WHY 3 EXISTS. `ASK_POLE_HREF` centralised the route and NOTHING centralised
// the word. The pole's name sat as a bare JSX text node in the same three back
// controls, one line under an `href` that already read the constant, and this
// file scanned those exact three directories for a stale route while being
// blind to a stale label directly beneath it. That is PR 736's failure shape
// one field over, and it went live: the pole was renamed to Browse and the
// three controls would have gone on saying the old word with tsc, lint and the
// build all green. `BROWSE_POLE_LABEL` is the one definition and this is the
// scan that keeps a fourth copy from appearing.
//
// Both directions are proved for both detectors. Each is driven against fixture
// strings that DO violate as well as ones that do not, so a detector that
// silently stopped matching anything would fail rather than pass.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASK_POLE_HREF,
  BROWSE_POLE_LABEL,
  POLES,
} from "../../src/components/shell/mobile-tab-bar";

/* The three screens that draw a back control naming the pole. */
const SCREEN_DIRS = [
  "src/components/deals-mobile",
  "src/components/feed/mobile",
  "src/components/trends-mobile",
];

/* Routes the Ask pole has pointed at. /intelligence is where it was before
   PR #736; /ask is where it is now. BOTH are banned as literals here,
   and the current one is the more important of the two: a screen that hardcodes
   today's correct value is the exact bug this is here to stop, and it is
   invisible precisely because it works right now. */
const POLE_ROUTES = ["/intelligence", "/ask"];

/** Every way of writing the literal that would render as a working link. */
export function containsStalePoleLiteral(source: string): string[] {
  const hits: string[] = [];
  for (const route of POLE_ROUTES) {
    const patterns = [
      `href="${route}"`,
      `href={"${route}"}`,
      `href='${route}'`,
    ];
    for (const p of patterns) if (source.includes(p)) hits.push(p);
  }
  return hits;
}

/* Names the pole has carried. "Ask" is where it was before this rename, and
   "Browse" is where it is now. BOTH are banned as literals in these three
   directories, and the current one matters more, for the same reason the
   current route does: a screen that hardcodes today's correct word is the exact
   defect this is here to stop, and it is invisible precisely because it reads
   right today. The constant is imported rather than spelled a fourth time, so
   the next rename cannot leave this list behind. */
const POLE_LABELS = ["Ask", BROWSE_POLE_LABEL];

/**
 * Every way of writing the pole's name that would RENDER as the label, and no
 * way of merely mentioning it.
 *
 * Three shapes, because the back controls have used two of them and a third is
 * one refactor away: a bare text node alone on its line (what all three
 * carried), a text node inline between tags, and a quoted string handed to a
 * prop. Prose is deliberately not matched. Every one of these files explains
 * the pole by name in a comment directly above the control, and a detector
 * that fired on its own documentation would be turned off within a week.
 *
 * THE PROP SHAPE ANCHORS ON THE `=`, AND THAT IS NOT A DETAIL. The first build
 * of this matched any quoted occurrence of the word, which is prose the moment
 * a comment quotes the old label to explain why it changed. All three of these
 * files do exactly that: `deals-screen.tsx` traces the loop the old word closed
 * with `-> "Ask" ->`, and the other two name it in the same breath. So the
 * quoted shape matches an assignment, `label="Ask"` and `label={"Ask"}`, which
 * is the only quoted form that reaches a reader's screen. A detector that goes
 * red at a file explaining the very rename it guards teaches the next author to
 * delete it.
 */
export function containsStalePoleLabel(source: string): string[] {
  const hits: string[] = [];
  for (const label of POLE_LABELS) {
    const patterns: [string, RegExp][] = [
      [`bare text node "${label}"`, new RegExp(`^[ \\t]*${label}[ \\t]*$`, "m")],
      [`inline text node >${label}<`, new RegExp(`>[ \\t]*${label}[ \\t]*<`)],
      [
        `quoted prop value "${label}"`,
        new RegExp(`=\\s*\\{?\\s*["']${label}["']`),
      ],
    ];
    for (const [name, re] of patterns) if (re.test(source)) hits.push(name);
  }
  return hits;
}

test("the label detector fires on a rendered label, in every spelling", () => {
  /* The shape all three back controls carried verbatim before the rename. */
  assert.deepEqual(
    containsStalePoleLabel("          </svg>\n          Ask\n        </Link>\n"),
    ['bare text node "Ask"'],
  );
  assert.deepEqual(containsStalePoleLabel("<span>Browse</span>"), [
    'inline text node >Browse<',
  ]);
  assert.deepEqual(containsStalePoleLabel('<Tab label="Browse" />'), [
    'quoted prop value "Browse"',
  ]);
  /* The braced spelling of the same prop, which renders identically. */
  assert.deepEqual(containsStalePoleLabel('<Tab label={"Ask"} />'), [
    'quoted prop value "Ask"',
  ]);
});

test("the label detector does not fire on the constant, or on prose", () => {
  assert.deepEqual(containsStalePoleLabel("{BROWSE_POLE_LABEL}"), []);
  /* Every one of the three files documents the pole by name directly above the
     control. None of that is a rendered label and none of it may trip this. */
  assert.deepEqual(
    containsStalePoleLabel("/* Back to Browse. The design draws a chevron. */"),
    [],
  );
  assert.deepEqual(
    containsStalePoleLabel("      // PR 736 moved the Ask pole to /ask.\n"),
    [],
  );
  /* THE ONE THAT ACTUALLY WENT RED. All three screens quote the old label in
     prose to explain why it is no longer the visible word, and a quoted word
     in a sentence is not a rendered label. Verbatim from
     `deals-screen.tsx:144`. */
  assert.deepEqual(
    containsStalePoleLabel('          /saved it used to close a loop, /saved -> Deal Flow -> "Ask" ->\n'),
    [],
  );
  assert.deepEqual(
    containsStalePoleLabel('     entrance, so the word "Ask" named a place the control would not take that\n'),
    [],
  );
  /* A different word that merely contains one of them. */
  assert.deepEqual(containsStalePoleLabel("          Asked\n"), []);
  assert.deepEqual(containsStalePoleLabel("<span>Browse the desk</span>"), []);
});

test("the detector fires on a hardcoded pole route, in every spelling", () => {
  assert.deepEqual(containsStalePoleLiteral('<Link href="/intelligence">'), [
    'href="/intelligence"',
  ]);
  assert.deepEqual(containsStalePoleLiteral('<Link href="/ask">'), [
    'href="/ask"',
  ]);
  assert.deepEqual(containsStalePoleLiteral('<Link href={"/ask"}>'), [
    'href={"/ask"}',
  ]);
  /* This is the shape the three screens carried at db1a3dd0, verbatim. */
  assert.equal(
    containsStalePoleLiteral(`        <Link\n          href="/intelligence"\n`)
      .length,
    1,
  );
});

test("the detector does not fire on the constant, or on other routes", () => {
  assert.deepEqual(containsStalePoleLiteral("<Link href={ASK_POLE_HREF}>"), []);
  assert.deepEqual(containsStalePoleLiteral('<Link href="/deal-flow">'), []);
  /* A prose mention of the route is not a link and must not trip this. */
  assert.deepEqual(
    containsStalePoleLiteral("/* PR #736 moved the pole to /ask. */"),
    [],
  );
});

test("no mobile screen hardcodes the Ask pole's route", () => {
  const offenders: string[] = [];
  let scanned = 0;

  for (const dir of SCREEN_DIRS) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".tsx")) continue;
      scanned += 1;
      const file = join(dir, name);
      for (const hit of containsStalePoleLiteral(readFileSync(file, "utf8"))) {
        offenders.push(`${file} carries ${hit}`);
      }
    }
  }

  /* A scan that found no files would pass vacuously, which is how a moved
     directory turns this test into decoration. */
  assert.ok(scanned >= 7, `expected to scan the screen files, scanned ${scanned}`);
  assert.deepEqual(
    offenders,
    [],
    `Back controls must read ASK_POLE_HREF from mobile-tab-bar.tsx, not a literal.\n${offenders.join("\n")}`,
  );
});

test("no mobile screen hardcodes the pole's label", () => {
  const offenders: string[] = [];
  let scanned = 0;

  for (const dir of SCREEN_DIRS) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".tsx")) continue;
      scanned += 1;
      const file = join(dir, name);
      for (const hit of containsStalePoleLabel(readFileSync(file, "utf8"))) {
        offenders.push(`${file} carries a ${hit}`);
      }
    }
  }

  /* Same vacuity guard as the route scan above, for the same reason: a moved
     directory turns a passing scan into decoration. */
  assert.ok(scanned >= 7, `expected to scan the screen files, scanned ${scanned}`);
  assert.deepEqual(
    offenders,
    [],
    `Back controls must read BROWSE_POLE_LABEL from mobile-tab-bar.tsx, not a literal.\n${offenders.join("\n")}`,
  );
});

/* The predicate reads the constant rather than a word. It used to spell "Ask"
   out, which made this the ONE thing in the repo that noticed a pole rename at
   all: it went red at its first assertion the moment the label changed, which
   was correct behaviour. Reading the constant does not weaken it, because the
   two assertions under it are what it was actually defending, and one is added:
   exactly one pole carries this label AND that pole is the one at the constant
   href, so the label and the destination cannot come apart. */
test("the Browse pole's href is the constant, and its owns list contains it", () => {
  const browse = POLES.filter((p) => p.label === BROWSE_POLE_LABEL);
  assert.equal(
    browse.length,
    1,
    `exactly one pole carries ${BROWSE_POLE_LABEL}, found ${browse.length}`,
  );
  const pole = browse[0];
  assert.equal(pole.href, ASK_POLE_HREF);
  assert.ok(
    pole.owns.includes(ASK_POLE_HREF),
    "the Browse pole's href is missing from its own owns list, so it goes dark on arrival",
  );
  assert.deepEqual(
    POLES.filter((p) => p.href === ASK_POLE_HREF).map((p) => p.label),
    [BROWSE_POLE_LABEL],
    "the pole at ASK_POLE_HREF is not the one carrying BROWSE_POLE_LABEL",
  );
});

test("no pole is missing its own href from owns", () => {
  assert.equal(POLES.length, 4);
  for (const pole of POLES) {
    assert.ok(
      pole.owns.some(
        (r) => pole.href === r || pole.href.startsWith(r + "/"),
      ),
      `the ${pole.label} pole points at ${pole.href}, which nothing in its owns list matches, so isActive is false the moment a reader arrives`,
    );
  }
});
