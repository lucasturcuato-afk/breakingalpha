// Unit tests for the honesty of the two record blocks on /dashboard.
//
// The blocks are 1:1 renders of pure models, so testing the models here is
// testing what the user sees:
//   - the user's record  -> src/lib/your-record.ts    (YourCallsWidget)
//   - the desk's record  -> src/lib/desk-record.ts    (DeskRecordSummary)
//   - the learning badge -> src/lib/learning-badge.ts (SystemIntelligenceWidget)
//
// What is locked:
//   1. Zero graded user claims renders an honest empty personal block and
//      carries none of the desk's counts.
//   2. The desk block shows challenged and no-clean-read at equal prominence
//      and publishes no top-line hit rate.
//   3. No string either block authors contains W/L shorthand or a hit-rate
//      percentage.
//   4. A user WITH outcomes gets their own numbers, and the desk's numbers
//      cannot reach that model at all.
//   5. "Learning active" renders only on real calibrator evidence.
//   6. The source files enforce the split: the personal block never reads the
//      desk's table, and the deleted hit-rate component stays deleted.
//
// Run: node --test tests/unit/dashboard-honesty.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  buildDeskRecord,
  deskRecordAuthoredStrings,
  DESK_RECORD_COPY,
  RESOLUTION_ORDER,
  type DeskCallRow,
} from "../../src/lib/desk-record.ts";
import {
  buildYourRecord,
  resolutionForClaim,
  yourRecordAuthoredStrings,
  YOUR_RECORD_COPY,
  type UserClaimLike,
} from "../../src/lib/your-record.ts";
import { shouldShowLearningBadge } from "../../src/lib/learning-badge.ts";
import { isAwaitingOwnVerdict, type ClaimOutcomeRow } from "../../src/lib/claim-outcome.ts";
import { WL_SHORTHAND, ANY_RATE_FIGURE, SPORTS_WORDS } from "./honesty-detectors.ts";

const TODAY = "2026-08-02";

// ── fixtures ────────────────────────────────────────────────────────────────

function claim(id: string, symbol = "NVDA"): UserClaimLike {
  return {
    id,
    user_claim: `${symbol} holds its post-earnings gap`,
    claim_type: "ticker",
    target_symbol: symbol,
    created_at: "2026-07-20T14:00:00Z",
    source: "authored",
    adopted_from_call_id: null,
    status: "open",
    gradeable: true,
  };
}

/** A context entry: never price-checked, and no verdict on the way. */
function contextClaim(id: string, source = "authored"): UserClaimLike {
  return { ...claim(id), source, gradeable: false };
}

function outcome(
  claimId: string,
  verdict: string,
  attribution: "clean" | "confounded" | "inconclusive" | null,
): ClaimOutcomeRow {
  return {
    claim_id: claimId,
    verdict,
    attribution,
    actual_pct_change: 0.0182,
    actual_direction: "up",
    graded_at: "2026-07-30T12:00:00Z",
    metadata: { grader: "price_attribution", entity_symbol: "NVDA" },
  };
}

/** The live desk shape as of this branch: 22/15/29/41 over 107 graded rows. */
function deskRows(): DeskCallRow[] {
  const spec: Array<[string, "clean" | "confounded" | "inconclusive" | null, number]> = [
    ["correct", "clean", 22],
    ["wrong", "clean", 15],
    ["partial", "clean", 3],
    ["partial", "confounded", 12],
    ["wrong", "confounded", 4],
    ["partial", "inconclusive", 6],
    ["wrong", "inconclusive", 4],
    ["correct", null, 11],
    ["ungradable", null, 23],
    ["wrong", null, 7],
  ];
  const rows: DeskCallRow[] = [];
  let n = 0;
  for (const [verdict, attribution, count] of spec) {
    for (let i = 0; i < count; i++) {
      const id = `call-${n++}`;
      rows.push({
        call: {
          id,
          claim_text: "AAPL outperforms the sector into the print",
          claim_type: "ticker",
          target_symbol: "AAPL",
          brief_date: "2026-07-15",
          created_at: "2026-07-15T13:00:00Z",
          confidence: 0.6,
        },
        outcome: {
          call_id: id,
          verdict,
          attribution,
          actual_pct_change: 0.01,
          actual_direction: "up",
          verdict_notes: null,
          graded_at: "2026-07-16T12:00:00Z",
          metadata: { grader: "price_attribution", entity_symbol: "NVDA" },
        },
      });
    }
  }
  return rows;
}

