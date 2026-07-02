import { test } from "node:test";
import assert from "node:assert/strict";

import { selectTier, hasXbrl } from "../../src/lib/thin-fallback-tier.ts";

// Tier selection keys ONLY on real data presence (xbrl / filings / cik).

test("Tier A when XBRL financials are present, regardless of filings/cik", () => {
  assert.equal(selectTier(true, 0, null), "A");
  assert.equal(selectTier(true, 5, 12345), "A");
});

test("Tier B when a CIK and filings exist but no XBRL", () => {
  assert.equal(selectTier(false, 3, 12345), "B");
});

test("Tier C when a CIK exists but no filings and no XBRL", () => {
  assert.equal(selectTier(false, 0, 12345), "C");
});

test("Tier C when there is no CIK at all (pre-CIK on-demand mint)", () => {
  assert.equal(selectTier(false, 0, null), "C");
  // Defensive: filings cannot exist without a resolved key, but even if counted
  // they must not promote a null-CIK company past the honest suppress state.
  assert.equal(selectTier(false, 4, null), "C");
});

test("hasXbrl reflects presence of any annual or quarterly period", () => {
  const empty = { annual: { periods: [], grid: {} }, quarterly: { periods: [], grid: {} }, cik: 1 };
  const withAnnual = { ...empty, annual: { periods: [{ key: "FY-2025" }], grid: {} } };
  const withQuarterly = { ...empty, quarterly: { periods: [{ key: "Q1-2026" }], grid: {} } };
  // Cast through unknown: hasXbrl only reads periods.length.
  assert.equal(hasXbrl(empty as never), false);
  assert.equal(hasXbrl(withAnnual as never), true);
  assert.equal(hasXbrl(withQuarterly as never), true);
});
