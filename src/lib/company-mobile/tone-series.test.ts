import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BAND_COUNT,
  BAND_DAYS,
  MIN_READABLE_BANDS,
  toneSeriesView,
  type ToneSeriesBody,
  type ToneSeriesPoint,
} from "./tone-series";
import { LEVEL_MIN_N, computeTone, type SentimentLabel } from "@/lib/tone";

/**
 * The tone strip's view model.
 *
 * WHY UNIT AND NOT E2E. The states this has to keep apart are dense, sparse,
 * empty, failed and malformed, and most of them are reachable in a browser only
 * by finding a company that happens to be in that shape today. A corpus that
 * re-ingests every day is not a test fixture. These pin the decision against
 * bodies shaped exactly like the route's, which is the seam that has to be
 * right; the rendered geometry is measured separately and reported in the PR.
 *
 * EVERY EXPECTED LEVEL IS PRODUCED BY `computeTone`, never hand-written. The
 * strip's whole claim is that it buckets a mean the same way the headline does,
 * and a test that restates the calibrated cuts by hand would pass happily after
 * somebody moved them. `headlineLabel` below feeds the same labels through both
 * paths and asserts they agree.
 */

const DAY_MS = 86_400_000;

/** The instant the fixtures below pretend the route answered at. */
const DEFAULT_NOW = Date.parse("2026-09-03T09:00:00Z");

/** A body whose `rangeStart` is the route's own `now - 30 days`. */
function bodyAt(points: ToneSeriesPoint[], nowMs = DEFAULT_NOW): ToneSeriesBody {
  return {
    company: "Testco",
    range: "30d",
    rangeStart: new Date(nowMs - 30 * DAY_MS).toISOString(),
    points,
  };
}

/**
 * A day of mentions, `ageDays` before the body's "now".
 *
 * The score is a mean of per-mention sentiment, exactly as the route computes
 * it, so a caller states labels and never a float.
 */
function day(ageDays: number, labels: SentimentLabel[], nowMs = DEFAULT_NOW): ToneSeriesPoint {
  const s = (l: SentimentLabel) => (l === "bullish" ? 1 : l === "bearish" ? -1 : 0);
  const sum = labels.reduce((a, l) => a + s(l), 0);
  return {
    date: new Date(nowMs - ageDays * DAY_MS).toISOString().slice(0, 10),
    score: sum / labels.length,
    n: labels.length,
  };
}

/** The level word `computeTone` would give the same labels. */
function headlineLabel(labels: SentimentLabel[]): string {
  return computeTone(labels, []).levelLabel;
}

const bull = (n: number): SentimentLabel[] => Array.from({ length: n }, () => "bullish" as const);
const bear = (n: number): SentimentLabel[] => Array.from({ length: n }, () => "bearish" as const);
const neut = (n: number): SentimentLabel[] => Array.from({ length: n }, () => "neutral" as const);

