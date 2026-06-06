// Unit tests for src/lib/market-regime.ts.
//
// Parity guarantee: the cases load from backend/tests/regime_parity_cases.json,
// the SAME table consumed by backend/tests/test_market_tape.py against the
// Python mirror (backend/market_tape.py). Both implementations must produce
// identical output for every row.
//
// Run: node --test src/lib/market-regime.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeRegime } from "./market-regime.ts";

const casesPath = fileURLToPath(
  new URL("../../backend/tests/regime_parity_cases.json", import.meta.url),
);
const { cases } = JSON.parse(readFileSync(casesPath, "utf8"));

test("shared case table is non-trivial", () => {
  assert.ok(cases.length >= 14, "case table unexpectedly small");
});

for (const c of cases) {
  test(`parity: ${c.note}`, () => {
    const { regime } = computeRegime({
      vixLevel: c.vix_level,
      vixPctChange: c.vix_pct_change,
      spxPctChange: c.spx_pct_change,
    });
    assert.equal(regime, c.expected);
  });
}

test("branch discriminators map to the right rungs", () => {
  assert.equal(
    computeRegime({ vixLevel: 26, vixPctChange: 0, spxPctChange: 0 }).branch,
    "vix-extreme",
  );
  assert.equal(
    computeRegime({ vixLevel: 21.51, vixPctChange: 39.68, spxPctChange: -2.64 }).branch,
    "vix-elevated",
  );
  assert.equal(
    computeRegime({ vixLevel: 12, vixPctChange: 0, spxPctChange: 0 }).branch,
    "vix-calm",
  );
  assert.equal(
    computeRegime({ vixLevel: 17, vixPctChange: 0, spxPctChange: 0 }).branch,
    "spx-tiebreak",
  );
});
