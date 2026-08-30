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
  TREND_SELECT,
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
    top_companies: [],
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

test("timeAgo refuses to render a negative or unparseable age", () => {
  // The reader's clock, not the server's. A phone running behind must not
  // render "-3m ago" on a cluster written seconds ago.
  assert.equal(timeAgo(new Date(NOW + 3 * 60000).toISOString(), NOW), "0m ago");
  assert.equal(timeAgo("not a date", NOW), "");
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
  assert.equal(counts.low, 1);
  assert.equal(counts.newThisWeek, 4);
});

// The bug this file did not catch: the chip row read three tiers against a
// four-tier total, so 34 of 462 production clusters printed "Low" on the card
// with no chip above to find them under. The tiers must exhaust the total.
test("the four level counts sum to the total", () => {
  const signals = [0.95, 0.8, 0.79, 0.6, 0.59, 0.4, 0.39, 0.2, 0].map((strength_score, i) =>
    row({ id: String(i), strength_score }),
  );
  const counts = trendCounts(signals, NOW);
  assert.equal(counts.critical + counts.high + counts.medium + counts.low, counts.total);
  assert.deepEqual(
    [counts.critical, counts.high, counts.medium, counts.low],
    [2, 2, 2, 3],
  );
});

test("applyLens is exclusive, and mine with no sectors matches nothing", () => {
  const signals = [
    row({ id: "1", strength_score: 0.9, top_sectors: ["Utilities"] }),
    row({ id: "2", strength_score: 0.65, top_sectors: ["Healthcare"] }),
    row({ id: "3", strength_score: 0.12, top_sectors: ["Materials"] }),
  ];
  assert.equal(applyLens(signals, "all", []).length, 3);
  assert.deepEqual(applyLens(signals, "critical", []).map((s) => s.id), ["1"]);
  assert.deepEqual(applyLens(signals, "high", []).map((s) => s.id), ["2"]);
  assert.deepEqual(applyLens(signals, "low", []).map((s) => s.id), ["3"]);
  assert.equal(applyLens(signals, "mine", []).length, 0);
  assert.deepEqual(applyLens(signals, "mine", ["utilities"]).map((s) => s.id), ["1"]);
});

test("trendTags reads sectors then themes, deduplicated, capped", () => {
  const s = row({ top_sectors: ["utilities"], top_themes: ["capacity", "Utilities", "emerging", "extra"] });
  assert.deepEqual(trendTags(s), ["Utilities", "Capacity", "Emerging"]);
});

test("trendTitle reproduces all four of the desktop route's branches", () => {
  // 1. Headline wins outright.
  assert.equal(trendTitle(row({ headline: "Grid capacity contracting" })), "Grid capacity contracting");

  // 2. Theme plus company. This is the branch that used to be missing, and the
  //    one that made a headline-less cluster read as its raw label on mobile
  //    and as a composed phrase on the desk, off the same row.
  assert.equal(
    trendTitle(
      row({
        label: "energy, nuclear ppa",
        top_themes: ["nuclear"],
        top_companies: ["CONSTELLATION"],
      }),
    ),
    "Nuclear Activity Around Constellation",
  );

  // Multi-word companies are title-cased per word, as the route does it.
  assert.equal(
    trendTitle(row({ top_themes: ["nuclear"], top_companies: ["constellation energy corp"] })),
    "Nuclear Activity Around Constellation Energy Corp",
  );

  // 3. Theme only.
  assert.equal(trendTitle(row({ top_themes: ["nuclear"] })), "Nuclear Trend Detected");

  // Single-character themes are filtered out by the route, so they must not
  // reach either middle branch here either.
  assert.equal(
    trendTitle(row({ label: "Energy: grid capacity", top_themes: ["x"], top_companies: ["Vistra"] })),
    "Energy, grid capacity",
  );

  // 4. The label, and the one deliberate difference: a comma, never U+2014.
  const fallback = trendTitle(row({ label: "Energy: grid capacity" }));
  assert.equal(fallback, "Energy, grid capacity");
  assert.ok(!fallback.includes("\u2014"));
});

test("TREND_SELECT fetches every column the derivations read", () => {
  // trendTitle reads top_companies. A select that omitted it would leave the
  // middle branches permanently unreachable in production while the unit tests
  // above still passed on hand-built rows.
  const columns = TREND_SELECT.split(",").map((c) => c.trim());
  for (const needed of [
    "id",
    "label",
    "headline",
    "tagline",
    "article_count",
    "source_count",
    "strength_score",
    "top_themes",
    "top_sectors",
    "top_companies",
    "created_at",
  ]) {
    assert.ok(columns.includes(needed), `TREND_SELECT is missing ${needed}`);
  }
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