describe("toneSeriesView, the four states", () => {
  it("DENSE: four readable weeks draw four bands, oldest first", () => {
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([
        day(2, bull(20)),
        day(9, [...bull(10), ...neut(10)]),
        day(16, [...bull(5), ...bear(5), ...neut(2)]),
        day(23, bear(9)),
      ]),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    assert.equal(view.bands.length, BAND_COUNT);
    assert.equal(view.readable, 4);
    assert.deepEqual(
      view.bands.map((b) => b.kind),
      ["reading", "reading", "reading", "reading"],
    );
    // Oldest first: the bearish week is on the left, the bullish one on the right.
    assert.deepEqual(
      view.bands.map((b) => (b.kind === "reading" ? b.polarity : "void")),
      ["negative", "mixed", "positive", "positive"],
    );
  });

  it("DENSE: a band buckets the mean exactly as the headline does", () => {
    const cases: SentimentLabel[][] = [
      bull(8),
      [...bull(6), ...neut(2)],
      [...bull(4), ...bear(4)],
      [...bear(6), ...neut(2)],
      bear(8),
    ];
    for (const labels of cases) {
      const view = toneSeriesView({
        phase: "answered",
        body: bodyAt([day(2, labels), day(9, bull(5))]),
      });
      assert.equal(view.kind, "drawn");
      if (view.kind !== "drawn") return;
      const newest = view.bands[BAND_COUNT - 1];
      assert.equal(newest.kind, "reading");
      if (newest.kind !== "reading") return;
      assert.equal(newest.label, headlineLabel(labels), `mismatch on ${labels.join(",")}`);
    }
  });

  it("DENSE: a band mean is taken over mentions, not over daily means", () => {
    /* One day carrying eighty bearish mentions and one carrying a single
       bullish one is a negative week. Averaging the two DAILY means would call
       it balanced, which is the failure this weighting exists to prevent. */
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(1, bear(80)), day(3, bull(1)), day(9, bull(5))]),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    const newest = view.bands[BAND_COUNT - 1];
    assert.equal(newest.kind, "reading");
    if (newest.kind !== "reading") return;
    assert.equal(newest.polarity, "negative");
    assert.equal(newest.mentions, 81);
  });

  it("DENSE: eight bearish against one bullish stays Strongly Negative", () => {
    /* The smallest statement of the same rule, and the one a day-grain mean
       gets wrong in the other direction: two days, means of -1 and +1, average
       to zero and the week reads balanced. Over the nine mentions the week is
       -7/9, which is past the strong cut. */
    const labels = [...bear(8), ...bull(1)];
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(1, bear(8)), day(3, bull(1)), day(9, bull(5))]),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    const newest = view.bands[BAND_COUNT - 1];
    assert.equal(newest.kind, "reading");
    if (newest.kind !== "reading") return;
    assert.equal(newest.label, headlineLabel(labels));
    assert.equal(newest.label, "Strongly Negative");
    assert.equal(newest.step, -2);
    assert.equal(newest.mentions, 9);
  });

  it("DENSE: a band mean sitting exactly on a cut is not carried across it", () => {
    /* FLOAT DRIFT, and the reason the weighted sum is snapped back to the
       integer it is. One bearish mention on one day, and 32 bullish against 7
       bearish on another, is 24 net over 40 mentions: a mean of exactly the
       strong cut, which the calibration reads as the MILDER bucket. Rebuilt as
       `score * n` through the per-day float mean, that sum comes out a few
       parts in 10^16 high, the mean lands just over the cut, and the band draws
       one step harsher than `computeTone` over the identical labels. */
    const labels: SentimentLabel[] = [...bear(1), ...bull(32), ...bear(7)];
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(1, bear(1)), day(2, [...bull(32), ...bear(7)]), day(9, bull(5))]),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    const newest = view.bands[BAND_COUNT - 1];
    assert.equal(newest.kind, "reading");
    if (newest.kind !== "reading") return;
    assert.equal(newest.mentions, 40);
    assert.equal(newest.label, headlineLabel(labels));
    assert.equal(newest.step, 1);
  });

  it("SPARSE: a week under LEVEL_MIN_N is a void, never a zero", () => {
    const thin = LEVEL_MIN_N - 1;
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(2, bull(thin)), day(9, bull(6)), day(16, bull(6))]),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    const newest = view.bands[BAND_COUNT - 1];
    assert.equal(newest.kind, "void");
    assert.equal(newest.mentions, thin);
    assert.equal(view.readable, 2);
    // The void week is named in the read-out rather than skipped over.
    assert.match(view.announcement, /the past week, no reading/);
  });

  it("SPARSE: a single-mention day cannot reach the strip on its own", () => {
    /* Nearly half of live company-days carry exactly one scored mention, whose
       mean is -1, 0 or +1. On a signed axis every one of them is a full
       deflection spike. Under the floor they are voids, which is the whole
       design. */
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(1, bull(1)), day(8, bear(1)), day(15, bull(1)), day(22, bear(1))]),
    });
    assert.equal(view.kind, "absent");
  });

  it("SPARSE: one readable week is not a series and draws nothing", () => {
    assert.equal(MIN_READABLE_BANDS, 2);
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(2, bull(15)), day(9, bull(1)), day(16, bear(2))]),
    });
    assert.equal(view.kind, "absent");
  });

  it("SPARSE: a quiet current week still draws the weeks behind it", () => {
    /* The shape a live large-cap was measured in: a single mention in the
       current window against a busy month behind it. The headline correctly
       states no level; the strip shows the reading that existed and has gone
       quiet. */
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(3, bull(1)), day(10, bull(8)), day(17, bull(28)), day(24, neut(39))]),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    assert.equal(view.readable, 3);
    assert.equal(view.bands[BAND_COUNT - 1].kind, "void");
  });

  it("EMPTY: a body with no points draws nothing at all", () => {
    const view = toneSeriesView({ phase: "answered", body: bodyAt([]) });
    assert.equal(view.kind, "absent");
  });

  it("FAILED: a failed read is never an empty one", () => {
    assert.equal(toneSeriesView({ phase: "failed", body: null }).kind, "failed");
    // Answered with no body at all is a read that did not answer either.
    assert.equal(toneSeriesView({ phase: "answered", body: null }).kind, "failed");
    // A body whose points are not an array is a shape this cannot trust.
    assert.equal(
      toneSeriesView({
        phase: "answered",
        body: { company: "x", range: "30d", rangeStart: "", points: null as never },
      }).kind,
      "failed",
    );
  });

  it("FAILED and EMPTY are different views, and neither is the other", () => {
    const failed = toneSeriesView({ phase: "failed", body: null });
    const empty = toneSeriesView({ phase: "answered", body: bodyAt([]) });
    assert.notEqual(failed.kind, empty.kind);
    assert.equal(failed.kind, "failed");
    assert.equal(empty.kind, "absent");
  });
});

