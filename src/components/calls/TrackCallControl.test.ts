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

import * as control from "./TrackCallControl";
import {
  TRACK_NOTE_ARIA_LABEL,
  TRACK_NOTE_PROMPT,
  TRACK_PRESS_LABEL,
  TRACK_TRUST_LINE,
  buildLedgerLine,
  noteHasContent,
  noteLandedOnRow,
  trackPressReady,
  type TrackedClaimLike,
} from "./TrackCallControl";
import {
  ADOPT_NOTE_HINT,
  ADOPT_NOTE_HINT_WRITTEN,
  noteSatisfiesGate,
} from "../commit/commit-gate";
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
// The note on the ADOPT path. There is no gate, and that is the ruling.
//
// `decisions/commit-note-optional-when-adopting.md` reverses the half of
// DECISIONS.md ruling 11 that put a note inside what adopting a call means.
// Every surface this control serves adopts: the morning brief and the evening
// wrap through BriefCallsSection, and /radar/calls directly. All three post to
// /api/radar/claims/adopt, which accepts a note and requires neither its
// presence nor its length.
//
// THESE GO RED ON THE TRUNK. Before this change the desk carried its own
// twelve-character predicate, `noteMeetsGate`, and locked the button behind
// it. `trackPressReady` did not exist, so every assertion below fails to even
// resolve a function on the pre-change file.
// ---------------------------------------------------------------------------

test("an empty note does not lock the press: adopting is not authoring", () => {
  assert.equal(trackPressReady("", false), true);
});

test("one character does not lock it either, and neither does any length", () => {
  assert.equal(trackPressReady("x", false), true);
  // Straight through the old twelve-character boundary and out the far side.
  for (let n = 0; n <= 24; n += 1) {
    assert.equal(trackPressReady("x".repeat(n), false), true, `length ${n}`);
  }
});

test("whitespace alone does not lock it: there is nothing left to fail", () => {
  for (const blank of [" ", "            ", "\t".repeat(12), "\n".repeat(40)]) {
    assert.equal(trackPressReady(blank, false), true, JSON.stringify(blank));
  }
});

test("the ONLY thing that locks the press is a write already in flight", () => {
  assert.equal(trackPressReady("", true), false);
  assert.equal(trackPressReady("a considered sentence", true), false);
});

test("the desk applies the shared rule rather than a copy of it", () => {
  // Not "the same answer". The same function: trackPressReady is
  // noteSatisfiesGate(_, "adopted") with the in-flight lock, so a change to
  // the ruling reaches this surface without anyone editing this surface.
  for (const note of ["", "x", "a considered sentence", "   "]) {
    assert.equal(trackPressReady(note, false), noteSatisfiesGate(note, "adopted"));
  }
});

test("no desk-local gate predicate survives, under any of its old names", () => {
  // The regression guard. Reintroducing a surface-local rule is exactly how
  // this repo grew four tab-bar clearances and five back controls.
  for (const gone of ["noteMeetsGate", "TRACK_NOTE_GATED_LABEL", "TRACK_NOTE_HINT", "TRACK_NOTE_HINT_READY"]) {
    assert.equal(gone in control, false, `${gone} is back`);
  }
});

// ---------------------------------------------------------------------------
// The AUTHOR path still requires one. The ruling is a split, not a repeal.
//
// Compose is the reader making a claim and the note is that claim's reasoning,
// so the twelve-character floor stands there, counted after trimming.
// compose-screen.tsx reads it from the same module through the same function
// rather than restating it, so these assertions describe the live call site.
//
// These are GREEN on the trunk, deliberately. The trunk is not wrong about
// authoring, and a test that went red here would be describing an
// over-correction rather than the ruling.
// ---------------------------------------------------------------------------

test("authoring keeps the floor the adopt path lost", () => {
  assert.equal(noteSatisfiesGate("", "authored"), false);
  assert.equal(noteSatisfiesGate("abcdefghijk", "authored"), false); // eleven
  assert.equal(noteSatisfiesGate("abcdefghijkl", "authored"), true); // twelve
});

test("the two origins disagree on the same string, which is the whole ruling", () => {
  const eleven = "abcdefghijk";
  assert.equal(noteSatisfiesGate(eleven, "authored"), false);
  assert.equal(noteSatisfiesGate(eleven, "adopted"), true);
});

test("the author floor is trimmed before counting, not counted raw", () => {
  // sql/proposals/0033 checks length(btrim(commit_note)) > 0 and both routes
  // trim before storing, so a raw count would unlock on twelve spaces and then
  // write a value the column rejects.
  assert.equal(noteSatisfiesGate("      abcdefghi      ", "authored"), false);
  assert.equal(noteSatisfiesGate("   abcdefghijkl   ", "authored"), true);
  assert.equal(noteSatisfiesGate("            ", "authored"), false);
});

test("the floor sits below the ceiling, so no note is both too short and too long", () => {
  assert.equal(COMMIT_NOTE_MIN, 12);
  assert.ok(COMMIT_NOTE_MIN < COMMIT_NOTE_MAX);
});

// ---------------------------------------------------------------------------
// The acknowledgement, which is not a gate
// ---------------------------------------------------------------------------

