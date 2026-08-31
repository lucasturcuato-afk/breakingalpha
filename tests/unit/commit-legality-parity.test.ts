// Two screens, one question: can this reader commit to this call?
//
// THE DEFECT THIS LOCKS SHUT. `/claim/[id]` and `/ledger` each computed that
// condition for themselves and reached opposite answers on the same five live
// call ids. The claim screen printed "The desk has already checked this call,
// so there is nothing left to commit to." The Ledger drew "Track this call" on
// the identical row, and pressing it wrote a real user_claims row with a live
// forward window and gradeable = true. One screen called the action impossible
// while the other performed it successfully.
//
// /ledger was right about legality: `/api/radar/claims/adopt` opens the
// READER's window today and `backend/grading/grade_user_claims.py` resolves it
// on the reader's dates, never reading adopted_from_call_id. The desk having
// closed or graded its own window says nothing about that. But /ledger was
// wrong in the other direction, which the pressure walk could not see: it
// offered the commitment on calls the adopt route writes gradeable = false for,
// and the grader's `.eq("gradeable", True)` drops those before the loop, so
// nothing ever closes them.
//
// WHAT IS ASSERTED, over one matrix of rows exercised through BOTH loaders:
//
//   1. AGREEMENT. For every row, /ledger offers the commitment exactly when
//      /claim/[id] offers it, and when neither does they decline it with the
//      SAME sentence. This is the assertion that goes red on the trunk: there,
//      a desk-graded or past-resolve_on call is "open" on the Ledger and
//      "graded" / "windowClosed" on the claim screen.
//
//   2. CORRECTNESS. Both answers equal isAdoptGradeable evaluated against the
//      window the commit would actually open, which is the exact predicate the
//      adopt route applies before deciding what to write. Agreeing on a wrong
//      condition would satisfy 1 and fail here. On the trunk BOTH screens fail
//      this on the no-symbol and no-direction rows.
//
//   3. NO DESK-WINDOW LEAK. A desk-graded call, a call whose resolve_on has
//      passed, and a call with no resolve_on at all are each offered whenever
//      an otherwise identical live call is. Those three are the specific
//      grounds the claim screen used to refuse on.
//
// WHY UNIT AND NOT E2E. Both surfaces are server components: their reads go
// from the Next server to Postgres and never through the browser, so
// page.route() cannot reach them and no browser spec can put a chosen call row
// in front of either loader. This drives the loaders directly with a client
// that answers exactly the rows it is given.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadClaim } from "../../src/lib/claim-data.ts";
import { loadLedger } from "../../src/lib/ledger-data.ts";
import { commitWindowEnd } from "../../src/lib/commit-legality.ts";
import {
  HORIZON_TYPES,
  HORIZON_DAYS,
  addCalendarDays,
  isAdoptGradeable,
} from "../../src/lib/call-horizons.ts";
import { todayPt } from "../../src/lib/session-date.ts";

/* ── the rows under test ──────────────────────────────────────────────
 *
 * Dates are relative to the reader's session date, so the matrix does not rot
 * the way a hardcoded 2026-08-28 would. Both loaders read that date from the
 * same todayPt(), so they cannot disagree about which day it is.
 */
const TODAY = todayPt();
const BRIEF_ID = "11111111-1111-4111-8111-111111111111";

interface CallFixture {
  id: string;
  claim_text: string;
  claim_type: string | null;
  target_symbol: string | null;
  expected_direction: string | null;
  brief_date: string;
  resolve_on: string | null;
  created_at: string;
  confidence: number;
  /** Whether morning_brief_call_outcomes carries a row for this call. */
  deskGraded: boolean;
  /** What the commit legality rule should answer. Written out, not derived. */
  expectOffer: boolean;
}

function id(n: number): string {
  return `52200e1a-11aa-4bbb-8ccc-${String(n).padStart(12, "0")}`;
}