describe("toneSeriesView, a 200 that is not an answer", () => {
  /* A READ THAT DID NOT ANSWER MUST NEVER RENDER AS ONE THAT ANSWERED EMPTY.
     Transport failures were already handled: an abort and an HTTP 500 both land
     in `failed`. A 200 carrying a body the strip cannot read did not: it folded
     into four empty bands, fell under the readable floor and came out `absent`,
     which draws nothing at all and is pixel-identical to a company with
     genuinely too little coverage. */
  const points = [day(2, bull(9)), day(9, bull(9))];

  it("an unparseable window start is a failed read, not an empty one", () => {
    const view = toneSeriesView({
      phase: "answered",
      body: { company: "x", range: "30d", rangeStart: "not-a-date", points },
    });
    assert.equal(view.kind, "failed");
  });

  it("a missing or non-string window start is a failed read", () => {
    const shapes = ["", undefined as never, null as never, 17 as never, {} as never];
    for (const rangeStart of shapes) {
      const view = toneSeriesView({
        phase: "answered",
        body: { company: "x", range: "30d", rangeStart, points },
      });
      assert.equal(view.kind, "failed", `rangeStart ${String(rangeStart)} must not draw absent`);
    }
  });

  it("the same points under a readable window start do draw", () => {
    // The guard rejects the SHAPE of the answer, never the data behind it.
    assert.equal(toneSeriesView({ phase: "answered", body: bodyAt(points) }).kind, "drawn");
  });
});

describe("toneSeriesView, the pending read", () => {
  it("draws nothing and reserves nothing while the read is in flight", () => {
    /* No gate, no stand-in line, no reserved box, at any age. A pending view
       that ever drew a height would have to take that height back on every
       company that resolves to `absent`, which is most of them. */
    const view = toneSeriesView({ phase: "pending" });
    assert.equal(view.kind, "pending");
    assert.deepEqual(Object.keys(view), ["kind"]);
  });
});

