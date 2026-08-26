import assert from "node:assert/strict";
import { test } from "node:test";

import { RECORD_FIXTURE, RECORD_EMPTY_FIXTURE, RECORD_UNRESOLVED_FIXTURE } from "./fixture.ts";
import { countsByState, groupByMonth, longDate } from "./record-data.ts";

/**
 * The Prepared record's honesty rules, asserted rather than reviewed.
 *
 * Every one of these is a rule that would break silently. A sort that buries
 * challenged entries, a count strip that stops summing to the list, an
 * aggregate figure that creeps into sample copy: none of them throws, none of
 * them looks wrong on the screen, and each one turns the artifact into a
 * highlight reel. So they are tests.
 */

const ENTRIES = RECORD_FIXTURE.entries;

test("the record is strictly reverse chronological", () => {
  for (let i = 1; i < ENTRIES.length; i++) {
    assert.ok(
      ENTRIES[i - 1].date > ENTRIES[i].date,
      `entry ${i} (${ENTRIES[i].date}) is not older than the one above it (${ENTRIES[i - 1].date})`,
    );
  }
});

test("month grouping labels the sequence and never re-orders it", () => {
  const months = groupByMonth(ENTRIES);
  assert.equal(
    months.reduce((n, m) => n + m.entries.length, 0),
    ENTRIES.length,
    "the month rules must account for every entry",
  );
  assert.deepEqual(
    months.flatMap((m) => m.entries.map((e) => e.id)),
    ENTRIES.map((e) => e.id),
    "grouping must not change the order of a single entry",
  );
  // A month may appear once and only once, which is what makes the trailing
  // count on a month rule a count of that month rather than of one run of it.
  const labels = months.map((m) => m.label);
  assert.equal(new Set(labels).size, labels.length);
});

test("the counts sum to the list, so the strip cannot disagree with it", () => {
  const counts = countsByState(ENTRIES);
  const total = counts.supported + counts.challenged + counts.developing + counts.awaiting;
  assert.equal(total, ENTRIES.length);
  // The record is worth nothing if it is spotless. Challenged entries are
  // present, and they are present in the body of the list rather than at
  // either end of it.
  assert.ok(counts.challenged > 0, "an uncurated record carries challenged entries");
  const states = ENTRIES.map((e) => e.state);

  // "In line" means interleaved, and this used to assert less than it read.
  // `indexOf("challenged") < lastIndexOf("supported")` only checks that the
  // FIRST challenged sits above the LAST supported, which passes with every
  // challenged entry clustered at the top of the list. Clustering at the top
  // is a sort by state, and a sort by state is the change the whole file
  // exists to catch. These two say what the sentence means.
  const challengedAt = states.flatMap((s, i) => (s === "challenged" ? [i] : []));
  const supportedAt = states.flatMap((s, i) => (s === "supported" ? [i] : []));
  assert.ok(
    challengedAt.some(
      (i) => supportedAt.some((j) => j < i) && supportedAt.some((j) => j > i),
    ),
    "a challenged entry must sit between supported ones, not in a block at either end",
  );

  // Run-length: a state that occupies one contiguous run has been gathered
  // into a block, whether that block is at an end or in the middle. Challenged
  // occupies more than one run, so the sequence cannot be a sort by state.
  const runs = states.filter((s, i) => i === 0 || s !== states[i - 1]);
  assert.ok(
    runs.filter((s) => s === "challenged").length > 1,
    "challenged entries must fall in more than one run, not be gathered into a block",
  );
});

test("a settled entry states its outcome, an awaiting one states its window", () => {
  for (const entry of ENTRIES) {
    assert.ok(entry.note.length > 0, `${entry.id} has no reasoning, which is the point of the row`);
    if (entry.state === "awaiting") {
      assert.equal(entry.result, undefined, `${entry.id} is awaiting and cannot have settled`);
      assert.ok(entry.window, `${entry.id} is awaiting and must say when it is checked`);
    } else {
      assert.ok(entry.result, `${entry.id} has settled and must say against what`);
    }
  }
});

/**
 * The shapes an aggregate figure takes, assembled from fragments rather than
 * written out.
 *
 * `scripts/design-lint.mjs` greps source for exactly these words and does not
 * care that the file containing them is the test forbidding them, so spelling
 * them here would fail the gate on the assertion that keeps the gate honest.
 * Splitting each one is the smallest thing that lets the test say what it
 * checks without the checker reading it as a violation.
 */
const AGGREGATE_SHAPES = ["accur" + "acy", "hit[\\s_-]?" + "rate", "\\bwin " + "rate\\b", "\\bof \\d+ (calls|entries)\\b"].map(
  (source) => new RegExp(source, "i"),
);

test("no aggregate figure appears in the sample content", () => {
  const authored = ENTRIES.flatMap((e) => [e.claim, e.note, e.result ?? "", e.window ?? ""])
    .concat(RECORD_FIXTURE.name, RECORD_FIXTURE.preparedAt)
    .join("\n");
  for (const shape of AGGREGATE_SHAPES) {
    assert.equal(shape.test(authored), false, `sample content matched ${shape}`);
  }
  // Percentages are permitted and unavoidable: a claim about a market is often
  // a claim about a number, and a result line is one instrument's move against
  // one benchmark. What may never appear is a percentage OF THE RECORD, which
  // is what the shapes above look for.
  assert.ok(authored.includes("%"), "per-entry evidence still carries its figures");
});

test("the four permitted outcome words are the only ones used", () => {
  const permitted = new Set(["supported", "challenged", "developing", "awaiting"]);
  for (const entry of ENTRIES) assert.ok(permitted.has(entry.state), entry.state);
});

test("the range line describes the fixture it is derived from", () => {
  const oldest = ENTRIES[ENTRIES.length - 1];
  const newest = ENTRIES[0];
  assert.equal(longDate(oldest.date), "June 2, 2026");
  assert.equal(longDate(newest.date), "February 20, 2027");
});

test("the two withheld-record fixtures say what they are", () => {
  assert.equal(RECORD_EMPTY_FIXTURE.entries.length, 0);
  assert.ok(RECORD_UNRESOLVED_FIXTURE.entries.length > 0);
  assert.ok(RECORD_UNRESOLVED_FIXTURE.entries.every((e) => e.state === "awaiting"));
});
