import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BAND_COUNT,
  BAND_DAYS,
  MIN_READABLE_BANDS,
  SERIES_PENDING_ANNOUNCE_MS,
  toneSeriesView,
  type ToneSeriesBody,
  type ToneSeriesPoint,
} from "./tone-series";
import { LEVEL_MIN_N, computeTone, type SentimentLabel } from "@/lib/tone";

/**
 * The tone strip's view model.
 *
 * WHY UNIT AND NOT E2E. The four states this has to keep apart are dense,
 * sparse, empty and failed, and three of them are reachable in a browser only
 * by finding a company that happens to be in that shape today. A corpus that
 * re-ingests every day is not a test fixture. These pin the decision against
 * bodies shaped exactly like the route's, which is the seam that has to be
 * right; the rendered geometry is measured separately and reported in the PR.
 *
 * EVERY EXPECTED LEVEL IS PRODUCED BY `computeTone`, never hand-written. The
 * strip's whole claim is that it buckets a mean the same way the headline does,
 * and a test that restates the +-0.20 / +-0.60 cuts by hand would pass happily
 * after somebody moved them. `headlineLabel` below feeds the same labels
 * through both paths and asserts they agree.
 */

const DAY_MS = 86_400_000;

/** A body whose `rangeStart` is the route's own `now - 30 days`. */
function bodyAt(points: ToneSeriesPoint[], nowMs = Date.parse("2026-09-03T09:00:00Z")): ToneSeriesBody {
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
function day(ageDays: number, labels: SentimentLabel[]): ToneSeriesPoint {
  const now = Date.parse("2026-09-03T09:00:00Z");
  const s = (l: SentimentLabel) => (l === "bullish" ? 1 : l === "bearish" ? -1 : 0);
  const sum = labels.reduce((a, l) => a + s(l), 0);
  return {
    date: new Date(now - ageDays * DAY_MS).toISOString().slice(0, 10),
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
    /* 44% of live company-days carry exactly one scored mention, whose mean is
       -1, 0 or +1. On a signed axis every one of them is a full-deflection
       spike. Under the floor they are voids, which is the whole design. */
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
    /* State Street's live shape: 1 mention in the current window and 8, 28 and
       39 in the three before it. The headline correctly states no level; the
       strip shows the reading that existed and has gone quiet. */
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

describe("toneSeriesView, the pending gate", () => {
  it("stays silent until the gate opens, then says one line", () => {
    const early = toneSeriesView({ phase: "pending", elapsedMs: 0 });
    assert.equal(early.kind, "pending");
    if (early.kind !== "pending") return;
    assert.equal(early.announce, false);

    const late = toneSeriesView({ phase: "pending", elapsedMs: SERIES_PENDING_ANNOUNCE_MS });
    assert.equal(late.kind, "pending");
    if (late.kind !== "pending") return;
    assert.equal(late.announce, true);
  });
});

describe("toneSeriesView, the window", () => {
  it("fixes now off rangeStart and never off the reader's clock", () => {
    /* A body dated a year ago must fold identically, because "now" is the
       instant the ROUTE answered. Reading Date.now() here would empty it. */
    const oldNow = Date.parse("2025-01-15T00:00:00Z");
    const points = [0, 7, 14, 21].map((age) => {
      const s = (l: SentimentLabel) => (l === "bullish" ? 1 : l === "bearish" ? -1 : 0);
      const labels = bull(6);
      return {
        date: new Date(oldNow - (age + 1) * DAY_MS).toISOString().slice(0, 10),
        score: labels.reduce((a, l) => a + s(l), 0) / labels.length,
        n: labels.length,
      };
    });
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