// ── 1. zero graded user claims ──────────────────────────────────────────────

test("zero user outcomes: honest empty personal block, no desk counts", () => {
  const claims = [claim("c1"), claim("c2", "AMD"), claim("c3", "MSFT")];
  const record = buildYourRecord(claims, {}, TODAY);

  assert.equal(record.totalClaims, 3);
  assert.equal(record.resolved, 0);
  assert.equal(record.awaiting, 3);
  assert.equal(record.hasResolved, false, "nothing graded means hasResolved false");
  for (const r of RESOLUTION_ORDER) {
    assert.equal(record.byResolution[r], 0, `${r} must be zero, not borrowed`);
  }

  // The surface's own strings say so, and invite a claim rather than hide.
  assert.match(YOUR_RECORD_COPY.noneResolvedTitle, /has resolved yet/i);
  assert.match(YOUR_RECORD_COPY.noClaimsBody, /Commit one in Radar/i);

  // None of the desk's live counts can appear in the personal model.
  const desk = buildDeskRecord(deskRows(), TODAY, 40);
  const deskNumbers = [desk.total, ...RESOLUTION_ORDER.map((r) => desk.byResolution[r])];
  const yours = yourRecordAuthoredStrings(record);
  for (const n of deskNumbers) {
    if (n === 0) continue;
    assert.equal(
      yours.includes(String(n)),
      false,
      `personal block leaked a desk count: ${n}`,
    );
  }
});

test("no claims at all: the block says so and invites the first one", () => {
  const record = buildYourRecord([], {}, TODAY);
  assert.equal(record.totalClaims, 0);
  assert.equal(record.hasResolved, false);
  assert.match(YOUR_RECORD_COPY.noClaimsTitle, /have not made a call/i);
  assert.match(YOUR_RECORD_COPY.cta, /Make a call/i);
});

// ── 2. desk block: misses at equal prominence, no top-line hit rate ─────────

test("desk block shows misses and no-clean-reads beside supported", () => {
  const record = buildDeskRecord(deskRows(), TODAY, 40);

  assert.equal(record.total, 107);
  assert.equal(record.byResolution.supported, 22);
  assert.equal(record.byResolution.challenged, 15);
  assert.equal(record.byResolution.noCleanRead, 29);
  assert.equal(record.byResolution.notGraded, 41);

  const sum = RESOLUTION_ORDER.reduce((a, r) => a + record.byResolution[r], 0);
  assert.equal(sum, record.total, "buckets must sum to the row count");

  // Order puts challenged and no-clean-read immediately beside supported.
  assert.deepEqual(RESOLUTION_ORDER, [
    "supported",
    "challenged",
    "noCleanRead",
    "notGraded",
  ]);

  // The model publishes no ratio for a headline to render.
  const keys = Object.keys(record);
  for (const banned of ["hitRate", "winRate", "accuracy", "right", "wrong"]) {
    assert.equal(keys.includes(banned), false, `desk model exposes ${banned}`);
  }
});

// ── 3. no W/L shorthand and no hit-rate percentage in either block ──────────

// The detectors moved to ./honesty-detectors.ts so the rendered-output
// assertions in reader-output-honesty.test.ts share them verbatim. Scoping
// them to this file is what let /morning-brief author the banned format.

