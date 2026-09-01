// Unit tests for the row mappers behind Radar's Calls section on a phone
// (src/lib/radar-calls-screen-data.ts).
//
// These lock the three defects the redesign fixes, all of which were reported
// as one ("evidence counts under a Not graded call") and are structurally
// three:
//
//   1. "Not graded" was one word over two different facts. A gradeable claim
//      whose window has closed with no outcome row is PENDING: it satisfies
//      every condition the grader scans for and is queued. The other routes to
//      the same absence are terminal. The screen said "no credible grade
//      exists and never will" about all of them.
//   2. The evidence block rendered on every row and could say something true
//      on almost none. It renders under an open claim of a scanned type, and
//      nowhere else.
//   3. A brief call can never carry evidence, because claim_evidence keys on a
//      user_claims id. It used to draw "No new evidence yet." on every one.
//
// Run: npx tsx --test tests/unit/radar-calls-rows.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefRow,
  claimRow,
  evidenceBasisOf,
} from "../../src/lib/radar-calls-screen-data.ts";
import type { BriefCallRow, UserClaim } from "../../src/lib/radar-calls-model.ts";
import type { CallOutcomeRow } from "../../src/lib/scored-object-map.ts";

const TODAY = "2026-07-26";
const NO_EVIDENCE: Record<string, { stance?: string | null }[]> = {};

function claim(over: Partial<UserClaim> = {}): UserClaim {
  return {
    id: "c1",
    user_claim: "NVDA outruns its sector into the print.",
    claim_type: "ticker",
    target_symbol: "NVDA",
    expected_direction: "bullish",
    resolution_window_start: "2026-07-01",
    resolution_window_end: "2026-07-10",
    gradeable: true,
    gradeability_note: null,
    status: "open",
    source: "authored",
    adopted_from_call_id: null,
    created_at: "2026-07-01T13:00:00Z",
    ...over,
  };
}

function outcome(over: Partial<CallOutcomeRow> = {}): CallOutcomeRow {
  return {
    call_id: "c1",
    verdict: "correct",
    attribution: "clean",
    actual_pct_change: 2.31,
    actual_direction: "up",
    verdict_notes: null,
    graded_at: "2026-07-11T23:00:00Z",
    metadata: { grader: "price_attribution", entity_symbol: "NVDA", entity_move_pct: 2.31 },
    ...over,
  };
}

/* ── 1. pending is not terminal ─────────────────────────────────────── */

test("a gradeable claim whose window closed with no grade is PENDING", () => {
  const row = claimRow(claim(), null, TODAY, NO_EVIDENCE);
  assert.equal(row.state, null, "there is no outcome word for it");
  assert.equal(row.notGradedPending, true);
});

test("an ungradable outcome row is terminal, not pending", () => {
  const row = claimRow(
    claim(),
    outcome({ verdict: "ungradable", attribution: null, metadata: { ungradable_reason: "no_price_data" } }),
    TODAY,
    NO_EVIDENCE,
  );
  assert.equal(row.state, null);
  assert.equal(row.notGradedPending, false);
});

test("a claim written gradeable: false is terminal by construction", () => {
  const row = claimRow(
    claim({ gradeable: false, gradeability_note: "Tracked as context only." }),
    null,
    TODAY,
    NO_EVIDENCE,
  );
  assert.equal(row.state, null);
  assert.equal(row.notGradedPending, false);
});

test("a legacy row with no attribution is terminal, not pending", () => {
  const row = claimRow(claim(), outcome({ attribution: null }), TODAY, NO_EVIDENCE);
  assert.equal(row.state, null);
  assert.equal(row.notGradedPending, false);
});

test("a claim still inside its window is awaiting, and awaiting is not pending", () => {
  const row = claimRow(claim({ resolution_window_end: "2026-08-30" }), null, TODAY, NO_EVIDENCE);
  assert.equal(row.state, "awaiting");
  assert.equal(row.notGradedPending, false);
});

/* ── 2. the evidence gate ───────────────────────────────────────────── */

test("evidence renders only under an open claim of a scanned type", () => {
  const open = claim({ resolution_window_end: "2026-08-30" });
  const row = claimRow(open, null, TODAY, { c1: [{ stance: "support" }, { stance: "challenge" }] });
  assert.equal(row.state, "awaiting");
  assert.deepEqual(row.evidenceBasis, { kind: "ticker", symbol: "NVDA" });
  assert.equal(row.evidence?.length, 2);
});

