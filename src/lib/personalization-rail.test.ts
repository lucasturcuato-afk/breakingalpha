/**
 * Unit tests for personalization-rail.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/personalization-rail.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRailPersonalization,
  personalizeRailOrder,
  resolvePersonalizationMode,
  itemMatchesWatchlist,
  type RailItem,
  type RailProfile,
} from "./personalization-rail";
import { applyStoryRailWindow } from "./story-rail-window";

const rail: RailItem[] = [
  { id: "a", sector: "Technology", tags: ["AAPL"], adjustedScore: 10 },
  { id: "b", sector: "Energy", tags: ["XOM"], adjustedScore: 9 },
  { id: "c", sector: "Healthcare", tags: ["PFE"], adjustedScore: 8 },
];

const profile: RailProfile = { watchlist_tickers: ["XOM"], sectors: ["Healthcare"] };

test("resolvePersonalizationMode coerces unknown to off", () => {
  assert.equal(resolvePersonalizationMode("nonsense"), "off");
  assert.equal(resolvePersonalizationMode(undefined), "off");
  assert.equal(resolvePersonalizationMode("SHADOW"), "shadow");
  assert.equal(resolvePersonalizationMode(" active "), "active");
});

test("personalizeRailOrder reorders by watchlist then sector bonus, dropping/adding nothing", () => {
  const out = personalizeRailOrder(rail, profile);
  // b: 9 + 5 (watchlist) = 14; c: 8 + 2 (sector) = 10; a: 10 (tiebreak keeps a before c).
  assert.deepEqual(out.map((i) => i.id), ["b", "a", "c"]);
  assert.equal(out.length, rail.length);
  assert.deepEqual(new Set(out.map((i) => i.id)), new Set(["a", "b", "c"]));
});

test("personalizeRailOrder is stable for equal scores (original order preserved)", () => {
  const flat: RailItem[] = [
    { id: "x", adjustedScore: 5 },
    { id: "y", adjustedScore: 5 },
    { id: "z", adjustedScore: 5 },
  ];
  assert.deepEqual(personalizeRailOrder(flat, {}).map((i) => i.id), ["x", "y", "z"]);
});

test("personalizeRailOrder does not mutate the input array", () => {
  const copy = [...rail];
  personalizeRailOrder(rail, profile);
  assert.deepEqual(rail, copy);
});

test("applyRailPersonalization off returns the exact input (byte-identical order and reference)", () => {
  const out = applyRailPersonalization(rail, profile, "off");
  assert.equal(out, rail);
});

test("applyRailPersonalization shadow logs a diff but returns the original order", () => {
  const logs: string[] = [];
  const out = applyRailPersonalization(rail, profile, "shadow", (m) => logs.push(m));
  assert.deepEqual(out.map((i) => i.id), ["a", "b", "c"]);
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes("shadow"));
  assert.ok(logs[0].includes('"personalized":["b","a","c"]'));
});

test("applyRailPersonalization active returns the personalized order", () => {
  const out = applyRailPersonalization(rail, profile, "active", () => {});
  assert.deepEqual(out.map((i) => i.id), ["b", "a", "c"]);
});

test("applyRailPersonalization fail-closed: missing profile returns the original order", () => {
  assert.equal(applyRailPersonalization(rail, null, "active", () => {}), rail);
  assert.equal(applyRailPersonalization(rail, {}, "active", () => {}), rail);
});

test("applyRailPersonalization fail-closed: empty rail returns input", () => {
  const empty: RailItem[] = [];
  assert.equal(applyRailPersonalization(empty, profile, "active", () => {}), empty);
});

test("itemMatchesWatchlist is case-insensitive and false when no watchlist", () => {
  assert.equal(itemMatchesWatchlist({ id: "a", tags: ["xom"] }, profile), true);
  assert.equal(itemMatchesWatchlist({ id: "a", tags: ["AAPL"] }, profile), false);
  assert.equal(itemMatchesWatchlist({ id: "a", tags: ["XOM"] }, {}), false);
});

test("applyStoryRailWindow off restores the stored shared-rail order (byte-identical)", () => {
  const ids = ["c", "a", "b"]; // stored shared order
  const out = applyStoryRailWindow(rail, ids, profile, "off");
  assert.deepEqual(out.map((i) => i.id), ["c", "a", "b"]);
});

test("applyStoryRailWindow active personalizes the windowed order", () => {
  const ids = ["c", "a", "b"]; // stored shared order fed to the personalizer
  const out = applyStoryRailWindow(rail, ids, profile, "active");
  // From base scores: b 9+5=14, c 8+2=10, a 10 (c before a by tiebreak: c precedes a in the windowed input).
  assert.deepEqual(out.map((i) => i.id), ["b", "c", "a"]);
});

test("applyStoryRailWindow fail-closed: missing profile serves the shared order", () => {
  const ids = ["b", "c", "a"];
  const out = applyStoryRailWindow(rail, ids, null, "active");
  assert.deepEqual(out.map((i) => i.id), ["b", "c", "a"]);
});