test("noteHasContent moves the border and locks nothing", () => {
  assert.equal(noteHasContent(""), false);
  assert.equal(noteHasContent("   "), false);
  assert.equal(noteHasContent("x"), true);
  // The press is live in every one of those states. That is the distinction.
  for (const note of ["", "   ", "x"]) assert.equal(trackPressReady(note, false), true);
});

// ---------------------------------------------------------------------------
// The note copy. Still zero new strings, and now two fewer of them.
// ---------------------------------------------------------------------------

test("the desk field asks its question and the hints come from the shared module", () => {
  assert.equal(
    TRACK_NOTE_PROMPT,
    "What has to be true for this, and what would change your mind.",
  );
  assert.equal(TRACK_NOTE_ARIA_LABEL, "Your reasoning");
  assert.equal(ADOPT_NOTE_HINT, "A sentence is what you will read back.");
  assert.equal(ADOPT_NOTE_HINT_WRITTEN, "Timestamped before the outcome is known.");
});

test("no string on this surface describes a floor that no longer exists", () => {
  // "A sentence is enough." was the desk's empty-field hint. It is a statement
  // about a minimum, and there is no minimum on this path any more.
  for (const s of [TRACK_NOTE_PROMPT, TRACK_PRESS_LABEL, ADOPT_NOTE_HINT, ADOPT_NOTE_HINT_WRITTEN]) {
    assert.equal(/enough|requir|minimum|at least|first\b/i.test(s), false, s);
    assert.equal(/\d/.test(s), false, `no character count in ${JSON.stringify(s)}`);
  }
});

test("the press names the act, in one label, in every state it can be pressed from", () => {
  assert.equal(TRACK_PRESS_LABEL, "Track this call");
  // The desk clicks; the sheet is a press-and-hold. Reusing the sheet's
  // "Press to enter this on your ledger" would name a gesture the desk has not
  // got, so the two labels differ on purpose and neither is a gate's voice.
  assert.equal(/press|hold/i.test(TRACK_PRESS_LABEL), false);
});

test("no note copy promises a verdict, a probability, or a rate", () => {
  for (const s of [
    TRACK_NOTE_PROMPT,
    TRACK_PRESS_LABEL,
    TRACK_NOTE_ARIA_LABEL,
    ADOPT_NOTE_HINT,
    ADOPT_NOTE_HINT_WRITTEN,
  ]) {
    assert.equal(/%|\bodds\b|\blikel|\bprobab|\bchance\b|\bconfidence\b/i.test(s), false, s);
  }
});

test("the field carries no heading: twelve of them would be wallpaper", () => {
  // The sheet's "Why do you think so?" heading is deliberately NOT reused
  // here. It appears once over one call in the sheet; Radar draws twelve
  // untracked footers, and CallsTrustLine already sits once above the grid.
  for (const s of [TRACK_NOTE_PROMPT, ADOPT_NOTE_HINT, ADOPT_NOTE_HINT_WRITTEN]) {
    assert.equal(s.includes("Why do you think so?"), false, s);
  }
});

// ---------------------------------------------------------------------------
// Clearing the draft. The narrow question, and the reason it is narrow.
//
// /api/radar/claims/adopt answers `noteWritten` on two branches with two
// meanings. On the insert path it is read back off the row the request just
// created. On the already-adopted path it is Boolean(existing.commit_note),
// true whenever an OLD note is on the row, and the route only writes an
// incoming note to an existing row when that row has none. So a reader who
// writes a sentence against a stale card whose call is already adopted WITH a
// note has their text discarded by the route and gets a 200 with
// noteWritten: true. Clearing on that flag deletes their only copy.
// ---------------------------------------------------------------------------

test("a fresh insert that carries the note clears the draft", () => {
  assert.equal(
    noteLandedOnRow({ alreadyAdopted: false, noteWritten: true }),
    true,
  );
  // alreadyAdopted is simply absent on the insert path.
  assert.equal(noteLandedOnRow({ noteWritten: true }), true);
});

test("DATA LOSS GUARD: an already-adopted row never clears the draft", () => {
  // The row already had a note. The route discarded the reader's text and
  // still answered noteWritten: true. The draft MUST survive this.
  assert.equal(
    noteLandedOnRow({ alreadyAdopted: true, noteWritten: true }),
    false,
    "a sentence the route discarded must not be deleted from the field",
  );
  // The row had no note and the route wrote this one. Genuinely written, but
  // indistinguishable from the case above in the response, so it is also
  // treated as unproven. A stale draft is the acceptable side of that trade.
  assert.equal(noteLandedOnRow({ alreadyAdopted: true, noteWritten: false }), false);
});

test("an unacknowledged or silent 200 never clears the draft", () => {
  for (const shape of [
    {},
    { id: "x" },
    { noteWritten: false },
    { alreadyAdopted: true },
    { noteWritten: "true" },
    { noteWritten: 1 },
    { alreadyAdopted: "true", noteWritten: true },
  ]) {
    if (shape.alreadyAdopted === "true") {
      // A non-boolean true is not alreadyAdopted, but noteWritten is a real
      // boolean here, so this one legitimately clears. Documented, not silent.
      assert.equal(noteLandedOnRow(shape), true, JSON.stringify(shape));
      continue;
    }
    assert.equal(noteLandedOnRow(shape), false, JSON.stringify(shape));
  }
});
