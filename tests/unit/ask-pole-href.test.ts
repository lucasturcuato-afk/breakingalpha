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
//      by a comment at the Ask entry and by nothing else.
//
// Both directions are proved. `containsStalePoleLiteral` is driven against
// fixture strings that DO violate as well as ones that do not, so a test that
// silently stopped matching anything would fail rather than pass.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ASK_POLE_HREF, POLES } from "../../src/components/shell/mobile-tab-bar";

/* The three screens that draw a back control labelled Ask. */
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

test("the Ask pole's href is the constant, and its owns list contains it", () => {
  const ask = POLES.find((p) => p.label === "Ask");
  assert.ok(ask, "the Ask pole is gone from the table");
  assert.equal(ask.href, ASK_POLE_HREF);
  assert.ok(
    ask.owns.includes(ASK_POLE_HREF),
    "the Ask pole's href is missing from its own owns list, so it goes dark on arrival",
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
