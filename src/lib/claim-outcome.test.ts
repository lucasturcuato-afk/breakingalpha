/**
 * Tests for claim verdict resolution.
 *
 * The bug: src/app/api/radar/claims/route.ts fetched user_claim_outcomes only
 * for source === "authored" and routed adopted claims to
 * morning_brief_call_outcomes via adopted_from_call_id. Once the grader started
 * writing independent outcomes for adopted claims (#520), the correct verdict
 * was written and the wrong one displayed.
 *
 * Both live adopted claims were affected. One had a window that had not even
 * closed yet and was rendering the brief call's same-session verdict from weeks
 * earlier.
 *
 * Pure, deterministic, no network, no DOM.
 * Run: npx tsx --test src/lib/claim-outcome.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  isAwaitingOwnVerdict,
  resolveClaimOutcome,
  type ClaimOutcomeRow,
} from "./claim-outcome";

const OWN: ClaimOutcomeRow = {
  claim_id: "claim-1",
  verdict: "correct",
  attribution: "clean",
  actual_pct_change: 0.041,
  actual_direction: "up",
  graded_at: "2026-08-03T22:00:00Z",
};

/** What the brief call said. Must never reach a claim's verdict. */
const BRIEF: ClaimOutcomeRow = {
  call_id: "brief-call-99",
  verdict: "wrong",
  attribution: "confounded",
  actual_direction: "down",
  graded_at: "2026-07-03T22:00:00Z",
};

const adopted = {
  id: "claim-1",
  source: "adopted",
  adopted_from_call_id: "brief-call-99",
  gradeable: true,
};
const authored = {
  id: "claim-2",
  source: "authored",
  adopted_from_call_id: null,
  gradeable: true,
};

// ---------------------------------------------------------------------------
// Adopted claims read their own outcome
// ---------------------------------------------------------------------------

test("an adopted claim WITH its own outcome renders that outcome", () => {
  const got = resolveClaimOutcome(adopted, { "claim-1": OWN });
  assert.equal(got?.verdict, "correct");
  assert.equal(got?.attribution, "clean");
  assert.equal(got?.graded_at, "2026-08-03T22:00:00Z");
  assert.equal(isAwaitingOwnVerdict(adopted, { "claim-1": OWN }), false);
});

test("an adopted claim with NO own outcome renders unresolved, borrowing nothing", () => {
  const got = resolveClaimOutcome(adopted, {});
  assert.equal(got, null, "no verdict may be substituted");
  assert.equal(isAwaitingOwnVerdict(adopted, {}), true);
});

test("REGRESSION: own outcome wins when the brief call disagrees", () => {
  // The case that matters. The brief call said "wrong"; the user's own claim,
  // over the user's own window, graded "correct". The user must see "correct".
  const got = resolveClaimOutcome(adopted, { "claim-1": OWN });
  assert.equal(got?.verdict, "correct");
  assert.notEqual(got?.verdict, BRIEF.verdict);
  assert.equal(got?.attribution, "clean");
  assert.notEqual(got?.attribution, BRIEF.attribution);
  assert.equal(got?.actual_direction, "up");
});

test("the brief call's verdict is unreachable by construction", () => {
  // resolveClaimOutcome accepts only the own-outcome map. Even handed a map
  // keyed by the BRIEF CALL id, nothing resolves: there is no parameter through
  // which a morning_brief_call_outcomes row can become a claim's verdict.
  const briefKeyed = { "brief-call-99": BRIEF };
  assert.equal(resolveClaimOutcome(adopted, briefKeyed), null);
  assert.equal(isAwaitingOwnVerdict(adopted, briefKeyed), true);
});

test("a legacy adopted claim stays unresolved permanently", () => {
  // Created before independent grading, so it will never receive its own row
  // (the grader is live-forward and does not backfill). Unresolved is the
  // honest state: nobody ever graded THIS claim over THIS window.
  const legacy = {
    id: "legacy-1",
    source: "adopted",
    adopted_from_call_id: "brief-call-99",
    gradeable: true,
  };
  assert.equal(resolveClaimOutcome(legacy, { "brief-call-99": BRIEF }), null);
  assert.equal(isAwaitingOwnVerdict(legacy, {}), true);
});

