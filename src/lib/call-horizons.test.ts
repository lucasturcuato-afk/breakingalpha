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
  adoptWindowForCall,
  adoptWindowOptions,
  adoptWindowRequest,
  adoptWindowValue,
  horizonPhraseForDays,
  DEFAULT_ADOPT_HORIZON,
  HORIZON_DAYS,
  HORIZON_TYPES,
  HORIZON_LABEL,
  HORIZON_PHRASE,
  horizonTypeFromDates,
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

// The three buckets the Python claims extractor emits. Their day counts MUST
// equal HORIZON_DAYS in backend/call_horizons.py, or a chip on a brief call and
// a chip on an adopted claim would mean different things.
const BACKEND_SHARED_DAYS = { session: 0, week: 7, multiweek: 21 } as const;

test("the backend-shared buckets match backend/call_horizons.py exactly", () => {
  for (const [name, days] of Object.entries(BACKEND_SHARED_DAYS)) {
    assert.equal(HORIZON_DAYS[name as HorizonType], days, name);
  }
});

test("adopt-only long buckets exist and are frontend-only additions", () => {
  // Long-dated theses need a real window. These are resolved by the TS adopt
  // route, never by the Python extractor, so they add no backend contract.
  assert.equal(HORIZON_DAYS.month, 30);
  assert.equal(HORIZON_DAYS.quarter, 90);
  for (const name of Object.keys(HORIZON_DAYS)) {
    if (!(name in BACKEND_SHARED_DAYS)) {
      assert.ok(
        HORIZON_TYPES.includes(name as HorizonType),
        `${name} must be offered in the selector`,
      );
    }
  }
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


// ---------------------------------------------------------------------------
// Variable horizons: the selector must preselect the call's OWN window
// ---------------------------------------------------------------------------

test("REGRESSION: a 13-day call preselects its own window, NOT 1 week", () => {
  // horizonTypeFromDates returns null for any span that is not 0, 7, or 21.
  // Every caller that fell back to DEFAULT_ADOPT_HORIZON on null would offer
  // "1 week" for a call that is not a week, re-introducing the exact defect
  // #535 shipped to fix. This is the guard.
  const anchor = "2026-07-25";
  const resolveOn = addCalendarDays(anchor, 13);

  assert.equal(horizonTypeFromDates(anchor, resolveOn), null, "precondition");

  const w = adoptWindowForCall(anchor, resolveOn);
  assert.deepEqual(w, { kind: "as-called", days: 13 });
  assert.notEqual(adoptWindowValue(w), `bucket:${DEFAULT_ADOPT_HORIZON}`);

  const options = adoptWindowOptions(w);
  assert.equal(options[0].value, adoptWindowValue(w), "own window is first");
  assert.equal(
    options.length,
    HORIZON_TYPES.length + 1,
    "own window plus every named alternative",
  );
  assert.match(options[0].label, /13 days/);
});

test("an exact bucket match preselects the bucket, with no duplicate entry", () => {
  const anchor = "2026-07-25";
  for (const [name, days] of Object.entries(HORIZON_DAYS) as [HorizonType, number][]) {
    const w = adoptWindowForCall(anchor, addCalendarDays(anchor, days));
    assert.deepEqual(w, { kind: "bucket", type: name }, name);
    assert.equal(
      adoptWindowOptions(w).length,
      HORIZON_TYPES.length,
      `${name}: no duplicate first entry`,
    );
  }
});

test("a call with no resolve_on falls back to the shared default", () => {
  assert.deepEqual(adoptWindowForCall("2026-07-25", null), {
    kind: "bucket",
    type: DEFAULT_ADOPT_HORIZON,
  });
  assert.deepEqual(adoptWindowForCall(null, null), {
    kind: "bucket",
    type: DEFAULT_ADOPT_HORIZON,
  });
});

test("an off-bucket span renders a sensible phrase, never null", () => {
  for (const days of [1, 2, 3, 5, 13, 14, 30, 45, 89, 90]) {
    const phrase = horizonPhraseForDays(days);
    assert.ok(phrase && phrase.length > 0, `days=${days}`);
    assert.ok(!/null|undefined|NaN/.test(phrase), `days=${days}: ${phrase}`);
  }
  assert.equal(horizonPhraseForDays(13), "resolves in 13 days");
  assert.equal(horizonPhraseForDays(14), "resolves in about 2 weeks");
  assert.equal(horizonPhraseForDays(0), HORIZON_PHRASE.session);
});

test("an off-bucket span renders a sensible chip label, never null", () => {
  const anchor = "2026-07-25";
  const h = horizonFromDates(anchor, addCalendarDays(anchor, 13));
  assert.equal(h?.days, 13);
  assert.equal(h?.label, "13 days");
});

test("the adopt body sends window_days for an off-bucket span and no API change", () => {
  // The route already accepts window_days (resolveAdoptWindow's explicitDays).
  const asCalled = adoptWindowRequest({ kind: "as-called", days: 13 });
  assert.equal(asCalled.window_days, 13);
  assert.equal(resolveAdoptWindow(TODAY, asCalled.horizon, asCalled.window_days),
    addCalendarDays(TODAY, 13));

  // A bucket sends no window_days, exactly as before.
  const bucket = adoptWindowRequest({ kind: "bucket", type: "multiweek" });
  assert.equal(bucket.window_days, undefined);
  assert.equal(resolveAdoptWindow(TODAY, bucket.horizon, bucket.window_days),
    addCalendarDays(TODAY, 21));
});

test("an as-called window is never 0, 7, or 21, so it never duplicates a bucket", () => {
  const anchor = "2026-07-25";
  for (const days of [0, 7, 21]) {
    const w = adoptWindowForCall(anchor, addCalendarDays(anchor, days));
    assert.equal(w.kind, "bucket", `days=${days}`);
  }
});
