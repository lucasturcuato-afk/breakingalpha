/**
 * Unit tests for the claim-window session-date fix. Pure, deterministic.
 * Run: npx tsx --test src/lib/session-date.test.ts
 *
 * Proves claim windows are stamped from the US market session date (Pacific),
 * not the server's UTC date, which is what stored windows a day ahead (#543).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionDatePt } from "./session-date.ts";
import { resolveAdoptWindow } from "./call-horizons.ts";

test("same trading day: 20:00 PT stores the same session date as 09:00 PT", () => {
  // 2026-08-07, 09:00 PT = 16:00 UTC; 20:00 PT = 2026-08-08 03:00 UTC.
  const morning = sessionDatePt(new Date("2026-08-07T16:00:00Z"));
  const evening = sessionDatePt(new Date("2026-08-08T03:00:00Z"));
  assert.equal(morning, "2026-08-07");
  assert.equal(evening, "2026-08-07", "evening PT claim must keep the trading day, not roll to UTC tomorrow");
  assert.equal(morning, evening);
});

test("after the UTC rollover but before the session rolls, stores the session date not the UTC date", () => {
  // A real shifted row: created_at 2026-08-03T02:41 UTC = 2026-08-02 19:41 PT.
  const d = new Date("2026-08-03T02:41:28Z");
  assert.equal(d.toISOString().slice(0, 10), "2026-08-03", "UTC date is the day ahead");
  assert.equal(sessionDatePt(d), "2026-08-02", "session date is the trading day the user acted on");
});

test("window_end equals window_start plus the chosen horizon in session terms", () => {
  const start = sessionDatePt(new Date("2026-08-03T02:41:28Z")); // 2026-08-02
  assert.equal(start, "2026-08-02");
  // A one-week adopt horizon from the session start, not the UTC start.
  assert.equal(resolveAdoptWindow(start, "week"), "2026-08-09");
  // Explicit day count is honored the same way.
  assert.equal(resolveAdoptWindow(start, "week", 3), "2026-08-05");
});

test("mid-session hours are unaffected: UTC and session date already agree", () => {
  // 2026-08-07 12:00 PT = 19:00 UTC, same calendar day both ways.
  const d = new Date("2026-08-07T19:00:00Z");
  assert.equal(sessionDatePt(d), "2026-08-07");
  assert.equal(d.toISOString().slice(0, 10), "2026-08-07");
});

test("existing rows are untouched: the helper is a pure read, no write, no mutation of input", () => {
  const input = new Date("2026-08-03T02:41:28Z");
  const before = input.getTime();
  const out = sessionDatePt(input);
  assert.equal(typeof out, "string");
  assert.equal(input.getTime(), before, "must not mutate its argument");
  // The fix is write-path only: no backfill, no UPDATE of stored rows exists in
  // this change, so any already-stored window is left exactly as it was.
});
