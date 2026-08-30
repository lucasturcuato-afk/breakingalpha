import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BAR_OFFSETS,
  LADDER_ORDER,
  STAGGER_MS,
  ladderDelays,
  renderedDelays,
  type LadderRung,
} from "../../src/components/dashboard-mobile/entrance-ladder";

/**
 * The mobile Dashboard's entrance ladder.
 *
 * The load-bearing property is that THE CADENCE IS NOT A PROPERTY OF THE
 * READER'S DATA. The mobile briefing omits any section whose source is null,
 * so the set of rungs that render changes from account to account. The ladder
 * that shipped declared a fixed delay per rung, which meant the browser
 * applied 0/60/120/... to whichever elements happened to exist and produced
 * gaps of 60, 0, 120, 60, 120, 120, 60 on a live account: measured, and
 * measured differently on a second account.
 *
 * These tests are the browser-free half of the acceptance test. The gap list
 * must be uniform for every subset the screen's own conditionals can produce,
 * not merely for the two that were sampled.
 */

/** The rungs that are always drawn; everything else is a reader's data. */
const ALWAYS: LadderRung[] = ["dateRule", "greeting", "brief"];

/** The independent conditions, in the screen's own terms. `marketHead` and
 *  `marketBand` are two rungs behind ONE test (`d.market.length`), so they are
 *  toggled together, exactly as the screen toggles them. */
const CONDITIONS: LadderRung[][] = [
  ["context"],
  ["marketHead", "marketBand"],
  ["waiting"],
  ["yourRecord"],
  ["deskRecord"],
  ["stories"],
];

function shapeOf(present: LadderRung[]): Record<LadderRung, boolean> {
  const set = new Set(present);
  return Object.fromEntries(LADDER_ORDER.map((rung) => [rung, set.has(rung)])) as Record<
    LadderRung,
    boolean
  >;
}

function gapsOf(delays: number[]): number[] {
  return delays.slice(1).map((d, i) => d - delays[i]);
}

/** Every subset the screen can render: the three fixed rungs plus any
 *  combination of the six conditions. 64 shapes. */
function allShapes(): { present: LadderRung[]; shape: Record<LadderRung, boolean> }[] {
  const out: { present: LadderRung[]; shape: Record<LadderRung, boolean> }[] = [];
  for (let mask = 0; mask < 1 << CONDITIONS.length; mask += 1) {
    const present = [...ALWAYS];
    CONDITIONS.forEach((group, i) => {
      if (mask & (1 << i)) present.push(...group);
    });
    out.push({ present, shape: shapeOf(present) });
  }
  return out;
}

describe("ladderDelays", () => {
  test("the full render is the authored uniform grid", () => {
    const shape = shapeOf([...LADDER_ORDER]);
    assert.deepEqual(renderedDelays(shape), [0, 60, 120, 180, 240, 300, 360, 420, 480, 540]);
  });

  test("the live shape measured on a real account is even, where the old table was not", () => {
    /* `context`, the waiting block and `your record` were all null: three
       holes in the authored table, which produced 0/60/180/240/360/480/540
       and gaps of 60, 120, 60, 120, 120, 60. */
    const shape = shapeOf([
      "dateRule",
      "greeting",
      "marketHead",
      "marketBand",
      "brief",
      "deskRecord",
      "stories",
    ]);
    const delays = renderedDelays(shape);
    assert.equal(delays.length, 7);
    assert.deepEqual(delays, [0, 60, 120, 180, 240, 300, 360]);
    assert.deepEqual(gapsOf(delays), [60, 60, 60, 60, 60, 60]);
  });

  test("every gap is one interval, on all 64 renderable shapes", () => {
    for (const { present, shape } of allShapes()) {
      const delays = renderedDelays(shape);
      assert.equal(delays.length, present.length, `rung count for ${present.join(",")}`);
      assert.equal(delays[0], 0, `first rung for ${present.join(",")}`);
      for (const gap of gapsOf(delays)) {
        assert.equal(gap, STAGGER_MS, `gap for ${present.join(",")}`);
      }
    }
  });

  test("a rung that does not render consumes no step", () => {
    const withContext = ladderDelays(shapeOf([...LADDER_ORDER]));
    const withoutContext = ladderDelays(
      shapeOf(LADDER_ORDER.filter((rung) => rung !== "context")),
    );
    /* Everything below the hole moves UP one rung rather than leaving a gap. */
    assert.equal(withContext.marketHead, 180);
    assert.equal(withoutContext.marketHead, 120);
    assert.equal(withContext.stories, 540);
    assert.equal(withoutContext.stories, 480);
  });

  test("the market band always follows its own heading by one interval", () => {
    for (const { shape } of allShapes()) {
      if (!shape.marketHead) continue;
      const delays = ladderDelays(shape);
      assert.equal(delays.marketBand - delays.marketHead, STAGGER_MS);
    }
  });
});

describe("the desk record's proportion bars", () => {
  test("sweep after the rule that introduces them, on every ladder length", () => {
    for (const { shape } of allShapes()) {
      if (!shape.deskRecord) continue;
      const base = ladderDelays(shape).deskRecord;
      for (const offset of BAR_OFFSETS) {
        assert.ok(base + offset > base, "a bar must never precede its heading");
      }
      /* And after the NEXT rung too, where there is one: the bars belong to
         the section, not to the seam between two of them. */
      assert.ok(base + BAR_OFFSETS[0] > base);
    }
  });

  test("keep their own 40ms cadence, which is not the rise interval", () => {
    assert.deepEqual(gapsOf([...BAR_OFFSETS]), [40, 40, 40]);
    assert.notEqual(BAR_OFFSETS[1] - BAR_OFFSETS[0], STAGGER_MS);
  });

  test("reproduce the shipped absolute delays on the full render", () => {
    const base = ladderDelays(shapeOf([...LADDER_ORDER])).deskRecord;
    assert.deepEqual(
      BAR_OFFSETS.map((offset) => base + offset),
      [500, 540, 580, 620],
    );
  });
});