describe("toneSeriesView, the window", () => {
  it("fixes now off rangeStart and never off the reader's clock", () => {
    /* A body dated a year ago must fold identically, because "now" is the
       instant the ROUTE answered. Reading Date.now() here would empty it. */
    const oldNow = Date.parse("2025-01-15T00:00:00Z");
    const points = [0, 7, 14, 21].map((age) => day(age + 1, bull(6), oldNow));
    const view = toneSeriesView({ phase: "answered", body: bodyAt(points, oldNow) });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    assert.equal(view.readable, BAND_COUNT);
  });

  it("drops a day older than the four weeks it draws", () => {
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(2, bull(6)), day(9, bull(6)), day(BAND_COUNT * BAND_DAYS + 1, bull(50))]),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    assert.equal(view.readable, 2);
    // The dropped day's 50 mentions must not reach the caption's count.
    assert.match(view.caption, /12 mentions/);
  });

  /* THE CURRENT DAY, AT EVERY HOUR THE ROUTE CAN ANSWER AT.
   *
   * The defect these pin: "now" was derived as `rangeStart + 30 days`, which
   * still carries the route's wall clock, and every point was pinned to 12:00
   * UTC. For any answer before noon UTC the current day came out with a
   * NEGATIVE age and was skipped, so for half of every day the newest band drew
   * as a void with a count of zero and the day's entire mention set went
   * missing. The tests that shipped with it never exercised an age of zero at
   * any hour, which is exactly why it passed.
   *
   * Both sides are day numbers now, so the answer hour cannot reach the fold.
   */
  const HOURS = [
    "00:00:00",
    "00:00:01",
    "06:00:00",
    "09:00:00",
    "11:59:59",
    "12:00:00",
    "12:00:01",
    "18:00:00",
    "23:00:00",
    "23:59:59",
  ];

  for (const hour of HOURS) {
    it(`counts the current day into the newest band when the route answers at ${hour}Z`, () => {
      const nowMs = Date.parse(`2026-09-03T${hour}Z`);
      const today: SentimentLabel[] = [...bull(7), ...bear(1)];
      const view = toneSeriesView({
        phase: "answered",
        body: bodyAt([day(0, today, nowMs), day(9, bull(6), nowMs)], nowMs),
      });
      assert.equal(view.kind, "drawn");
      if (view.kind !== "drawn") return;
      const newest = view.bands[BAND_COUNT - 1];
      assert.equal(newest.kind, "reading", `newest band void at ${hour}Z`);
      if (newest.kind !== "reading") return;
      // The whole day, not part of it, and the level the headline would state.
      assert.equal(newest.mentions, 8, `current day dropped at ${hour}Z`);
      assert.equal(newest.label, headlineLabel(today));
      assert.match(view.caption, /14 mentions/);
    });
  }

  it("the current day survives even when it is the only day in its band", () => {
    /* The live shape the sweep found: a company whose newest band carries the
       current day and nothing else. Before the fix that whole band emptied for
       any answer before noon, and the strip lost a week it could read. */
    for (const hour of ["00:00:00", "11:59:59", "12:00:01", "23:59:59"]) {
      const nowMs = Date.parse(`2026-09-03T${hour}Z`);
      const view = toneSeriesView({
        phase: "answered",
        body: bodyAt([day(0, bull(9), nowMs), day(10, bull(9), nowMs)], nowMs),
      });
      assert.equal(view.kind, "drawn", `not drawn at ${hour}Z`);
      if (view.kind !== "drawn") return;
      assert.equal(view.readable, 2, `readable bands wrong at ${hour}Z`);
      assert.equal(view.bands[BAND_COUNT - 1].mentions, 9, `current day dropped at ${hour}Z`);
    }
  });

  it("a day dated after the answer is still dropped", () => {
    /* Snapping to day numbers must not switch the guard off: a point dated
       tomorrow is not a point in the trailing four weeks. */
    const nowMs = Date.parse("2026-09-03T23:00:00Z");
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt(
        [day(-1, bull(50), nowMs), day(0, bull(9), nowMs), day(9, bull(9), nowMs)],
        nowMs,
      ),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    assert.equal(view.bands[BAND_COUNT - 1].mentions, 9);
    assert.match(view.caption, /18 mentions/);
  });
});

describe("toneSeriesView, the copy", () => {
  it("caption states a count and never a rate", () => {
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(2, bull(6)), day(9, bear(4))]),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    assert.equal(view.caption, "4 weeks, oldest first · 10 mentions");
    /* A CLOSED SHAPE, not a list of forbidden words. An earlier draft spelled
       the words a caption may not carry into a blocklist regex, and the design
       lint flagged the assertion line itself. Pinning the whole caption to one
       pattern is the stronger check anyway: the only figures it can carry are
       two integers, so nothing divided can reach it. */
    assert.match(view.caption, /^\d+ weeks, oldest first · \d+ mentions$/);
  });

  it("read-out names every week in the order drawn", () => {
    const view = toneSeriesView({
      phase: "answered",
      body: bodyAt([day(2, bull(6)), day(9, bull(6)), day(16, bull(1)), day(23, bear(6))]),
    });
    assert.equal(view.kind, "drawn");
    if (view.kind !== "drawn") return;
    const spoken = view.announcement;
    assert.match(spoken, /^Tone by week, oldest first\./);
    assert.ok(spoken.indexOf("4 weeks ago") < spoken.indexOf("3 weeks ago"));
    assert.ok(spoken.indexOf("3 weeks ago") < spoken.indexOf("2 weeks ago"));
    assert.ok(spoken.indexOf("2 weeks ago") < spoken.indexOf("the past week"));
    // The thin week is spoken as an absence, not as a number.
    assert.match(spoken, /3 weeks ago, no reading, 1 mention/);
    assert.doesNotMatch(spoken, /1 weeks ago/);
  });
});
