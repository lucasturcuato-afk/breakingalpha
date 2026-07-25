/**
 * Tests for src/lib/call-horizons.ts: the adopt window, the server-side
 * gradeability rules the adopt route applies, and the derived horizon chip.
 *
 * Pure, deterministic, no network, no React, no DOM.
 * Run: npx tsx --test src/lib/call-horizons.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ADOPT_HORIZON,
  HORIZON_DAYS,
  HORIZON_LABEL,
  MAX_WINDOW_DAYS,
  addCalendarDays,
  daysBetween,
  horizonFromDates,
  horizonLabelForDays,
  isPriceableClaimType,
  normalizeAdoptHorizon,
  resolveAdoptWindow,
  type HorizonType,
} from "./call-horizons";

const TODAY = "2026-07-25";

// ---------------------------------------------------------------------------
// The map must match backend/call_horizons.py
// ---------------------------------------------------------------------------

test("day counts match the backend map exactly", () => {
  assert.deepEqual(HORIZON_DAYS, { session: 0, week: 7, multiweek: 21 });
});

test("no bucket exceeds the 90 day cap", () => {
  for (const [name, days] of Object.entries(HORIZON_DAYS)) {
    assert.ok(days <= MAX_WINDOW_DAYS, `${name} = ${days}`);
  }
});

// ---------------------------------------------------------------------------
// Adopt window
// ---------------------------------------------------------------------------

test("adopt defaults to a week, never a same-day window", () => {
  assert.equal(DEFAULT_ADOPT_HORIZON, "week");
  const end = resolveAdoptWindow(TODAY, DEFAULT_ADOPT_HORIZON);
  assert.equal(end, "2026-08-01");
  assert.ok(end > TODAY, "adopted window must end after today");
});

test("each horizon yields a real multi-day forward window", () => {
  assert.equal(resolveAdoptWindow(TODAY, "week"), "2026-08-01");
  assert.equal(resolveAdoptWindow(TODAY, "multiweek"), "2026-08-15");
});

test("a session horizon still yields at least one day forward", () => {
  // The old bug was window_start === window_end, a claim that could never
  // stay open. Even the shortest adopted window must move forward.
  const end = resolveAdoptWindow(TODAY, "session");
  assert.ok(end > TODAY, `expected > ${TODAY}, got ${end}`);
  assert.equal(daysBetween(TODAY, end), 1);
});

test("an explicit day override wins and is clamped to [1, 90]", () => {
  assert.equal(resolveAdoptWindow(TODAY, "week", 30), addCalendarDays(TODAY, 30));
  assert.equal(resolveAdoptWindow(TODAY, "week", 5000), addCalendarDays(TODAY, MAX_WINDOW_DAYS));
  assert.equal(resolveAdoptWindow(TODAY, "week", 0), addCalendarDays(TODAY, 7));
  assert.equal(resolveAdoptWindow(TODAY, "week", -10), addCalendarDays(TODAY, 7));
  assert.equal(resolveAdoptWindow(TODAY, "week", NaN), addCalendarDays(TODAY, 7));
  assert.equal(resolveAdoptWindow(TODAY, "week", "60" as unknown), addCalendarDays(TODAY, 7));
});

test("an unrecognized horizon falls back rather than throwing", () => {
  for (const bad of ["event", "", "  ", null, undefined, 7, {}]) {
    assert.equal(normalizeAdoptHorizon(bad, DEFAULT_ADOPT_HORIZON), "week", `input ${String(bad)}`);
  }
  assert.equal(normalizeAdoptHorizon(" MultiWeek ", DEFAULT_ADOPT_HORIZON), "multiweek");
});

// ---------------------------------------------------------------------------
// Gradeability, mirroring the adopt route's server-side rules
// ---------------------------------------------------------------------------

/** The exact predicate src/app/api/radar/claims/adopt/route.ts applies. */
function adoptGradeable(call: {
  target_symbol?: string | null;
  expected_direction?: string | null;
  claim_type?: string | null;
}, todayIso: string, horizon: HorizonType): boolean {
  const windowEnd = resolveAdoptWindow(todayIso, horizon);
  const symbol = typeof call.target_symbol === "string" ? call.target_symbol.trim() : "";
  const endsAfterToday = windowEnd > todayIso;
  const withinMax =
    (Date.parse(`${windowEnd}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000 <=
    MAX_WINDOW_DAYS;
  return (
    !!symbol && !!call.expected_direction && endsAfterToday && withinMax &&
    isPriceableClaimType(call.claim_type)
  );
}

test("a priceable call adopted over a real window is gradeable", () => {
  assert.equal(
    adoptGradeable(
      { target_symbol: "NVDA", expected_direction: "bullish", claim_type: "ticker" },
      TODAY, "week",
    ),
    true,
  );
});

test("gradeable is refused without a symbol, direction, or priceable type", () => {
  const base = { target_symbol: "NVDA", expected_direction: "bullish", claim_type: "ticker" };
  assert.equal(adoptGradeable({ ...base, target_symbol: null }, TODAY, "week"), false);
  assert.equal(adoptGradeable({ ...base, target_symbol: "   " }, TODAY, "week"), false);
  assert.equal(adoptGradeable({ ...base, expected_direction: null }, TODAY, "week"), false);
  // aggregate has no honest price grader; the router refuses it.
  assert.equal(adoptGradeable({ ...base, claim_type: "aggregate" }, TODAY, "week"), false);
});

test("sector and index calls are priceable, aggregate is not", () => {
  assert.equal(isPriceableClaimType("ticker"), true);
  assert.equal(isPriceableClaimType("sector"), true);
  assert.equal(isPriceableClaimType("index"), true);
  assert.equal(isPriceableClaimType("aggregate"), false);
  assert.equal(isPriceableClaimType(null), false);
});

// ---------------------------------------------------------------------------
// The chip is DERIVED, never hardcoded
// ---------------------------------------------------------------------------

test("a non-session horizon renders its real label, proving no hardcoding", () => {
  assert.deepEqual(horizonFromDates("2026-07-25", "2026-08-01"), { days: 7, label: "1 week" });
  assert.deepEqual(horizonFromDates("2026-07-25", "2026-08-15"), { days: 21, label: "3 weeks" });
  assert.deepEqual(horizonFromDates("2026-07-25", "2026-07-25"), { days: 0, label: "Same session" });
});

test("a window that matches no bucket states its real length", () => {
  // If the chip were hardcoded to the three buckets this would be wrong.
  assert.equal(horizonFromDates("2026-07-25", "2026-08-06")?.label, "12 days");
  assert.equal(horizonFromDates("2026-07-25", "2026-07-26")?.label, "1 day");
  assert.equal(horizonFromDates("2026-07-25", "2026-09-05")?.label, "6 weeks");
  assert.equal(horizonLabelForDays(45), "45 days");
});

test("the chip is absent, not wrong, when there is nothing to derive from", () => {
  assert.equal(horizonFromDates(null, "2026-08-01"), null);
  assert.equal(horizonFromDates("2026-07-25", null), null);
  assert.equal(horizonFromDates(undefined, undefined), null);
  // A resolve_on before its anchor is nonsense, not a negative horizon.
  assert.equal(horizonFromDates("2026-08-01", "2026-07-25"), null);
});

test("every backend bucket has a label and round-trips through the chip", () => {
  for (const [name, days] of Object.entries(HORIZON_DAYS) as [HorizonType, number][]) {
    const end = addCalendarDays(TODAY, days);
    assert.equal(horizonFromDates(TODAY, end)?.label, HORIZON_LABEL[name], name);
  }
});

test("calendar arithmetic crosses month and year boundaries", () => {
  assert.equal(addCalendarDays("2026-12-28", 7), "2027-01-04");
  assert.equal(addCalendarDays("2026-02-25", 21), "2026-03-18");
});
