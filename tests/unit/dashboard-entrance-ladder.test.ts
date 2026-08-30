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
    assert.deepEqual(renderedDelays(shape), [0, 40, 80, 120, 160, 200, 240, 280, 320, 360]);
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
    assert.deepEqual(delays, [0, 40, 80, 120, 160, 200, 240]);
    assert.deepEqual(gapsOf(delays), [40, 40, 40, 40, 40, 40]);
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
    assert.equal(withContext.marketHead, 120);
    assert.equal(withoutContext.marketHead, 80);
    assert.equal(withContext.stories, 360);
    assert.equal(withoutContext.stories, 320);
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

  test("keep their own 40ms cadence, which is theirs and not the rungs'", () => {
    /* Asserted as a literal rather than against STAGGER_MS. The two are equal
       this round and that is a coincidence of the ruling, not a link: the
       sweep is a horizontal scaleX and does not track the rise ladder. If the
       rung interval moves again, this stays 40 and this test still holds. */
    assert.deepEqual(gapsOf([...BAR_OFFSETS]), [40, 40, 40]);
  });

  test("the lead-in is a beat: at least one 60Hz frame, under one rung", () => {
    /* The two bounds the lead-in was derived from. A proportional rescale of
       the old 20ms to the 40ms grid gives 13.3ms, which fails the lower bound
       and would put the first sweep on the same frame as its own heading. */
    const FRAME_60HZ = 1000 / 60;
    assert.ok(BAR_OFFSETS[0] >= FRAME_60HZ, "lead-in must be at least one frame");
    assert.ok(BAR_OFFSETS[0] < STAGGER_MS, "lead-in must stay inside its own rung");
  });

  test("absolutes on the full render follow the ladder, they are not pinned", () => {
    const base = ladderDelays(shapeOf([...LADDER_ORDER])).deskRecord;
    assert.equal(base, 320);
    assert.deepEqual(
      BAR_OFFSETS.map((offset) => base + offset),
      [340, 380, 420, 460],
    );
    /* And the whole group is spent inside the ladder it sits in: the last
       sweep starts at 460 and runs 400ms, against a last rung at 360 + 720. */
    assert.ok(base + BAR_OFFSETS[BAR_OFFSETS.length - 1] + 400 <= 360 + 720);
  });
});