// ---------------------------------------------------------------------------
// Authored claims are unchanged
// ---------------------------------------------------------------------------

test("an authored claim behaves exactly as before", () => {
  const own: ClaimOutcomeRow = { ...OWN, claim_id: "claim-2" };
  const got = resolveClaimOutcome(authored, { "claim-2": own });
  assert.equal(got?.verdict, "correct");
  // call_id is normalized onto the row for the ScoredObject mappers, from the
  // CLAIM id, exactly as the previous implementation did.
  assert.equal(got?.call_id, "claim-2");
});

test("an authored claim with no outcome is unresolved", () => {
  assert.equal(resolveClaimOutcome(authored, {}), null);
  assert.equal(isAwaitingOwnVerdict(authored, {}), true);
});

test("adopted and authored resolve identically: no source branch remains", () => {
  const a = resolveClaimOutcome({ ...adopted, id: "x" }, { x: { ...OWN, claim_id: "x" } });
  const b = resolveClaimOutcome({ ...authored, id: "x" }, { x: { ...OWN, claim_id: "x" } });
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test("call_id is the CLAIM id, never the brief call id", () => {
  const got = resolveClaimOutcome(adopted, { "claim-1": OWN });
  assert.equal(got?.call_id, "claim-1");
  assert.notEqual(got?.call_id, "brief-call-99");
  assert.equal(JSON.stringify(got).includes("brief-call-99"), false);
});

test("a row missing claim_id falls back to the claim's own id", () => {
  const got = resolveClaimOutcome(adopted, { "claim-1": { verdict: "partial" } });
  assert.equal(got?.call_id, "claim-1");
  assert.equal(got?.verdict, "partial");
});

test("the resolved row is a copy, not the stored object", () => {
  const store = { "claim-1": { ...OWN } };
  const got = resolveClaimOutcome(adopted, store)!;
  got.verdict = "mutated";
  assert.equal(store["claim-1"].verdict, "correct");
});

// ---------------------------------------------------------------------------
// Context claims are not awaiting
//
// A gradeable:false row is written with resolution_method.method = "none".
// backend/grading/grade_user_claims.py gates twice on the other value:
// fetch_due_claims filters .eq("gradeable", True), and is_price_gradeable
// requires method == "price_attribution". Nothing else writes user_claims
// .status after insert, so no verdict is coming and none ever will. Calling
// that "awaiting" told the reader to wait for something nobody is producing:
// one live row had its window close 57 days ago and still read awaiting.
// ---------------------------------------------------------------------------

const contextAuthored = {
  id: "ctx-1",
  source: "authored",
  adopted_from_call_id: null,
  gradeable: false,
};
const contextAdopted = {
  id: "ctx-2",
  source: "adopted",
  adopted_from_call_id: "brief-call-99",
  gradeable: false,
};

test("a context claim is NOT awaiting, whatever its source", () => {
  assert.equal(isAwaitingOwnVerdict(contextAuthored, {}), false);
  assert.equal(isAwaitingOwnVerdict(contextAdopted, {}), false);
});

test("adopted-and-closed, the worst of the four combinations", () => {
  // An adopted context claim whose window closed. It rendered a live card
  // reading "Resolves when the window closes", was counted open on
  // /radar/calls, read awaiting on the dashboard, and was excluded from
  // /ledger entirely. Three surfaces, three different wrong answers.
  assert.equal(isAwaitingOwnVerdict(contextAdopted, {}), false);
  assert.equal(resolveClaimOutcome(contextAdopted, {}), null, "still no verdict");
});

test("a gradeable claim with no outcome is still awaiting, both sources", () => {
  assert.equal(isAwaitingOwnVerdict(adopted, {}), true);
  assert.equal(isAwaitingOwnVerdict(authored, {}), true);
});

test("a context claim that somehow carries a verdict still shows it", () => {
  // One legacy production row carries gradeable:false beside
  // method: "price_attribution". If an outcome row exists for it, hiding that
  // outcome behind a category would be the same lie in the other direction.
  // resolveClaimOutcome never consults the flag.
  const own: ClaimOutcomeRow = { ...OWN, claim_id: "ctx-1" };
  const got = resolveClaimOutcome(contextAuthored, { "ctx-1": own });
  assert.equal(got?.verdict, OWN.verdict);
});
