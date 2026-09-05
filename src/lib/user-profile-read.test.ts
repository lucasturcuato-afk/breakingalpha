import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readUserProfile,
  getUserProfile,
  updateInferredWeights,
  DEFAULT_PROFILE,
} from "./user-profile";

/**
 * THE SPLIT, ASSERTED RATHER THAN DESCRIBED.
 *
 * Both tiers are exercised against the SAME simulated failure, because the
 * whole claim of this unit is that the two answer it differently: the
 * indifferent caller still gets a default profile and its diff is zero lines,
 * and the caller that seeds a Save form gets a `failed` it cannot ignore.
 */

type Res = { data: unknown; error: unknown; count: null; status: number; statusText: string };

function res(data: unknown, error: unknown = null): Res {
  return { data, error, count: null, status: error ? 400 : 200, statusText: "" };
}

function pgError(code: string, message: string) {
  return Object.assign(new Error(message), { name: "PostgrestError", message, details: "", hint: "", code });
}

/* A client stub thin enough to be obviously honest: `from(table)` yields a
   builder whose every filter answers itself, and the awaited value is whatever
   the table was seeded with. No behaviour is simulated beyond the response. */
function stubClient(byTable: Record<string, Res>): SupabaseClient {
  const builder = (table: string) => {
    const answer = byTable[table] ?? res(null, pgError("42P01", `relation "${table}" does not exist`));
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "update", "order", "limit"]) {
      self[m] = () => self;
    }
    self.maybeSingle = () => Promise.resolve(answer);
    self.single = () => Promise.resolve(answer);
    self.then = (onOk: (v: Res) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(answer).then(onOk, onErr);
    return self;
  };
  return { from: builder } as unknown as SupabaseClient;
}

/* ── Defect 1: the read error that reached a Save form as stored values ── */

test("readUserProfile reports a failed read instead of defaulting", () => {
  const supabase = stubClient({ user_profiles: res(null, pgError("42501", "permission denied")) });
  return readUserProfile(supabase, "u1").then((read) => {
    assert.equal(read.state, "failed");
    if (read.state !== "failed") throw new Error("unreachable");
    assert.equal(read.code, "42501");
  });
});

test("readUserProfile separates an absent row from a failed read", () => {
  // A reader with no row yet is a different answer, and it must stay one: a
  // new reader is meant to get an empty form to fill in.
  const supabase = stubClient({ user_profiles: res(null) });
  return readUserProfile(supabase, "u1").then((read) => {
    assert.equal(read.state, "missing");
  });
});

test("readUserProfile normalizes a row that predates the newer columns", () => {
  const supabase = stubClient({
    user_profiles: res({ id: "u1", first_name: "Maya", sectors: null, watchlist_tickers: "not an array" }),
  });
  return readUserProfile(supabase, "u1").then((read) => {
    assert.equal(read.state, "ok");
    if (read.state !== "ok") throw new Error("unreachable");
    assert.equal(read.row.first_name, "Maya");
    assert.deepEqual(read.row.sectors, []);
    assert.deepEqual(read.row.watchlist_tickers, []);
    assert.equal(read.row.risk_appetite, "balanced");
  });
});

test("getUserProfile keeps its old soft-fail on the SAME failure, unchanged", () => {
  /* This is the half of the split that must not move. The four call sites for
     which a default is the right answer, /api/intelligence, /api/theses,
     /api/profile/insights and /settings/learned, keep calling this and keep
     getting exactly what they got before. Their diff is zero lines. */
  const supabase = stubClient({ user_profiles: res(null, pgError("42501", "permission denied")) });
  return getUserProfile(supabase, "u1").then((profile) => {
    assert.deepEqual(profile, DEFAULT_PROFILE("u1"));
  });
});

/* ── Defect 2: the read error that RESOLVED, so no rejection handler ran ── */

test("updateInferredWeights marks a failed user_events read as failed", () => {
  const supabase = stubClient({ user_events: res(null, pgError("42P01", "relation does not exist")) });
  return updateInferredWeights(supabase, "u1").then((r) => {
    assert.equal(r.failed, true, "a failed read must not resolve as a clean zero");
    assert.equal(r.eventCount, 0);
    assert.equal(r.updatedAt, null);
  });
});

test("updateInferredWeights leaves failed false when zero events is the real answer", () => {
  /* The distinction the screen turns on. Both cases carry eventCount 0, and
     only `failed` tells "Not enough data yet" apart from "the read did not
     happen". Asserting eventCount alone would pass on the defect. */
  const supabase = stubClient({ user_events: res([]), user_profiles: res(null) });
  return updateInferredWeights(supabase, "u1").then((r) => {
    assert.equal(r.failed, false);
    assert.equal(r.eventCount, 0);
    assert.deepEqual(r.weights, {});
  });
});

test("updateInferredWeights still derives weights from real events", () => {
  const supabase = stubClient({
    user_events: res([
      { event_type: "thesis_viewed", payload: { sector: "Technology" }, created_at: "2026-01-01" },
      { event_type: "thesis_viewed", payload: { sector: "Technology" }, created_at: "2026-01-02" },
      { event_type: "thesis_dismissed", payload: { sector: "Real Estate" }, created_at: "2026-01-03" },
      { event_type: "thesis_viewed", payload: {}, created_at: "2026-01-04" },
    ]),
    user_profiles: res(null),
  });
  return updateInferredWeights(supabase, "u1").then((r) => {
    assert.equal(r.failed, false);
    assert.equal(r.eventCount, 4);
    assert.equal(r.weights.Technology, 1.1);
    assert.equal(r.weights["Real Estate"], 0.9);
    assert.equal("undefined" in r.weights, false);
  });
});
