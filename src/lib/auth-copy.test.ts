/**
 * The sign-in page must not claim what the product does not do.
 *
 * Two strings were wrong: "AI thesis board updated as markets move" described
 * an object #548 retired, and "Trusted by analysts at top-tier firms" was an
 * unearned social proof claim. The replacements have to be specific, because
 * swapping a false claim for a vague one is the same lie with deniability.
 *
 * Run: npm run test:unit
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, describe } from "node:test";

const page = readFileSync(
  join(process.cwd(), "src/app/auth/page.tsx"),
  "utf8",
);

describe("retired and unearned claims are gone", () => {
  for (const dead of [
    "thesis board",
    "Trusted by analysts at top-tier firms",
    "Join analysts tracking signals",
  ]) {
    test(`the page no longer says "${dead}"`, () => {
      assert.ok(!page.includes(dead), `still present: ${dead}`);
    });
  }

  test("no user-facing copy says thesis at all", () => {
    // #548 retired user theses; everything is a call.
    const copy = page.match(/"[^"]{20,}"/g) ?? [];
    const offenders = copy.filter((s) => /thesis|theses/i.test(s));
    assert.deepEqual(offenders, []);
  });

  test("no unearned social proof survives", () => {
    const banned = /trusted by|industry[- ]leading|world[- ]class|top[- ]tier/i;
    assert.ok(!banned.test(page), "an unearned trust claim is still present");
  });
});

describe("what replaced them is specific and checkable", () => {
  test("it names the actual mechanism, not a vague benefit", () => {
    for (const claim of [
      "Falsifiable market calls, published before the outcome is known",
      "Every call scored against the close with benchmark attribution",
      "The misses stay on the record, next to the hits",
    ]) {
      assert.ok(page.includes(claim), `missing: ${claim}`);
    }
  });

  test("the footer line states the method rather than a reputation", () => {
    assert.ok(
      page.includes("Calls are timestamped before the close and graded after it"),
    );
  });

  test("the replacements admit the downside", () => {
    // A record that only advertises hits is the claim we are trying not to make.
    assert.ok(/misses/i.test(page));
  });
});
