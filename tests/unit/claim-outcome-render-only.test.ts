// The outcome may feed the render. It may never feed the control.
//
// WHAT THIS PINS. `/claim/[id]` now reads `morning_brief_call_outcomes` and
// draws what it finds: the outcome word, the dot, the attribution sentence, the
// benchmark evidence and the date the desk checked it. That read is NEW, not a
// restoration. What used to sit there selected `call_id` and nothing else, a
// bare existence probe whose one job was to suppress the commit control, and
// PR 780 deleted it because the desk's window has no business deciding that: a
// commit opens the READER's window today and grades on the reader's dates
// (src/lib/commit-legality.ts carries the read paths).
//
// So the defect was never READING the outcome. It was letting the outcome
// decide the control. This file holds that shut by driving the loader over one
// call with SEVEN different outcome reads bolted to it, including a read that
// fails outright, and asserting that `variant`, `commitReason` and the payload
// the commit sheet is opened with are byte-identical every time.
//
// THE ROW UNDER TEST IS THE CONTRADICTION ROW, deliberately: a call the desk
// graded CHALLENGED, whose own window closed yesterday. That is the exact shape
// the complaint was raised about, where the screen reads Challenged and offers
// "Track this call". The ruling of PR 780 says the commitment is legal, and
// `expectOffer: true` here is that ruling written down.
//
// WHAT IT DOES NOT ASSERT: pixels. The render side is asserted only as far as
// the loader carries it, which is that the word, the reading and the evidence
// reach the shape at all, and that a FAILED read arrives as "unread" rather
// than as an ungraded call. A screen that drew a failed read as an open call
// would tell a reader nobody has looked at a call the desk settled weeks ago.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadClaim, type ClaimData } from "../../src/lib/claim-data.ts";
import { commitWindow, commitWindowEnd } from "../../src/lib/commit-legality.ts";
import {
  DEFAULT_ADOPT_HORIZON,
  HORIZON_DAYS,
  addCalendarDays,
  adoptWindowDays,
  adoptWindowForCall,
} from "../../src/lib/call-horizons.ts";
import { todayPt } from "../../src/lib/session-date.ts";

const TODAY = todayPt();
const CALL_ID = "77700e1a-11aa-4bbb-8ccc-000000000001";
const READER = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";

/* The call. Everything the commit rule reads is present, so the commitment is
   legal, and the desk's own window closed yesterday, so every outcome below is
   one the desk could really have written about it. */
const CALL = {
  id: CALL_ID,
  claim_text: "The named instrument leads its sector over the window.",
  claim_type: "ticker",
  target_symbol: "ZZZ",
  expected_direction: "bullish",
  brief_date: addCalendarDays(TODAY, -8),
  resolve_on: addCalendarDays(TODAY, -1),
  created_at: `${addCalendarDays(TODAY, -8)}T13:45:00Z`,
};

/** A metadata blob in the shape backend/grading/price_attribution.py writes. */
const META = {
  grader: "price_attribution",
  entity_symbol: "ZZZ",
  entity_move_pct: -2.4,
  thresholds_pct: { min_excess: 0.75 },
  benchmarks: [
    { symbol: "XLQ", role: "sector", move_pct: 0.42, excess_pct: -2.82, meaningful_bar_pct: 0.75 },
    { symbol: "SPY", role: "market", move_pct: 0.15, excess_pct: -2.55, meaningful_bar_pct: 0.75 },
  ],
};

interface Scenario {
  name: string;
  /** null: the read answered with no row. "error": the read failed. */
  outcome: Record<string, unknown> | null | "error";
  /** The mobile word the loader must reach, or null for no word at all. */
  expectState: string | null;
}

const SCENARIOS: Scenario[] = [
  { name: "no outcome row at all", outcome: null, expectState: null },
  {
    name: "graded challenged, clean attribution",
    outcome: {
      call_id: CALL_ID,
      verdict: "wrong",
      attribution: "clean",
      verdict_notes: "model prose that this screen does not draw",
      graded_at: `${addCalendarDays(TODAY, -1)}T22:10:00Z`,
      metadata: META,
    },
    expectState: "challenged",
  },
  {
    name: "graded supported, clean attribution",
    outcome: {
      call_id: CALL_ID,
      verdict: "correct",
      attribution: "clean",
      graded_at: `${addCalendarDays(TODAY, -1)}T22:10:00Z`,
      metadata: { ...META, entity_move_pct: 3.1 },
    },
    expectState: "supported",
  },
  {
    name: "confounded, no credit to the thesis",
    outcome: {
      call_id: CALL_ID,
      verdict: "correct",
      attribution: "confounded",
      graded_at: `${addCalendarDays(TODAY, -1)}T22:10:00Z`,
      metadata: META,
    },
    expectState: "developing",
  },
  {
    name: "under the attribution bar",
    outcome: {
      call_id: CALL_ID,
      verdict: "partial",
      attribution: "inconclusive",
      graded_at: `${addCalendarDays(TODAY, -1)}T22:10:00Z`,
      metadata: META,
    },
    expectState: "developing",
  },
  {
    // THE THIRD RENDERING. A row the grader refused resolves to NO WORD, and the
    // screen has to draw the hollow ring for it rather than an OutcomeLead.
    name: "an outcome row the grader refused",
    outcome: {
      call_id: CALL_ID,
      verdict: "ungradable",
      attribution: null,
      graded_at: `${addCalendarDays(TODAY, -1)}T22:10:00Z`,
      metadata: { ungradable_reason: "no_price_data" },
    },
    expectState: null,
  },
  { name: "the outcome read failed", outcome: "error", expectState: null },
];

