import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLens,
  newestAgeHours,
  strengthToLevel,
  timeAgo,
  trendCounts,
  trendTags,
  trendTitle,
  type TrendSignal,
} from "./trend-signals";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");
const HOUR = 3600000;

function row(overrides: Partial<TrendSignal> = {}): TrendSignal {
  return {
    id: "a",
    label: "Grid capacity",
    headline: null,
    tagline: null,
    article_count: 10,
    source_count: 4,
    strength_score: 0.5,
    top_themes: [],
    top_sectors: [],
    created_at: new Date(NOW - HOUR).toISOString(),
    ...overrides,
  };
}

test("strengthToLevel keeps the protected route's cutoffs", () => {
  assert.equal(strengthToLevel(0.8), "critical");
  assert.equal(strengthToLevel(0.99), "critical");
  assert.equal(strengthToLevel(0.79), "high");
  assert.equal(strengthToLevel(0.6), "high");
  assert.equal(strengthToLevel(0.59), "medium");
  assert.equal(strengthToLevel(0.4), "medium");
  assert.equal(strengthToLevel(0.39), "low");
  assert.equal(strengthToLevel(0), "low");
});

test("timeAgo produces the three shapes the design draws", () => {
  assert.equal(timeAgo(new Date(NOW - 5 * 60000).toISOString(), NOW), "5m ago");
  assert.equal(timeAgo(new Date(NOW - 2.5 * HOUR).toISOString(), NOW), "2h ago");
  assert.equal(timeAgo(new Date(NOW - 30 * HOUR).toISOString(), NOW), "1d ago");
  assert.equal(timeAgo(null, NOW), "");
});

test("trendCounts derives every figure the screen renders", () => {
  const signals = [
    row({ id: "1", strength_score: 0.9 }),
    row({ id: "2", strength_score: 0.85 }),
    row({ id: "3", strength_score: 0.65 }),
    row({ id: "4", strength_score: 0.45 }),
    row({ id: "5", strength_score: 0.1, created_at: new Date(NOW - 40 * 24 * HOUR).toISOString() }),
  ];
  const counts = trendCounts(signals, NOW);
  assert.equal(counts.total, 5);
  assert.equal(counts.critical, 2);
  assert.equal(counts.high, 1);
  assert.equal(counts.medium, 1);
  assert.equal(counts.newThisWeek, 4);
});

test("applyLens is exclusive, and mine with no sectors matches nothing", () => {
  const signals = [
    row({ id: "1", strength_score: 0.9, top_sectors: ["Utilities"] }),
    row({ id: "2", strength_score: 0.65, top_sectors: ["Healthcare"] }),
  ];
  assert.equal(applyLens(signals, "all", []).length, 2);
  assert.deepEqual(applyLens(signals, "critical", []).map((s) => s.id), ["1"]);
  assert.deepEqual(applyLens(signals, "high", []).map((s) => s.id), ["2"]);
  assert.equal(applyLens(signals, "mine", []).length, 0);
  assert.deepEqual(applyLens(signals, "mine", ["utilities"]).map((s) => s.id), ["1"]);
});

test("trendTags reads sectors then themes, deduplicated, capped", () => {
  const s = row({ top_sectors: ["utilities"], top_themes: ["capacity", "Utilities", "emerging", "extra"] });
  assert.deepEqual(trendTags(s), ["Utilities", "Capacity", "Emerging"]);
});

test("trendTitle falls back without an em dash", () => {
  assert.equal(trendTitle(row({ headline: "Grid capacity contracting" })), "Grid capacity contracting");
  const fallback = trendTitle(row({ label: "Energy: grid capacity" }));
  assert.equal(fallback, "Energy, grid capacity");
  assert.ok(!fallback.includes("\u2014"));
});

test("newestAgeHours reads the freshest row and tolerates missing dates", () => {
  assert.equal(newestAgeHours([], NOW), null);
  assert.equal(newestAgeHours([row({ created_at: null })], NOW), null);
  assert.equal(
    newestAgeHours(
      [
        row({ id: "1", created_at: new Date(NOW - 50 * HOUR).toISOString() }),
        row({ id: "2", created_at: new Date(NOW - 3 * HOUR).toISOString() }),
      ],
      NOW,
    ),
    3,
  );
});