const CALLS: CallFixture[] = [
  {
    // The control: everything present, desk window still open.
    id: id(1),
    claim_text: "NVDA outperforms its sector over the week.",
    claim_type: "ticker",
    target_symbol: "NVDA",
    expected_direction: "up",
    brief_date: TODAY,
    resolve_on: addCalendarDays(TODAY, 7),
    created_at: `${TODAY}T13:45:00Z`,
    confidence: 9,
    deskGraded: false,
    expectOffer: true,
  },
  {
    // THE CONTRADICTION ROW. The desk has already checked it. The reader's own
    // window still opens today, so the commitment is legal and both screens
    // must offer it.
    id: id(2),
    claim_text: "AMD outperforms its sector over the week.",
    claim_type: "ticker",
    target_symbol: "AMD",
    expected_direction: "up",
    brief_date: addCalendarDays(TODAY, -10),
    resolve_on: addCalendarDays(TODAY, -3),
    created_at: `${addCalendarDays(TODAY, -10)}T13:45:00Z`,
    confidence: 8,
    deskGraded: true,
    expectOffer: true,
  },
  {
    // The desk's window has passed and nobody graded it. Same answer: the
    // reader's window is not the desk's.
    id: id(3),
    claim_text: "XLE lags the market over the week.",
    claim_type: "sector",
    target_symbol: "XLE",
    expected_direction: "down",
    brief_date: addCalendarDays(TODAY, -20),
    resolve_on: addCalendarDays(TODAY, -6),
    created_at: `${addCalendarDays(TODAY, -20)}T13:45:00Z`,
    confidence: 7,
    deskGraded: false,
    expectOffer: true,
  },
  {
    // No resolve_on at all, which is the common case: every call written before
    // migration 0014 carries none. The reader picks their own window anyway.
    id: id(4),
    claim_text: "SPX closes the week above its 50 day average.",
    claim_type: "index",
    target_symbol: "SPX",
    expected_direction: "up",
    brief_date: addCalendarDays(TODAY, -40),
    resolve_on: null,
    created_at: `${addCalendarDays(TODAY, -40)}T13:45:00Z`,
    confidence: 6,
    deskGraded: false,
    expectOffer: true,
  },
  {
    // No instrument. isAdoptGradeable refuses, so the route would write
    // gradeable = false and the grader would never pick the row up.
    id: id(5),
    claim_text: "Rate expectations reprice by Friday.",
    claim_type: "ticker",
    target_symbol: null,
    expected_direction: "up",
    brief_date: TODAY,
    resolve_on: addCalendarDays(TODAY, 7),
    created_at: `${TODAY}T13:45:00Z`,
    confidence: 5,
    deskGraded: false,
    expectOffer: false,
  },
  {
    // An instrument but nothing to be right or wrong about.
    id: id(6),
    claim_text: "TSLA stays in the news through the week.",
    claim_type: "ticker",
    target_symbol: "TSLA",
    expected_direction: null,
    brief_date: TODAY,
    resolve_on: addCalendarDays(TODAY, 7),
    created_at: `${TODAY}T13:45:00Z`,
    confidence: 4,
    deskGraded: false,
    expectOffer: false,
  },
  {
    // A claim type the price grader cannot resolve.
    id: id(7),
    claim_text: "The chip cycle turns before the year is out.",
    claim_type: "macro",
    target_symbol: "SOXX",
    expected_direction: "up",
    brief_date: TODAY,
    resolve_on: addCalendarDays(TODAY, 7),
    created_at: `${TODAY}T13:45:00Z`,
    confidence: 3,
    deskGraded: false,
    expectOffer: false,
  },
];

/* ── a Supabase client that answers exactly these rows ────────────────
 *
 * Thenable per table, in the shape PostgREST returns, so both loaders run
 * unmodified. Nothing here writes.
 */

interface Result {
  data: unknown;
  error: { message: string } | null;
}

function callRow(c: CallFixture) {
  return {
    id: c.id,
    claim_text: c.claim_text,
    claim_type: c.claim_type,
    target_symbol: c.target_symbol,
    expected_direction: c.expected_direction,
    brief_date: c.brief_date,
    resolve_on: c.resolve_on,
    created_at: c.created_at,
    confidence: c.confidence,
  };
}

function answer(table: string, eq: Record<string, unknown>, inIds: string[] | null): Result {
  switch (table) {
    case "briefings":
      return eq.briefing_type === "morning"
        ? {
            data: [
              {
                id: BRIEF_ID,
                created_at: `${TODAY}T13:45:00Z`,
                headline: "Morning brief",
                market_pulse: null,
                market_tape: null,
              },
            ],
            error: null,
          }
        : { data: [], error: null };
    case "morning_brief_calls": {
      const wanted = typeof eq.id === "string" ? CALLS.filter((c) => c.id === eq.id) : CALLS;
      return { data: wanted.map(callRow), error: null };
    }
    case "morning_brief_call_outcomes": {
      // The filters are honoured, not ignored. The claim loader asks
      // .eq("call_id", one) and the Ledger asks .in("call_id", many); a fake
      // that answered every graded row to both would make the trunk withhold
      // the LIVE call too, and the red-before run would then blame the wrong
      // row for the contradiction.
      let graded = CALLS.filter((c) => c.deskGraded);
      if (typeof eq.call_id === "string") graded = graded.filter((c) => c.id === eq.call_id);
      if (inIds) graded = graded.filter((c) => inIds.includes(c.id));
      return { data: graded.map((c) => ({ call_id: c.id })), error: null };
    }
    // Signed in, with an empty record: no adoption anywhere, so `onLedger`
    // never masks the answer under test on either surface.
    case "user_profiles":
      return { data: [{ sectors: [] }], error: null };
    case "user_claims":
    case "user_claim_outcomes":
      return { data: [], error: null };
    default:
      return { data: [], error: null };
  }
}

