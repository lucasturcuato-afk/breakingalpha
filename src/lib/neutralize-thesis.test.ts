/**
 * Unit tests for the render-time thesis neutralisers in track-record-live-score.ts:
 * neutralizeThesisTitle (incl. the Watch prefix), outcomeDisplayLabel, and the
 * neutralizeThesis object helper. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/neutralize-thesis.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  neutralizeThesisTitle,
  outcomeDisplayLabel,
  neutralizeThesis,
} from "./track-record-live-score";

test("neutralizeThesisTitle strips every directional prefix incl. Watch", () => {
  assert.equal(neutralizeThesisTitle("Buy AeroVironment on Backlog Strength"), "AeroVironment on Backlog Strength");
  assert.equal(neutralizeThesisTitle("Long JPMorgan Retail Expansion"), "JPMorgan Retail Expansion");
  assert.equal(neutralizeThesisTitle("Short Defense Suppliers"), "Defense Suppliers");
  assert.equal(neutralizeThesisTitle("Avoid Regional Banks"), "Regional Banks");
  assert.equal(neutralizeThesisTitle("Sell Office REITs"), "Office REITs");
  // Watch was previously NOT stripped; now it is.
  assert.equal(neutralizeThesisTitle("Watch Optical Computing Spillover"), "Optical Computing Spillover");
});

test("neutralizeThesisTitle leaves descriptive and verb-less titles untouched", () => {
  assert.equal(neutralizeThesisTitle("AeroVironment Backlog Strengthens"), "AeroVironment Backlog Strengthens");
  assert.equal(neutralizeThesisTitle("Iran Risk Premium Compresses"), "Iran Risk Premium Compresses");
  // "Watchlist" must not be treated as the Watch prefix (word boundary).
  assert.equal(neutralizeThesisTitle("Watchlist Names Re-rate"), "Watchlist Names Re-rate");
});

test("outcomeDisplayLabel maps verdicts to neutral evidence wording", () => {
  assert.equal(outcomeDisplayLabel("confirmed"), "Supported");
  assert.equal(outcomeDisplayLabel("invalidated"), "Challenged");
  assert.equal(outcomeDisplayLabel("inconclusive"), "Inconclusive");
  assert.equal(outcomeDisplayLabel(null), "Developing");
  // Never returns a directional call.
  for (const o of ["confirmed", "invalidated", "inconclusive", null, "weird"]) {
    const label = outcomeDisplayLabel(o);
    assert.ok(!/confirmed|invalidated/i.test(label), `leaked raw verdict: ${label}`);
  }
});

test("neutralizeThesis cleans title + body, leaves structured fields intact", () => {
  const row = {
    title: "Buy AeroVironment on Backlog Strength",
    rationale: "The order book is widening. The cleanest expression is AVAV, because it is the purest play. What invalidates this: a delivery slip.",
    summary: "Buy AVAV now to capture the move.",
    bear_case: "You should reduce exposure if deliveries slip.",
    conviction: "HIGH",
    ticker: "AVAV",
    outcome: "confirmed",
    horizon: "90d",
  };
  const out = neutralizeThesis(row);

  // Title: directional prefix stripped.
  assert.equal(out.title, "AeroVironment on Backlog Strength");
  // Body: recommendation / vehicle language redacted.
  assert.ok(!/cleanest expression/i.test(out.rationale));
  assert.ok(!/\bbuy\b/i.test(out.summary));
  assert.ok(!/reduce exposure|you should/i.test(out.bear_case));
  // Invalidation close preserved.
  assert.ok(/What invalidates this/.test(out.rationale));
  // Structured fields untouched (grading inputs preserved).
  assert.equal(out.conviction, "HIGH");
  assert.equal(out.ticker, "AVAV");
  assert.equal(out.outcome, "confirmed");
  assert.equal(out.horizon, "90d");
  // Does not mutate the input.
  assert.equal(row.title, "Buy AeroVironment on Backlog Strength");
});

test("neutralizeThesis passes descriptive input through unchanged", () => {
  const row = {
    title: "AeroVironment Backlog Strengthens on New Orders",
    rationale: "The order book is widening as procurement accelerates. What invalidates this: a delivery slip at the next print.",
    bear_case: "Deliveries may slip if supply chains tighten.",
  };
  const out = neutralizeThesis(row);
  assert.equal(out.title, row.title);
  assert.equal(out.rationale, row.rationale);
  assert.equal(out.bear_case, row.bear_case);
});

test("neutralizeThesis tolerates missing/null fields", () => {
  const out = neutralizeThesis({ title: "Long Gold", rationale: null, bear_case: undefined });
  assert.equal(out.title, "Gold");
  assert.equal(out.rationale, null);
  assert.equal(out.bear_case, undefined);
});
