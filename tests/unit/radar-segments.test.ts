// Radar is four sections, and the desk and the phone must agree on which four.
//
// WHY THIS FILE EXISTS. Mobile Radar drew two of the desk's four sections, so a
// reader who knew the desk arrived on a phone and found most of Radar missing.
// The fix was structural (four routes under `/watch`, one section row between
// them), and the way a structural fix rots is that one surface renames a
// section and the other does not. Nothing else catches that: the words are
// strings, both surfaces compile, and both render perfectly with different
// vocabularies on them.
//
// PR 736 IS THE PRECEDENT AND IT IS EXACT. A pole moved from /intelligence to
// /ask and three back controls kept the word "Ask" one line under an `href`
// that was already reading a shared constant. The route was centralised; the
// LABEL was not. `tests/unit/ask-pole-href.test.ts` was scanning those same
// three directories for a stale route while blind to the stale label directly
// beneath it. So this file holds the labels, not only the keys.
//
// WHAT IS DELIBERATELY NOT LOCKED. The hrefs differ by surface and always will:
// `/radar/*` on the desk, `/watch/*` on the phone. Asserting they match would
// assert a coincidence. What is asserted is that every section HAS a route on
// the phone, and that every one of those routes is one the Radar pole lights.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RADAR_TAB_LABEL,
  RADAR_TAB_ORDER,
  type RadarTab,
} from "../../src/components/radar/RadarTabs";
import { RADAR_SEGMENT_HREF } from "../../src/components/radar-mobile/radar-segments";
import { POLES } from "../../src/components/shell/mobile-tab-bar";

/* The four the product ships. Written out here rather than derived from the
   table under test, so a fifth section added to the table without a decision is
   red rather than silently absorbed. */
const EXPECTED: RadarTab[] = ["following", "watchlist", "calls", "desk-record"];

test("Radar has exactly four sections, in the desk's order", () => {
  assert.deepEqual(RADAR_TAB_ORDER, EXPECTED);
  assert.deepEqual(Object.keys(RADAR_TAB_LABEL).sort(), [...EXPECTED].sort());
});

test("every section is drawn with the same word on both surfaces", () => {
  // The phone's row reads RADAR_TAB_LABEL directly, so the property under test
  // is that the table itself still says what the product says, and that no
  // section has been left without a word.
  assert.deepEqual(RADAR_TAB_LABEL, {
    following: "Following",
    watchlist: "Watchlist",
    calls: "Calls",
    "desk-record": "Desk record",
  });
});

test("every section has a route on the phone", () => {
  for (const key of RADAR_TAB_ORDER) {
    const href = RADAR_SEGMENT_HREF[key];
    assert.equal(typeof href, "string", `${key} has no mobile route`);
    assert.ok(href.length > 0, `${key} has an empty mobile route`);
  }
  // Four distinct destinations. Two sections sharing a route is a section that
  // cannot be reached.
  const hrefs = RADAR_TAB_ORDER.map((k) => RADAR_SEGMENT_HREF[k]);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test("the first section is the Radar pole's own destination", () => {
  // `/radar` redirects to Following on the desk, so the bare phone route draws
  // Following. It also has to BE the pole's href: a pole that lands on a
  // redirect spends a navigation arriving nowhere new, and a pole whose
  // destination is not one of these four lands outside the surface entirely.
  const radar = POLES.find((p) => p.label === "Radar");
  assert.ok(radar, "the Radar pole is gone from the tab bar");
  assert.equal(RADAR_SEGMENT_HREF.following, radar.href);
});

test("every section lights the Radar pole and no other", () => {
  // `isActive` in mobile-tab-bar matches an exact path or a path prefix. This
  // reproduces that rule rather than importing it, because the rule is private
  // and the property under test is the OUTCOME: a reader standing on any of
  // Radar's four sections sees Radar lit, and sees nothing else lit.
  const lights = (owns: string[], path: string) =>
    owns.some((route) => path === route || path.startsWith(route + "/"));

  for (const key of RADAR_TAB_ORDER) {
    const path = RADAR_SEGMENT_HREF[key];
    const lit = POLES.filter((p) => lights(p.owns, path)).map((p) => p.label);
    assert.deepEqual(lit, ["Radar"], `${path} lights ${lit.join(", ") || "no pole"}`);
  }
});
