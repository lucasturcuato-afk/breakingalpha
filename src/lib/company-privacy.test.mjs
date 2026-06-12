// Unit tests for src/lib/company-privacy.ts.
//
// Locks the private-vs-public render contract: privacy is derived SOLELY from
// the resolved ticker (the SOT), and the KPI PRIVATE badge can never be
// flipped by an upstream Yahoo quote status. Run: `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { deriveTickerPrivacy, shouldRenderPrivate } from "./company-privacy.ts";

test("a resolved ticker is public", () => {
  const r = deriveTickerPrivacy("SPCX");
  assert.equal(r.ticker, "SPCX");
  assert.equal(r.isPrivate, false);
});

test("ticker is trimmed and uppercased", () => {
  assert.deepEqual(deriveTickerPrivacy("  spcx  "), {
    ticker: "SPCX",
    isPrivate: false,
  });
});

test("null / empty / whitespace tickers are private", () => {
  for (const raw of [null, undefined, "", "   ", 0, false]) {
    const r = deriveTickerPrivacy(raw);
    assert.equal(r.ticker, null, `ticker for ${JSON.stringify(raw)}`);
    assert.equal(r.isPrivate, true, `isPrivate for ${JSON.stringify(raw)}`);
  }
});

test("KPI badge derives from the ticker SOT, never from Yahoo status", () => {
  // Public company (ticker resolves): badge suppressed.
  const pub = deriveTickerPrivacy("SPCX");
  assert.equal(pub.isPrivate, false);
  // shouldRenderPrivate takes ONLY the SOT, so even when Yahoo 404s the quote
  // (kpi.status === "private", a pending quote on a fresh listing) the badge
  // stays suppressed -- structurally impossible for the quote to flip it.
  assert.equal(shouldRenderPrivate(pub.isPrivate), false);
  // Genuinely private company (no ticker): badge shows.
  assert.equal(shouldRenderPrivate(deriveTickerPrivacy(null).isPrivate), true);
});