/* ── a Supabase client that answers one call and one chosen outcome ──── */

function clientFor(scenario: Scenario): SupabaseClient {
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "eq", "in", "neq", "gte", "lte"]) {
      chain[m] = () => chain;
    }
    const answer = () => {
      if (table === "morning_brief_calls") return { data: [CALL], error: null };
      if (table === "morning_brief_call_outcomes") {
        if (scenario.outcome === "error") return { data: null, error: { message: "boom" } };
        return { data: scenario.outcome ? [scenario.outcome] : [], error: null };
      }
      // Signed in with an empty record, so `onLedger` never masks the answer.
      return { data: [], error: null };
    };
    chain.maybeSingle = async () => {
      const r = answer();
      return { data: (r.data as unknown[] | null)?.[0] ?? null, error: r.error };
    };
    chain.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve(answer()).then(ok, fail);
    return chain;
  };
  return { from: builder } as unknown as SupabaseClient;
}

async function load(scenario: Scenario): Promise<ClaimData> {
  const { data, stage } = await loadClaim(clientFor(scenario), READER, CALL_ID);
  assert.equal(stage, "ready", `${scenario.name}: the call did not load`);
  assert.ok(data, `${scenario.name}: the loader answered with no data`);
  return data;
}

/* ── 1. the guardrail ─────────────────────────────────────────────────── */

test("no outcome, however it settled, changes the control", async () => {
  const baseline = await load(SCENARIOS[0]);

  // The ruling of PR 780, written down. The desk graded this call and its own
  // window closed yesterday; the reader's opens today, so the commitment is
  // legal and the enabled Track control is correct.
  assert.equal(baseline.variant, "open", "the contradiction row is not offered the commitment");
  assert.equal(baseline.commitReason, null);

  for (const scenario of SCENARIOS) {
    const data = await load(scenario);

    assert.equal(
      data.variant,
      baseline.variant,
      `${scenario.name}: the outcome moved the variant, which is the defect PR 780 fixed`,
    );
    assert.equal(
      data.commitReason,
      baseline.commitReason,
      `${scenario.name}: the outcome moved the reason the commitment is withheld`,
    );

    // The four fields the screen hands the commit sheet when Track is pressed.
    // `claim-screen.tsx` builds the target out of exactly these, so a change to
    // any of them is a change to what a press writes.
    assert.deepEqual(
      {
        callId: data.callId,
        claim: data.claim,
        resolveOn: data.resolveOn,
        sessionIso: data.sessionIso,
      },
      {
        callId: baseline.callId,
        claim: baseline.claim,
        resolveOn: baseline.resolveOn,
        sessionIso: baseline.sessionIso,
      },
      `${scenario.name}: the outcome changed what a press would write`,
    );

    // And the reader's own window, which is the other thing a press decides.
    assert.deepEqual(
      data.readerWindow,
      baseline.readerWindow,
      `${scenario.name}: the outcome moved the reader's window`,
    );
  }
});

/* ── 2. the outcome reaches the render ────────────────────────────────── */

test("every outcome the desk can write reaches the shape the screen draws", async () => {
  for (const scenario of SCENARIOS) {
    const data = await load(scenario);

    if (scenario.outcome === "error") {
      // A FAILED READ IS NOT AN UNGRADED CALL. It has its own literal, and the
      // screen draws a notice for it rather than a stateless open claim.
      assert.equal(data.outcome, "unread", "a failed outcome read did not surface as unread");
      continue;
    }

    assert.notEqual(data.outcome, "unread", `${scenario.name}: an answered read surfaced as unread`);
    if (data.outcome === "unread") continue;

    assert.equal(
      data.outcome.state,
      scenario.expectState,
      `${scenario.name}: the mobile word is not the one the row would draw`,
    );

    // Every rendering carries a reading. A settled call gets the grader's
    // attribution sentence; an unsettled one gets what it is watching for.
    assert.ok(
      (data.outcome.reading ?? "").length > 0,
      `${scenario.name}: nothing to draw in the reading slot`,
    );

    if (scenario.expectState === null && scenario.outcome !== null) {
      // A refused row is TERMINAL. Only a call with no row at all is queued.
      assert.equal(data.outcome.pending, false, `${scenario.name}: a refusal read as pending`);
      assert.ok(
        (data.outcome.notGradedReason ?? "").length > 0,
        `${scenario.name}: no grade and no reason for it`,
      );
    }
    if (scenario.outcome === null) {
      assert.equal(data.outcome.pending, true, "a closed window with no row is queued, not refused");
      assert.equal(data.outcome.measure, null, "benchmark evidence on a call nobody graded");
      assert.equal(data.outcome.gradedOn, null, "a check date on a call nobody graded");
    }
  }
});

