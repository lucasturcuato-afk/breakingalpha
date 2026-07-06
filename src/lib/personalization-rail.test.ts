import { describe, it, expect, vi } from "vitest";
import {
  applyRailPersonalization,
  personalizeRailOrder,
  resolvePersonalizationMode,
  itemMatchesWatchlist,
  type RailItem,
  type RailProfile,
} from "./personalization-rail";

const rail: RailItem[] = [
  { id: "a", sector: "Technology", tags: ["AAPL"], adjustedScore: 10 },
  { id: "b", sector: "Energy", tags: ["XOM"], adjustedScore: 9 },
  { id: "c", sector: "Healthcare", tags: ["PFE"], adjustedScore: 8 },
];

const profile: RailProfile = { watchlist_tickers: ["XOM"], sectors: ["Healthcare"] };

describe("resolvePersonalizationMode", () => {
  it("coerces unknown to off", () => {
    expect(resolvePersonalizationMode("nonsense")).toBe("off");
    expect(resolvePersonalizationMode(undefined)).toBe("off");
    expect(resolvePersonalizationMode("SHADOW")).toBe("shadow");
    expect(resolvePersonalizationMode(" active ")).toBe("active");
  });
});

describe("personalizeRailOrder (pure)", () => {
  it("reorders by watchlist then sector bonus, dropping/adding nothing", () => {
    const out = personalizeRailOrder(rail, profile);
    // b: 9 + 5 (watchlist) = 14; c: 8 + 2 (sector) = 10; a: 10.
    expect(out.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(out).toHaveLength(rail.length);
    expect(new Set(out.map((i) => i.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("is stable for equal scores (original order preserved)", () => {
    const flat: RailItem[] = [
      { id: "x", adjustedScore: 5 },
      { id: "y", adjustedScore: 5 },
      { id: "z", adjustedScore: 5 },
    ];
    expect(personalizeRailOrder(flat, {}).map((i) => i.id)).toEqual(["x", "y", "z"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rail];
    personalizeRailOrder(rail, profile);
    expect(rail).toEqual(copy);
  });
});

describe("applyRailPersonalization (gate)", () => {
  it("off: returns the exact input (byte-identical order and reference)", () => {
    const out = applyRailPersonalization(rail, profile, "off");
    expect(out).toBe(rail);
  });

  it("shadow: logs a diff but returns the original order", () => {
    const log = vi.fn();
    const out = applyRailPersonalization(rail, profile, "shadow", log);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("shadow");
    expect(log.mock.calls[0][0]).toContain('"personalized":["b","a","c"]');
  });

  it("active: returns the personalized order", () => {
    const out = applyRailPersonalization(rail, profile, "active", () => {});
    expect(out.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("fail-closed: missing profile returns the original order", () => {
    expect(applyRailPersonalization(rail, null, "active", () => {})).toBe(rail);
    expect(applyRailPersonalization(rail, {}, "active", () => {})).toBe(rail);
  });

  it("fail-closed: empty rail returns input", () => {
    const empty: RailItem[] = [];
    expect(applyRailPersonalization(empty, profile, "active", () => {})).toBe(empty);
  });
});

describe("itemMatchesWatchlist", () => {
  it("case-insensitive ticker match, false when no watchlist", () => {
    expect(itemMatchesWatchlist({ id: "a", tags: ["xom"] }, profile)).toBe(true);
    expect(itemMatchesWatchlist({ id: "a", tags: ["AAPL"] }, profile)).toBe(false);
    expect(itemMatchesWatchlist({ id: "a", tags: ["XOM"] }, {})).toBe(false);
  });
});
