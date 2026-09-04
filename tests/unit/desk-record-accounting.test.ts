// Unit tests for the one paragraph on the mobile desk record that may not lie
// (src/components/desk-record/accounting.ts).
//
// The standing rule: nothing may filter, hide or reorder rows such that a count
// disagrees with a list without a line on screen accounting for the gap. There
// are three ways to reach that gap on this screen and the paragraph has to
// cover all three, in every combination:
//
//   the cap      the strip counts every row the read returned, the list is
//                given only the newest page
//   not graded   counted in the strip, never listed, no verdict word exists
//   the filter   the reader chose one outcome
//
// What is locked here is the thing the first cut got wrong: a chosen bucket
// gets THAT BUCKET's arithmetic. The global sentence put three denominators on
// one screen with no clause tying the two that matter together, which is the
// same defect the paragraph exists to prevent, one level down.
//
// Run: npx tsx --test tests/unit/desk-record-accounting.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountingSentences } from "../../src/components/desk-record/accounting.ts";

const CAP = { read: 40, counted: 172 };

/* ── unfiltered: the two standing sentences, carried forward verbatim ── */

test("unfiltered, capped, with not-graded rows: both standing sentences", () => {
  const out = accountingSentences({
    bucket: null,
    countedInBucket: 0,
    listed: 34,
    listCap: CAP,
    hasUnlistedNotGraded: true,
    label: "",
  });
  assert.deepEqual(out, [
    "Only the 40 most recent calls in the record are read into this list. All 172 are counted in the strip above.",
    "Not-graded calls are counted in the strip above and are not listed here, because they carry no verdict.",
  ]);
});

test("unfiltered with nothing to account for draws no paragraph at all", () => {
  const out = accountingSentences({
    bucket: null,
    countedInBucket: 0,
    listed: 12,
    listCap: null,
    hasUnlistedNotGraded: false,
    label: "",
  });
  assert.deepEqual(out, [], "a line saying a cap did not bite is worse than none");
});

test("unfiltered, uncapped, with not-graded rows: the gap that remains is named", () => {
  const out = accountingSentences({
    bucket: null,
    countedInBucket: 0,
    listed: 12,
    listCap: null,
    hasUnlistedNotGraded: true,
    label: "",
  });
  assert.equal(out.length, 1);
  assert.match(out[0], /^Not-graded calls are counted/);
});

/* ── filtered: the bucket's own arithmetic ── */

test("a chosen bucket accounts for ITS OWN count against ITS OWN rows", () => {
  const out = accountingSentences({
    bucket: "challenged",
    countedInBucket: 30,
    listed: 9,
    listCap: CAP,
    hasUnlistedNotGraded: true,
    label: "Challenged",
  });
  const joined = out.join(" ");

  // The two numbers a filtered reader can see, and the difference between them.
  assert.match(joined, /Showing 9 of the 30 calls the record counts as Challenged\./);
  assert.match(joined, /The other 21 sit outside this list/);
  // Why they differ, in the same breath.
  assert.match(joined, /read from the 40 most recent calls in the record only/);
  // How to get back.
  assert.match(joined, /Press Challenged again for the whole list\./);

  // The record's TOTAL is not quoted at a filtered reader: it is a third
  // denominator they cannot reconcile anything against.
  assert.equal(joined.includes("172"), false);
});

test("the arithmetic in the sentence closes: listed plus outside equals the cell", () => {
  /* Not `as const`: literal tuple types would narrow `counted` and `listed` to
     disjoint unions and make the equal-case guard below a type error rather
     than the branch it is testing for. */
  const cases: [number, number][] = [
    [30, 9],
    [54, 22],
    [42, 13],
    [13, 13],
    [1, 0],
  ];
  for (const [counted, listed] of cases) {
    const out = accountingSentences({
      bucket: "supported",
      countedInBucket: counted,
      listed,
      listCap: CAP,
      hasUnlistedNotGraded: false,
      label: "Supported",
    }).join(" ");
    if (counted === listed) continue;
    const m = out.match(/Showing (\d+) of the (\d+) calls .*? The other (\d+) sit outside/);
    assert.ok(m, `no arithmetic sentence for ${counted}/${listed}: ${out}`);
    assert.equal(Number(m[1]) + Number(m[3]), Number(m[2]));
  }
});

test("a bucket the cap did not touch says so plainly rather than subtracting zero", () => {
  const out = accountingSentences({
    bucket: "supported",
    countedInBucket: 13,
    listed: 13,
    listCap: CAP,
    hasUnlistedNotGraded: false,
    label: "Supported",
  });
  assert.deepEqual(out, [
    "Showing all 13 calls the record counts as Supported.",
    "Press Supported again for the whole list.",
  ]);
});

test("a filtered view with no cap still states the bucket's own two numbers", () => {
  const out = accountingSentences({
    bucket: "noCleanRead",
    countedInBucket: 8,
    listed: 5,
    listCap: null,
    hasUnlistedNotGraded: false,
    label: "Developing",
  }).join(" ");
  assert.match(out, /Showing 5 of the 8 calls the record counts as Developing\./);
  assert.match(out, /The other 3 sit outside this list\./);
  assert.equal(out.includes("most recent"), false, "no cap, so no cap clause");
});

/* ── the clause that explains the one cell nobody can press ── */

test("the not-graded clause survives filtering", () => {
  // It is the only thing on the screen explaining why one cell of four does not
  // respond, so dropping it while filtering would leave that cell unexplained
  // exactly when a reader is most likely to try it.
  const filtered = accountingSentences({
    bucket: "challenged",
    countedInBucket: 30,
    listed: 9,
    listCap: CAP,
    hasUnlistedNotGraded: true,
    label: "Challenged",
  });
  assert.ok(filtered.some((l) => l.startsWith("Not-graded calls are counted")));
});

test("the not-graded clause is absent when the record carries none", () => {
  const filtered = accountingSentences({
    bucket: "challenged",
    countedInBucket: 30,
    listed: 9,
    listCap: CAP,
    hasUnlistedNotGraded: false,
    label: "Challenged",
  });
  assert.equal(filtered.some((l) => l.startsWith("Not-graded")), false);
});

/* ── the rule itself ── */

test("every state in which a count can disagree with the list draws a sentence", () => {
  for (const listCap of [null, CAP]) {
    for (const hasUnlistedNotGraded of [false, true]) {
      for (const bucket of [null, "challenged"] as const) {
        const out = accountingSentences({
          bucket,
          countedInBucket: bucket === null ? 0 : 30,
          listed: 9,
          listCap,
          hasUnlistedNotGraded,
          label: bucket === null ? "" : "Challenged",
        });
        const gap = bucket !== null || listCap !== null || hasUnlistedNotGraded;
        assert.equal(
          out.length > 0,
          gap,
          `bucket=${bucket} cap=${listCap !== null} notGraded=${hasUnlistedNotGraded}`,
        );
      }
    }
  }
});
