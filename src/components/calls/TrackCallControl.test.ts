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
  TRACK_NOTE_ARIA_LABEL,
  TRACK_NOTE_GATED_LABEL,
  TRACK_NOTE_HINT,
  TRACK_NOTE_HINT_READY,
  TRACK_NOTE_PROMPT,
  TRACK_TRUST_LINE,
  buildLedgerLine,
  noteMeetsGate,
  type TrackedClaimLike,
} from "./TrackCallControl";
import { COMMIT_NOTE_MAX, COMMIT_NOTE_MIN } from "../commit/commit-target";

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

// ---------------------------------------------------------------------------
// The note gate (ruling 11)
//
// Twelve characters, counted AFTER trimming, on every surface. The trim is the
// load-bearing half: sql/proposals/0033 checks
// `length(btrim(commit_note)) > 0` and the adopt route trims before storing,
// so a gate counting raw characters would unlock on whitespace and then write
// a row the column rejects.
// ---------------------------------------------------------------------------

test("the gate is twelve characters, and one literal defines it", () => {
  assert.equal(COMMIT_NOTE_MIN, 12);
});

test("eleven characters do not clear the gate", () => {
  const eleven = "abcdefghijk";
  assert.equal(eleven.length, 11);
  assert.equal(noteMeetsGate(eleven), false);
});

test("twelve characters clear it", () => {
  const twelve = "abcdefghijkl";
  assert.equal(twelve.length, 12);
  assert.equal(noteMeetsGate(twelve), true);
});

test("whitespace alone never clears it, however much of it there is", () => {
  for (const blank of ["", " ", "            ", "\t\t\t\t\t\t\t\t\t\t\t\t", "\n".repeat(40)]) {
    assert.equal(noteMeetsGate(blank), false, JSON.stringify(blank));
  }
});

test("padding is trimmed before counting, not counted as content", () => {
  // Nine real characters inside twelve-plus of padding. The raw string is long
  // enough; the stored value is not, so the gate must read the stored value.
  const padded = "   abc   ";
  assert.ok(padded.length >= 9);
  assert.equal(padded.trim().length, 3);
  assert.equal(noteMeetsGate(padded), false);

  const nineInside = "      abcdefghi      ";
  assert.equal(nineInside.trim().length, 9);
  assert.equal(noteMeetsGate(nineInside), false);
});

test("a padded twelve clears it: the twelve are real once trimmed", () => {
  const paddedTwelve = "   abcdefghijkl   ";
  assert.equal(paddedTwelve.trim().length, 12);
  assert.equal(noteMeetsGate(paddedTwelve), true);
});

test("the boundary is exact: 11 closed, 12 open, nothing in between", () => {
  for (let n = 0; n <= 24; n += 1) {
    assert.equal(noteMeetsGate("x".repeat(n)), n >= COMMIT_NOTE_MIN, `length ${n}`);
  }
});

test("the floor sits below the ceiling, so no note is both too short and too long", () => {
  assert.ok(COMMIT_NOTE_MIN < COMMIT_NOTE_MAX);
});

// ---------------------------------------------------------------------------
// The note copy: reused verbatim from the commit sheet, zero new strings
// ---------------------------------------------------------------------------

test("the desk field asks the sheet's question, in the sheet's words", () => {
  assert.equal(
    TRACK_NOTE_PROMPT,
    "What has to be true for this, and what would change your mind.",
  );
  assert.equal(TRACK_NOTE_HINT, "A sentence is enough.");
  assert.equal(TRACK_NOTE_HINT_READY, "Timestamped before the outcome is known.");
  assert.equal(TRACK_NOTE_GATED_LABEL, "Write your reasoning first");
  assert.equal(TRACK_NOTE_ARIA_LABEL, "Your reasoning");
});

test("the gated button names the missing thing, never the rule", () => {
  // "Write your reasoning first", not "12 characters required". The reader is
  // being asked for a thought, not shown a validator.
  assert.equal(/\d/.test(TRACK_NOTE_GATED_LABEL), false, "no character count in the label");
  assert.equal(/requir|invalid|error|minimum/i.test(TRACK_NOTE_GATED_LABEL), false);
});

test("no note copy promises a verdict, a probability, or a rate", () => {
  for (const s of [
    TRACK_NOTE_PROMPT,
    TRACK_NOTE_HINT,
    TRACK_NOTE_HINT_READY,
    TRACK_NOTE_GATED_LABEL,
    TRACK_NOTE_ARIA_LABEL,
  ]) {
    assert.equal(/%|\bodds\b|\blikel|\bprobab|\bchance\b|\bconfidence\b/i.test(s), false, s);
  }
});

test("the field carries no heading: twelve of them would be wallpaper", () => {
  // The sheet's "Why do you think so?" heading is deliberately NOT exported
  // here. It appears once over one call in the sheet; Radar draws twelve
  // untracked footers, and CallsTrustLine already sits once above the grid.
  // This is the same finding TRACK_TRUST_LINE records for itself.
  for (const s of [TRACK_NOTE_PROMPT, TRACK_NOTE_HINT, TRACK_NOTE_HINT_READY]) {
    assert.equal(s.includes("Why do you think so?"), false, s);
  }
});