test("an open claim the pass scans but has matched nothing keeps its honest empty line", () => {
  const row = claimRow(claim({ resolution_window_end: "2026-08-30" }), null, TODAY, NO_EVIDENCE);
  assert.deepEqual(row.evidenceBasis, { kind: "ticker", symbol: "NVDA" });
  assert.deepEqual(row.evidence, [], "scanned and matched nothing is a real answer");
});

test("a settled claim carries no evidence block", () => {
  const row = claimRow(claim(), outcome(), TODAY, { c1: [{ stance: "support" }] });
  assert.equal(row.state, "supported");
  assert.equal(row.evidenceBasis, undefined);
  assert.equal(row.evidence, null);
});

test("a not-graded claim carries no evidence block, pending or terminal", () => {
  const pending = claimRow(claim(), null, TODAY, { c1: [{ stance: "support" }] });
  assert.equal(pending.notGradedPending, true);
  assert.equal(pending.evidenceBasis, undefined);

  const terminal = claimRow(
    claim({ gradeable: false }),
    null,
    TODAY,
    { c1: [{ stance: "support" }] },
  );
  assert.equal(terminal.notGradedPending, false);
  assert.equal(terminal.evidenceBasis, undefined);
});

test("a claim type the evidence pass never scans gets no block at all", () => {
  // backend/grading/claim_evidence.py: "index / aggregate / other : NEVER
  // matched". An empty line under one of these asserts nothing was recorded
  // when the truth is that nothing was ever looked at.
  for (const claim_type of ["index", "aggregate", "other"]) {
    const row = claimRow(
      claim({ claim_type, resolution_window_end: "2026-08-30" }),
      null,
      TODAY,
      NO_EVIDENCE,
    );
    assert.equal(row.state, "awaiting", `${claim_type} is still an open claim`);
    assert.equal(row.evidenceBasis, undefined, `${claim_type} must carry no evidence block`);
  }
});

test("a claim with no symbol cannot be matched and gets no block", () => {
  const row = claimRow(
    claim({ target_symbol: null, resolution_window_end: "2026-08-30" }),
    null,
    TODAY,
    NO_EVIDENCE,
  );
  assert.equal(row.evidenceBasis, undefined);
});

test("the basis names which of the two scanned shapes a row is", () => {
  assert.deepEqual(evidenceBasisOf(claim()), { kind: "ticker", symbol: "NVDA" });
  assert.deepEqual(evidenceBasisOf(claim({ claim_type: "sector", target_symbol: "XLF" })), {
    kind: "sector",
    symbol: "XLF",
  });
});

/* ── 3. a brief row can never carry evidence ────────────────────────── */

function brief(over: Partial<BriefCallRow> = {}): BriefCallRow {
  return {
    id: "b1",
    claim_text: "The desk states something falsifiable about NVDA.",
    claim_type: "ticker",
    target_symbol: "NVDA",
    brief_date: "2026-07-10",
    resolve_on: "2026-07-17",
    created_at: "2026-07-10T13:00:00Z",
    confidence: 0.7,
    ...over,
  };
}

test("a brief row carries no evidence field on any path", () => {
  const graded = briefRow(brief(), outcome({ call_id: "b1" }), TODAY);
  const ungraded = briefRow(brief(), null, TODAY);
  const live = briefRow(brief({ brief_date: "2026-08-30" }), null, TODAY);
  for (const row of [graded, ungraded, live]) {
    assert.equal(row.evidenceBasis, undefined);
    assert.equal(row.evidence, undefined);
  }
});

test("a brief call the grader has not reached is pending, not terminal", () => {
  const row = briefRow(brief(), null, TODAY);
  assert.equal(row.state, null);
  assert.equal(row.notGradedPending, true);
});

test("a brief call refused by the grader is terminal", () => {
  const row = briefRow(
    brief(),
    outcome({ call_id: "b1", verdict: "ungradable", attribution: null, metadata: { ungradable_reason: "unmapped_symbol" } }),
    TODAY,
  );
  assert.equal(row.state, null);
  assert.equal(row.notGradedPending, false);
});