test("neither block authors W/L shorthand, a percentage, or sports vocabulary", () => {
  const desk = buildDeskRecord(deskRows(), TODAY, 40);
  const yours = buildYourRecord(
    [claim("c1"), claim("c2", "AMD")],
    { c1: outcome("c1", "correct", "clean") },
    TODAY,
  );

  const strings = [
    ...deskRecordAuthoredStrings(desk),
    ...yourRecordAuthoredStrings(yours),
    ...Object.values(YOUR_RECORD_COPY.bucketLabel),
  ];

  for (const s of strings) {
    assert.equal(WL_SHORTHAND.test(s), false, `W/L shorthand in: ${s}`);
    assert.equal(ANY_RATE_FIGURE.test(s), false, `percentage in: ${s}`);
    assert.equal(SPORTS_WORDS.test(s), false, `sports vocabulary in: ${s}`);
  }

  // The vocabulary that IS allowed, and it is shared by both records.
  assert.deepEqual(Object.values(DESK_RECORD_COPY.bucketLabel).sort(), [
    "Challenged",
    "No clean read",
    "Not graded",
    "Supported",
  ]);
  assert.equal(YOUR_RECORD_COPY.bucketLabel, DESK_RECORD_COPY.bucketLabel);
  assert.equal(YOUR_RECORD_COPY.awaitingLabel, "Awaiting");
});

// ── 4. a user WITH outcomes gets their own numbers ─────────────────────────

test("a user with outcomes renders their own numbers, never the desk's", () => {
  const claims = [
    claim("c1"),
    claim("c2", "AMD"),
    claim("c3", "MSFT"),
    claim("c4", "TSLA"),
    claim("c5", "SPY"),
  ];
  const outcomes: Record<string, ClaimOutcomeRow> = {
    c1: outcome("c1", "correct", "clean"),
    c2: outcome("c2", "wrong", "clean"),
    c3: outcome("c3", "partial", "confounded"),
    c4: outcome("c4", "ungradable", null),
  };
  const record = buildYourRecord(claims, outcomes, TODAY);

  assert.equal(record.totalClaims, 5);
  assert.equal(record.resolved, 4);
  assert.equal(record.awaiting, 1, "the ungraded claim is awaiting, not a miss");
  assert.equal(record.hasResolved, true);
  assert.equal(record.byResolution.supported, 1);
  assert.equal(record.byResolution.challenged, 1);
  assert.equal(record.byResolution.noCleanRead, 1);
  assert.equal(record.byResolution.notGraded, 1);

  // The per-row chip and the summary agree, because they share one decision.
  assert.equal(resolutionForClaim(claims[0], outcomes, TODAY), "supported");
  assert.equal(resolutionForClaim(claims[1], outcomes, TODAY), "challenged");
  assert.equal(resolutionForClaim(claims[2], outcomes, TODAY), "noCleanRead");
  assert.equal(resolutionForClaim(claims[4], outcomes, TODAY), null);

  // A desk outcome keyed by call_id cannot be adopted as a claim's verdict:
  // the resolver keys on the claim id and there is no other input.
  const desk = { "call-0": outcome("call-0", "correct", "clean") };
  const borrowed = buildYourRecord([claim("c9")], desk, TODAY);
  assert.equal(borrowed.resolved, 0);
  assert.equal(borrowed.awaiting, 1);
});

// ── 4b. context entries are outside the record, not inside "awaiting" ──────

test("a context claim lands in context, in neither awaiting nor resolved", () => {
  const record = buildYourRecord(
    [claim("c1"), contextClaim("x1"), contextClaim("x2", "adopted")],
    {},
    TODAY,
  );
  assert.equal(record.totalClaims, 3);
  assert.equal(record.context, 2, "both context entries are counted as such");
  assert.equal(record.awaiting, 1, "only the gradeable claim is awaiting");
  assert.equal(record.resolved, 0);
  for (const r of RESOLUTION_ORDER) {
    assert.equal(record.byResolution[r], 0, `${r} must stay empty`);
  }
  // The three counts account for every claim and nothing is counted twice.
  assert.equal(record.resolved + record.awaiting + record.context, record.totalClaims);
});

test("the shared predicate answers false for a context claim, both sources", () => {
  assert.equal(isAwaitingOwnVerdict(contextClaim("x1"), {}), false);
  assert.equal(isAwaitingOwnVerdict(contextClaim("x2", "adopted"), {}), false);
  assert.equal(isAwaitingOwnVerdict(claim("c1"), {}), true);
});

