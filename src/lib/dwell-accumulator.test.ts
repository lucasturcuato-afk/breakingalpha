/**
 * Proof that dwell is visibility-gated. The load-bearing case is
 * "hidden tab accrues nothing": without it, every abandoned tab inflates the
 * metric and dwell stops meaning attention.
 *
 * No runner is wired for TypeScript unit tests in this repo. Compile and run:
 *
 *   npx tsc src/lib/dwell-accumulator.ts src/lib/dwell-accumulator.test.ts \
 *     --outDir /tmp/dwell-proof --module commonjs --target es2022 --strict \
 *     && node --test /tmp/dwell-proof/dwell-accumulator.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDwellState,
  finalize,
  isAccruing,
  readMs,
  setInView,
  setPageVisible,
} from "./dwell-accumulator";

test("in view and page visible accrues real time", () => {
  const s = createDwellState();
  setInView(s, true, 1_000);
  assert.equal(isAccruing(s), true);
  assert.equal(readMs(s, 4_000), 3_000);
  assert.equal(finalize(s, 4_000), 3_000);
});

test("hidden tab accrues nothing while it is hidden", () => {
  const s = createDwellState();
  setInView(s, true, 0);
  // 2s of genuine reading.
  setPageVisible(s, false, 2_000);
  // 10 minutes of the tab sitting in the background, still "intersecting".
  assert.equal(isAccruing(s), false);
  assert.equal(readMs(s, 602_000), 2_000);
  setPageVisible(s, true, 602_000);
  // 1s more of genuine reading after the user comes back.
  assert.equal(finalize(s, 603_000), 3_000);
});

test("a region never brought into view accrues zero", () => {
  const s = createDwellState();
  setPageVisible(s, true, 0);
  assert.equal(finalize(s, 60_000), 0);
});

test("a hidden page that scrolls the region into view still accrues zero", () => {
  const s = createDwellState();
  setPageVisible(s, false, 0);
  setInView(s, true, 100);
  assert.equal(isAccruing(s), false);
  assert.equal(finalize(s, 60_000), 0);
});

test("runs count re-reads, and finalize is idempotent", () => {
  const s = createDwellState();
  setInView(s, true, 0);
  setInView(s, false, 1_000);
  setInView(s, true, 5_000);
  setInView(s, false, 6_000);
  assert.equal(s.runs, 2);
  assert.equal(finalize(s, 9_999), 2_000);
  assert.equal(finalize(s, 99_999), 2_000);
});

test("a backwards clock banks nothing rather than a negative", () => {
  const s = createDwellState();
  setInView(s, true, 10_000);
  assert.equal(finalize(s, 9_000), 0);
});