test("the benchmark evidence is the grader's own, never derived", async () => {
  const data = await load(SCENARIOS[1]);
  assert.notEqual(data.outcome, "unread");
  if (data.outcome === "unread") return;

  const measure = data.outcome.measure;
  assert.ok(measure, "a settled call drew no benchmark evidence");
  assert.deepEqual(measure.entity, { symbol: "ZZZ", move: "-2.40%" });
  // The symbols and the moves the grader wrote, in the order it wrote them.
  // Nothing here maps a sector to an ETF, which is the prediction this block
  // was cut for making before grading existed to look at.
  assert.deepEqual(measure.benchmarks, [
    { symbol: "XLQ", move: "+0.42%" },
    { symbol: "SPY", move: "+0.15%" },
  ]);
  assert.equal(measure.bar, "0.75%");
  assert.equal(data.outcome.gradedOn, addCalendarDays(TODAY, -1));

  // A call the grader has not settled has no evidence to state.
  const ungraded = await load(SCENARIOS[0]);
  assert.notEqual(ungraded.outcome, "unread");
  if (ungraded.outcome !== "unread") assert.equal(ungraded.outcome.measure, null);
});

/* ── 3. the reader's window is the sheet's window ─────────────────────── */

test("the window the screen states is the window a press would write", async () => {
  const data = await load(SCENARIOS[1]);
  assert.ok(data.readerWindow, "an open call stated no window for the reader");

  /* THE SHEET'S OWN ARITHMETIC, reproduced from `commit-sheet.tsx:126` and
     `:271-272` rather than restated: it derives the span from
     `adoptWindowForCall(target.sessionIso, target.resolveOn)`, and
     `claim-screen.tsx` passes `sessionIso` and `resolveOn` straight off this
     shape. If those two ever come apart the screen names a span no press
     writes, which is worse than naming none. */
  const sheetSpan = adoptWindowForCall(data.sessionIso, data.resolveOn);
  const sheetDays = adoptWindowDays(sheetSpan);
  assert.equal(data.readerWindow.span, `${sheetDays} days`);
  assert.equal(data.readerWindow.closes, addCalendarDays(data.sessionIso, sheetDays));

  // And the legality rule evaluates against that same window.
  assert.equal(commitWindowEnd(CALL, TODAY), data.readerWindow.closes);
});

test("a resolve_on already in the past falls to the sheet's default, not the desk's span", () => {
  /* THE TRAP, PINNED. `commitWindowEnd` used to call
     `adoptWindowForCall(brief_date, resolve_on)`, which is the DESK's span, and
     the comment above it claimed that was the sheet's. On a call whose
     resolve_on has passed it cannot be: the sheet measures from TODAY, gets a
     negative span, and falls through to DEFAULT_ADOPT_HORIZON. A same-session
     desk call therefore yielded a zero-day window on one side of the screen and
     a seven-day one on the other, on the same press. */
  const sameSession = {
    ...CALL,
    brief_date: addCalendarDays(TODAY, -5),
    resolve_on: addCalendarDays(TODAY, -5),
  };
  const deskSpan = adoptWindowDays(
    adoptWindowForCall(sameSession.brief_date, sameSession.resolve_on),
  );
  assert.equal(deskSpan, 0, "fixture drift: the desk's own span is not a same-session one");

  const reader = commitWindow(sameSession, TODAY);
  assert.equal(
    reader.days,
    HORIZON_DAYS[DEFAULT_ADOPT_HORIZON],
    "the reader's window is not the one the commit sheet defaults to",
  );
  assert.equal(reader.endIso, addCalendarDays(TODAY, HORIZON_DAYS[DEFAULT_ADOPT_HORIZON]));

  // A live call is unaffected: the desk's remaining span is what both use.
  const live = { ...CALL, brief_date: TODAY, resolve_on: addCalendarDays(TODAY, 7) };
  assert.equal(commitWindow(live, TODAY).days, 7);
});
