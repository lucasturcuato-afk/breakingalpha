/**
 * Unit tests for thesis-recommendation-guard.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/thesis-recommendation-guard.test.ts
 *
 * Mirrors the PR #389 brief-guard tests plus the thesis-specific directional-
 * title and recommended-vehicle guarantees.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectThesisViolations,
  hasThesisViolation,
  violationCount,
  stripDirectionalTitle,
  redactRationale,
  enforceThesisRecommendation,
} from "./thesis-recommendation-guard";

const CLEAN_TITLE = "AeroVironment Backlog Strengthens on New Orders";
const CLEAN_RATIONALE =
  "AeroVironment's order book is widening as allied drone procurement accelerates, and the backlog is not yet reflected in consensus. The asymmetry is whether deliveries convert the backlog on schedule. What invalidates this: a delivery slip disclosed at the next earnings call.";

test("clean thesis passes untouched", () => {
  assert.equal(violationCount(detectThesisViolations(CLEAN_TITLE, CLEAN_RATIONALE)), 0);
  assert.equal(hasThesisViolation(CLEAN_TITLE, CLEAN_RATIONALE), false);
});

test("directional titles rejected", () => {
  for (const title of [
    "Buy AeroVironment on Backlog Strength",
    "Long JPMorgan's European Retail Expansion",
    "Short Defense Suppliers Two Layers Down",
    "Avoid Regional Banks Into the Print",
    "Watch Optical Computing Reseller Spillover",
  ]) {
    const v = detectThesisViolations(title, CLEAN_RATIONALE);
    assert.ok(v.directionalTitle.length > 0, `prefix not caught: ${title}`);
  }
});

test("cleanest expression rejected", () => {
  const r = "The setup is asymmetric. The cleanest expression is AVAV, because it carries the purest drone exposure.";
  assert.ok(detectThesisViolations(CLEAN_TITLE, r).vehicle.length > 0);
  assert.equal(hasThesisViolation(CLEAN_TITLE, r), true);
});

test("recommendation phrases rejected", () => {
  for (const phrase of [
    "We recommend the name here.",
    "Investors should overweight the sector.",
    "You should add to the position now.",
    "The best way to play this is the ETF.",
    "Buy the dip on this name.",
    "Go long the supplier basket.",
    "Increase exposure to industrials.",
  ]) {
    assert.equal(hasThesisViolation(CLEAN_TITLE, phrase), true, `not caught: ${phrase}`);
  }
});

test("near-miss tokens do not trip", () => {
  const safe =
    "Sell-side desks turned constructive after the sell-off. The buy-side rotated into longer-duration names as the cycle shortened.";
  assert.equal(hasThesisViolation(CLEAN_TITLE, safe), false);
});

test("stripDirectionalTitle removes prefix, idempotent, leaves descriptive", () => {
  assert.equal(
    stripDirectionalTitle("Buy AeroVironment on Backlog Strength"),
    "AeroVironment on Backlog Strength",
  );
  assert.equal(stripDirectionalTitle("Short Defense Suppliers"), "Defense Suppliers");
  assert.equal(stripDirectionalTitle(CLEAN_TITLE), CLEAN_TITLE);
  const once = stripDirectionalTitle("Long JPMorgan Retail Expansion");
  assert.equal(stripDirectionalTitle(once), once);
});

test("redactRationale removes vehicle, keeps invalidation close", () => {
  const r =
    "AeroVironment's backlog is widening. The cleanest expression is AVAV, because it is the purest play. What invalidates this: a delivery slip at the next print.";
  const out = redactRationale(r);
  assert.equal(violationCount(detectThesisViolations("", out)), 0);
  assert.ok(out.includes("What invalidates this"));
  assert.ok(!out.toLowerCase().includes("cleanest expression"));
});

test("enforce: clean returns unchanged, no re-ask", async () => {
  const res = await enforceThesisRecommendation(CLEAN_TITLE, CLEAN_RATIONALE, {
    regenerate: async () => {
      throw new Error("should not re-ask");
    },
  });
  assert.equal(res.title, CLEAN_TITLE);
  assert.equal(res.reasked, false);
  assert.equal(res.stillViolating, false);
});

test("enforce: re-ask adopts clean draft", async () => {
  const res = await enforceThesisRecommendation(
    "Buy AeroVironment on Backlog Strength",
    "The cleanest expression is AVAV.",
    { regenerate: async () => ({ title: CLEAN_TITLE, rationale: CLEAN_RATIONALE }) },
  );
  assert.equal(res.title, CLEAN_TITLE);
  assert.equal(res.reasked, true);
  assert.equal(res.stillViolating, false);
});

test("enforce: fail-closed when re-ask returns null", async () => {
  const res = await enforceThesisRecommendation(
    "Buy AeroVironment on Backlog Strength",
    "AVAV is the asymmetric name. The cleanest expression is AVAV. What invalidates this: a delivery slip.",
    { regenerate: async () => null },
  );
  assert.equal(violationCount(detectThesisViolations(res.title, res.rationale)), 0);
  assert.ok(!res.title.toLowerCase().startsWith("buy"));
  assert.ok(!res.rationale.toLowerCase().includes("cleanest expression"));
  assert.ok(res.rationale.includes("What invalidates this"));
});

test("audit probe: directive title + vehicle body surfaces clean, structured fields untouched", async () => {
  const thesis = {
    title: "Buy AeroVironment on Backlog Strength",
    rationale: "The cleanest expression is AVAV.",
    conviction: "HIGH",
    ticker: "AVAV",
    horizon: "90d",
  };
  const res = await enforceThesisRecommendation(thesis.title, thesis.rationale, {
    regenerate: async () => null,
  });
  assert.equal(violationCount(detectThesisViolations(res.title, res.rationale)), 0);
  assert.ok(!/^(buy|long|short)/i.test(res.title));
  assert.ok(!res.rationale.toLowerCase().includes("cleanest expression"));
  // Guard never receives or returns structured fields: they are preserved.
  assert.equal(thesis.conviction, "HIGH");
  assert.equal(thesis.ticker, "AVAV");
});
