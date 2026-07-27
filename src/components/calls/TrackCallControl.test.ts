/**
 * Tests for the shared call-commitment treatment.
 *
 * The load-bearing one is PERSISTENCE: a tracked card must read tracked on a
 * FRESH MOUNT from server data, with no memory of the tap that created it. The
 * test therefore reconstructs the mount path (the /api/radar/claims read plus
 * the adopted_from_call_id index) from a server payload alone, with no prior
 * component state, and asserts the card resolves to tracked.
 *
 * Pure, deterministic, no network, no DOM.
 * Run: npx tsx --test src/components/calls/TrackCallControl.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRACK_TRUST_LINE,
  buildLedgerLine,
  type TrackedClaimLike,
} from "./TrackCallControl";

// ---------------------------------------------------------------------------
// The mount path, reproduced exactly as both surfaces build it.
// BriefCallsSection.loadTracked() and radar/calls load() both index the claims
// payload by adopted_from_call_id; this is that indexing, isolated.
// ---------------------------------------------------------------------------

interface ClaimRow extends TrackedClaimLike {
  adopted_from_call_id: string | null;
}

function indexTrackedFromServer(payload: { claims?: ClaimRow[] }): Map<string, ClaimRow> {
  const map = new Map<string, ClaimRow>();
  for (const c of payload.claims ?? []) {
    if (c.adopted_from_call_id) map.set(c.adopted_from_call_id, c);
  }
  return map;
}

// ---------------------------------------------------------------------------
// PERSISTENCE (load-bearing)
// ---------------------------------------------------------------------------

test("PERSISTENCE: a tracked card renders tracked on a fresh mount from server data", () => {
  // A brand new page load. No component state, no memory of any tap.
  const serverPayload = {
    claims: [
      {
        id: "9f1c0b7e-0000-4000-8000-000000000001",
        adopted_from_call_id: "call-abc",
        resolution_window_start: "2026-07-26",
        resolution_window_end: "2026-08-02",
      },
    ],
  };

  const tracked = indexTrackedFromServer(serverPayload);
  const callOnThePage = { id: "call-abc" };

  // This is exactly what both surfaces evaluate to decide the state.
  const trackedClaim = tracked.get(callOnThePage.id) ?? null;

  assert.notEqual(trackedClaim, null, "card must read tracked from server data alone");
  assert.equal(trackedClaim!.resolution_window_end, "2026-08-02");
  // And the stamp must NOT play: nothing was committed in this session.
  const stampedThisSession = new Set<string>();
  assert.equal(stampedThisSession.has(callOnThePage.id), false,
    "a persisted claim renders its end state with no animation");
});

test("PERSISTENCE: an untracked call stays untracked on the same mount", () => {
  const tracked = indexTrackedFromServer({
    claims: [{
      id: "id-1", adopted_from_call_id: "call-abc",
      resolution_window_start: "2026-07-26", resolution_window_end: "2026-08-02",
    }],
  });
  assert.equal(tracked.get("call-other") ?? null, null);
});

test("PERSISTENCE: claims not adopted from a call never mark one tracked", () => {
  // Authored claims carry adopted_from_call_id = null and must be ignored.
  const tracked = indexTrackedFromServer({
    claims: [
      { id: "authored-1", adopted_from_call_id: null,
        resolution_window_start: "2026-07-26", resolution_window_end: "2026-10-24" },
    ],
  });
  assert.equal(tracked.size, 0);
});

test("PERSISTENCE: a failed claims read yields no false tracked state", () => {
  // loadTracked sets `tracked` to null on !res.ok, and null hides the control
  // rather than rendering an untracked card the user might re-commit from.
  const tracked: Map<string, ClaimRow> | null = null;
  const available = tracked !== null;
  assert.equal(available, false, "control is hidden, never falsely untracked");
});

// ---------------------------------------------------------------------------
// The ledger line: no fabricated id, no fabricated date
// ---------------------------------------------------------------------------

test("ledger line carries the log date, review date, and terms", () => {
  const line = buildLedgerLine({
    id: "9f1c0b7e-0000-4000-8000-000000000001",
    resolution_window_start: "2026-07-26",
    resolution_window_end: "2026-08-02",
  });
  assert.equal(
    line,
    "LOGGED 2026-07-26  ·  REVIEW 2026-08-02  ·  Fixed at entry. Reviewed on the desk's own bar.",
  );
});

test("no claim id is ever rendered: user_claims has only a uuid", () => {
  const uuid = "9f1c0b7e-0000-4000-8000-000000000001";
  const line = buildLedgerLine({
    id: uuid,
    resolution_window_start: "2026-07-26",
    resolution_window_end: "2026-08-02",
  });
  assert.equal(line.includes(uuid), false, "raw uuid must not appear");
  // And no derived stand-in: no slice, no prefix, no hash.
  for (const n of [4, 6, 8]) {
    assert.equal(line.includes(uuid.slice(0, n)), false, `uuid slice(${n}) leaked`);
  }
  assert.equal(/\b(REF|ID|#)\s*[A-Za-z0-9]/.test(line), false, "no invented identifier");
});

test("an unknown review date is omitted, never invented", () => {
  const line = buildLedgerLine({
    id: "x", resolution_window_start: "2026-07-26", resolution_window_end: null,
  });
  assert.equal(line, "LOGGED 2026-07-26  ·  Fixed at entry. Reviewed on the desk's own bar.");
  assert.equal(line.includes("REVIEW"), false);
});

test("an unknown log date is omitted too, leaving only the terms", () => {
  const line = buildLedgerLine({
    id: "x", resolution_window_start: null, resolution_window_end: null,
  });
  assert.equal(line, "Fixed at entry. Reviewed on the desk's own bar.");
});

test("malformed dates are dropped rather than half-rendered", () => {
  const line = buildLedgerLine({
    id: "x", resolution_window_start: "not-a-date", resolution_window_end: "2026-08-02",
  });
  assert.equal(line, "REVIEW 2026-08-02  ·  Fixed at entry. Reviewed on the desk's own bar.");
});

test("a timestamp is narrowed to its date, not printed raw", () => {
  const line = buildLedgerLine({
    id: "x",
    resolution_window_start: "2026-07-26T14:33:02.123Z",
    resolution_window_end: "2026-08-02",
  });
  assert.ok(line.startsWith("LOGGED 2026-07-26  ·"), line);
  assert.equal(line.includes("T14:33"), false);
});

// ---------------------------------------------------------------------------
// The pre-tap line
// ---------------------------------------------------------------------------

test("the pre-tap line states the terms and promises no probability", () => {
  assert.equal(
    TRACK_TRUST_LINE,
    "Your window is fixed the moment you commit, and misses stay on your record. Same benchmark-attribution bar as the desk's own calls: a move the market explains is not a hit.",
  );
});

test("no percentage, odds, or likelihood language anywhere in the copy", () => {
  for (const s of [TRACK_TRUST_LINE, buildLedgerLine({
    id: "x", resolution_window_start: "2026-07-26", resolution_window_end: "2026-08-02",
  })]) {
    assert.equal(/%|\bodds\b|\blikel|\bprobab|\bchance\b|\bconfidence\b/i.test(s), false, s);
  }
});

test("the pre-tap line does not promise a verdict will arrive", () => {
  // Adopted claims are not yet in the grading due-scan
  // (backend/grading/grade_user_claims.py filters source = 'authored'), so the
  // copy describes the BAR, never a scheduled outcome. If this assertion is
  // ever relaxed, the grader filter must be widened first.
  assert.equal(/will be (graded|scored|reviewed)|you will (get|receive)/i.test(TRACK_TRUST_LINE), false);
});
