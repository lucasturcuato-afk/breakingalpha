// Unit tests for parseYahooDaily (src/lib/yahoo-daily.ts).
//
// Fixtures must stay synchronized with backend/tests/test_market_tape.py
// (ParseYahooDailyTests), which exercises the Python twin in
// backend/market_tape.py with the same scenarios.
//
// Run: node --test src/lib/yahoo-daily.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseYahooDaily } from "./yahoo-daily.ts";

const DAY = 86400;
const JUN1 = 1780320600; // 2026-06-01 13:30 UTC (09:30 ET daily-bar stamp)
const BAR_TS = [0, 1, 2, 3, 4].map((i) => JUN1 + i * DAY); // Jun 1..5
const NYSE_GMTOFF = -14400; // EDT

function chart({ meta = {}, timestamps = [], closes = [] } = {}) {
  return {
    chart: {
      result: [
        {
          meta,
          timestamp: timestamps,
          indicators: { quote: [{ close: closes }] },
        },
      ],
    },
  };
}

test("Russell 2026-06-05: bar-derived prev beats the stale meta anchor", () => {
  // Real ^RUT data. Yahoo's range=1d meta.chartPreviousClose said 2893.51
  // (the Jun 3 close, two sessions back); the true prior close was 2935.33.
  const q = parseYahooDaily(
    chart({
      meta: {
        regularMarketPrice: 2833.5,
        regularMarketTime: BAR_TS[4] + 6 * 3600 + 53 * 60, // Fri 16:23 ET
        gmtoffset: NYSE_GMTOFF,
        chartPreviousClose: 2893.51, // the wrong anchor, must be ignored
      },
      timestamps: BAR_TS,
      closes: [2905.76, 2931.96, 2893.51, 2935.33, 2833.5],
    }),
  );
  assert.ok(q);
  assert.ok(Math.abs(q.prev - 2935.33) < 0.01);
  assert.equal(q.pct, -3.47);
  // Document the failure mode being fixed: the old meta-anchored arithmetic
  // produced the -2.07% the card showed.
  const oldPct = ((2833.5 - 2893.51) / 2893.51) * 100;
  assert.equal(parseFloat(oldPct.toFixed(2)), -2.07);
});

test("two-bar series: prev is the immediately prior daily close", () => {
  const q = parseYahooDaily(
    chart({
      meta: {
        regularMarketPrice: 103,
        regularMarketTime: BAR_TS[1] + 6 * 3600,
        gmtoffset: NYSE_GMTOFF,
      },
      timestamps: BAR_TS.slice(0, 2),
      closes: [100, 103],
    }),
  );
  assert.equal(q.prev, 100);
  assert.equal(q.pct, 3);
});

test("one bar, no meta baseline: no fabricated change", () => {
  const q = parseYahooDaily(
    chart({
      meta: {
        regularMarketPrice: 50,
        regularMarketTime: BAR_TS[0] + 6 * 3600,
        gmtoffset: NYSE_GMTOFF,
      },
      timestamps: BAR_TS.slice(0, 1),
      closes: [50],
    }),
  );
  assert.equal(q.prev, 0);
  assert.equal(q.pct, 0);
  assert.equal(q.change, 0);
});

test("one bar with meta fallback: degraded responses stay no worse than before", () => {
  const q = parseYahooDaily(
    chart({
      meta: {
        regularMarketPrice: 101,
        regularMarketTime: BAR_TS[0] + 6 * 3600,
        gmtoffset: NYSE_GMTOFF,
        chartPreviousClose: 99,
      },
      timestamps: BAR_TS.slice(0, 1),
      closes: [101],
    }),
  );
  assert.equal(q.prev, 99);
  assert.equal(q.pct, 2.02);
});

test("null-padded closes are filtered before baseline selection", () => {
  const q = parseYahooDaily(
    chart({
      meta: {
        regularMarketPrice: 110,
        regularMarketTime: BAR_TS[4] + 6 * 3600,
        gmtoffset: NYSE_GMTOFF,
      },
      timestamps: BAR_TS,
      closes: [100, null, 105, null, 110],
    }),
  );
  assert.equal(q.prev, 105);
});

test("garbage payloads return null instead of throwing", () => {
  assert.equal(parseYahooDaily(null), null);
  assert.equal(parseYahooDaily({}), null);
  assert.equal(parseYahooDaily({ chart: { result: null } }), null);
  assert.equal(
    parseYahooDaily(chart({ meta: {}, timestamps: [], closes: [] })),
    null,
  );
});