test("the awaiting note is true as written once context is counted apart", () => {
  // "Claims still inside their window are awaiting a grade." was false while a
  // row whose window closed 57 days ago was counted awaiting.
  const record = buildYourRecord([contextClaim("x1")], {}, TODAY);
  assert.equal(record.awaiting, 0);
  assert.match(YOUR_RECORD_COPY.awaitingNote, /still inside their window/i);
  assert.match(YOUR_RECORD_COPY.contextNote, /not price-checked/i);
  assert.match(YOUR_RECORD_COPY.contextNote, /no verdict is written/i);
});

test("context is not a fifth outcome word", () => {
  // The four states are fixed. The context label must not appear among them,
  // and must not be a verdict word.
  assert.equal(
    Object.values(DESK_RECORD_COPY.bucketLabel).includes(YOUR_RECORD_COPY.contextLabel),
    false,
  );
  assert.deepEqual(RESOLUTION_ORDER, [
    "supported",
    "challenged",
    "noCleanRead",
    "notGraded",
  ]);
});

test("a context count carries no rate and no percentage", () => {
  const record = buildYourRecord([claim("c1"), contextClaim("x1")], {}, TODAY);
  for (const str of yourRecordAuthoredStrings(record)) {
    assert.equal(ANY_RATE_FIGURE.test(str), false, `percentage in: ${str}`);
    assert.equal(SPORTS_WORDS.test(str), false, `sports vocabulary in: ${str}`);
    assert.equal(WL_SHORTHAND.test(str), false, `W/L shorthand in: ${str}`);
  }
  // Exact keys, not a denylist: a ratio cannot be added to the model without
  // this failing, whatever it is named.
  assert.deepEqual(Object.keys(record).sort(), [
    "awaiting",
    "byResolution",
    "context",
    "hasResolved",
    "resolved",
    "totalClaims",
  ]);
});

// ── 5. the learning badge ──────────────────────────────────────────────────

test("Learning active renders only on real calibrator evidence", () => {
  assert.equal(shouldShowLearningBadge(null), false, "no evidence, no badge");
  assert.equal(shouldShowLearningBadge(undefined), false);
  // Live production shape today: one hand-tuned seed row, never fitted.
  assert.equal(
    shouldShowLearningBadge({ calibrated: false, fitTs: "2026-07-18T15:26:58Z", nTrain: 0 }),
    false,
    "the seed default is not learning",
  );
  assert.equal(
    shouldShowLearningBadge({ calibrated: true, fitTs: null, nTrain: 0 }),
    false,
    "a fitted flag with no training data is not evidence",
  );
  assert.equal(
    shouldShowLearningBadge({ calibrated: true, fitTs: "2026-08-01T00:00:00Z", nTrain: 24 }),
    true,
  );
});

// ── 6. the split is enforced in the source, not by discipline ──────────────

test("the personal block cannot read the desk's table", () => {
  const widget = readFileSync(
    new URL("../../src/components/dashboard/your-calls-widget.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(
    widget.includes("morning_brief_call_outcomes"),
    false,
    "YourCallsWidget must never query the desk's outcomes table",
  );
  // It may share the desk record's VOCABULARY (bucket labels, order). It may
  // not import the desk's data path or render the desk block.
  assert.equal(/from\s+["'][^"']*desk-record-query/.test(widget), false);
  assert.equal(/from\s+["'][^"']*desk-record-summary/.test(widget), false);
  assert.equal(/<DeskRecordSummary/.test(widget), false);

  const yourRecordSrc = readFileSync(
    new URL("../../src/lib/your-record.ts", import.meta.url),
    "utf8",
  );
  assert.equal(yourRecordSrc.includes("morning_brief_call_outcomes"), false);

  // The hit-rate component is gone, not merely unreferenced.
  assert.equal(
    existsSync(new URL("../../src/components/dashboard/call-record.tsx", import.meta.url)),
    false,
    "call-record.tsx (59% / 22W 15L) must stay deleted",
  );

  const page = readFileSync(
    new URL("../../src/app/dashboard/page.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(page.includes("CallRecord"), false);
  assert.match(page, /DeskRecordSummary/);
});