function builder(table: string) {
  const eq: Record<string, unknown> = {};
  let inIds: string[] | null = null;
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "neq", "gte", "lte", "contains"]) {
    chain[m] = () => chain;
  }
  chain.in = (_column: string, values: unknown) => {
    if (Array.isArray(values)) inIds = values.filter((v): v is string => typeof v === "string");
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    eq[column] = value;
    return chain;
  };
  // maybeSingle collapses the array the way PostgREST does.
  chain.maybeSingle = async () => {
    const r = answer(table, eq, inIds);
    return { data: (r.data as unknown[])[0] ?? null, error: r.error };
  };
  chain.then = (ok: (v: Result) => unknown, fail?: (e: unknown) => unknown) =>
    Promise.resolve(answer(table, eq, inIds)).then(ok, fail);
  return chain;
}

const client = { from: (table: string) => builder(table) } as unknown as SupabaseClient;

const READER = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";

/* ── what each screen offers, read off the loader ──────────────────────
 *
 * Both helpers mirror the component's own gate verbatim, so this file measures
 * the screens rather than restating the fix.
 *   ledger-screen.tsx  onTrack is passed when `c.variant === "open"`
 *   claim-screen.tsx   onTrack is passed when `data.variant === "open"`, and
 *                      the bar only draws at all when the read is `ready`
 */

async function ledgerOffer() {
  const { data } = await loadLedger(client, READER, "NH");
  assert.ok(data, "the Ledger loader answered with no data");
  const claims = data.today.claims ?? [];
  assert.equal(claims.length, CALLS.length, "the Ledger did not render every call");
  return new Map(
    claims.map((c) => [
      c.id,
      { offers: c.variant === "open", reason: c.ungradeableReason ?? null },
    ]),
  );
}

async function claimOffer(callId: string) {
  const { data, stage } = await loadClaim(client, READER, callId);
  assert.ok(data, `the claim loader answered with no data for ${callId}`);
  return {
    offers: stage === "ready" && data.variant === "open",
    reason: (data as { commitReason?: string | null }).commitReason ?? null,
  };
}

/* ── the assertions ───────────────────────────────────────────────────── */

test("/ledger and /claim offer the commitment on exactly the same calls", async () => {
  const ledger = await ledgerOffer();
  for (const c of CALLS) {
    const claim = await claimOffer(c.id);
    const card = ledger.get(c.id);
    assert.ok(card, `call ${c.id} is missing from the Ledger`);
    assert.equal(
      card.offers,
      claim.offers,
      `the two screens disagree about "${c.claim_text}": ` +
        `/ledger ${card.offers ? "offers" : "declines"} the commitment and ` +
        `/claim/[id] ${claim.offers ? "offers" : "declines"} it`,
    );
    assert.equal(
      card.reason,
      claim.reason,
      `the two screens decline "${c.claim_text}" for differently worded reasons`,
    );
  }
});

test("both screens agree with the rule the adopt route writes by", async () => {
  const ledger = await ledgerOffer();
  for (const c of CALLS) {
    const row = callRow(c);
    // THE predicate, called the way /api/radar/claims/adopt calls it, against
    // the window a commit on this call would actually open.
    const routeWouldGrade = isAdoptGradeable(row, TODAY, commitWindowEnd(row, TODAY));
    assert.equal(routeWouldGrade, c.expectOffer, `fixture drift on "${c.claim_text}"`);
    assert.equal(
      ledger.get(c.id)?.offers,
      routeWouldGrade,
      `/ledger offers "${c.claim_text}" but the adopt route would write gradeable ${routeWouldGrade}`,
    );
    assert.equal(
      (await claimOffer(c.id)).offers,
      routeWouldGrade,
      `/claim/[id] offers "${c.claim_text}" but the adopt route would write gradeable ${routeWouldGrade}`,
    );
  }
});

test("the desk's own window never decides the reader's commitment", async () => {
  const ledger = await ledgerOffer();
  // A live call, a desk-graded one, one whose resolve_on has passed, and one
  // with no resolve_on. Identical in every field the commit rule reads.
  for (const n of [1, 2, 3, 4]) {
    const callId = id(n);
    assert.equal(ledger.get(callId)?.offers, true, `/ledger declined call ${n}`);
    const claim = await claimOffer(callId);
    assert.equal(claim.offers, true, `/claim/[id] declined call ${n}`);
    assert.equal(claim.reason, null, `/claim/[id] gave a reason for a legal commitment on call ${n}`);
  }
});

test("a reader changing the horizon cannot flip the answer", () => {
  // commitLegality is only stable enough for a screen to print because every
  // window a commit can open lands inside isAdoptGradeable's accepted range.
  // If a bucket ever leaves that range, the screens start promising a
  // commitment the route refuses, and this catches it before a reader does.
  const row = callRow(CALLS[0]);
  for (const h of HORIZON_TYPES) {
    const end = addCalendarDays(TODAY, HORIZON_DAYS[h]);
    assert.equal(
      isAdoptGradeable(row, TODAY, end),
      true,
      `horizon ${h} would be refused by the adopt route`,
    );
  }
});
