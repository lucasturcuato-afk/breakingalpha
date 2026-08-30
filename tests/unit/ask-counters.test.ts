// Unit tests for the three destination counts (src/lib/ask-counters.ts).
//
// WHY THESE AND NOT AN E2E SPEC. `/ask` is a server component: the three counts
// go from the Next server to Postgres and never through the browser, so
// `page.route()` cannot reach them and Playwright cannot force one to fault.
// This hands the loader a client that answers per table, including on command
// with an error.
//
// THE CONTRACT LOCKED HERE, and the first line is the whole reason the file
// exists:
//
//   a count that FAULTED  -> figure null. The row draws no number and no
//                            window. It is NEVER a zero, because a zero on this
//                            screen is a claim about the corpus and a failed
//                            read is not entitled to make it.
//   a count of ZERO       -> "0". A real answer, drawn as one.
//   one read faulting     -> the other two still carry their figures. Three
//                            independent reads, three independent answers.
//   the window            -> always present in the shape, so the label and the
//                            predicate cannot drift apart.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COUNTER_WINDOWS,
  groupCount,
  loadAskCounters,
  utcDayFloor,
  weekFloor,
} from "../../src/lib/ask-counters.ts";

type Answer = { count: number | null; error: { message: string } | null };

/**
 * A Supabase client that answers per table. Every chained filter returns the
 * chain, and awaiting it resolves as PostgREST would for a head request.
 */
function clientFor(answers: Record<string, Answer>): SupabaseClient {
  return {
    from(table: string) {
      const answer = answers[table] ?? { count: null, error: { message: `no stub for ${table}` } };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "gte", "lte", "not", "order", "limit"]) {
        chain[method] = () => chain;
      }
      chain.then = (ok: (v: Answer) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve(answer).then(ok, fail);
      return chain;
    },
  } as unknown as SupabaseClient;
}

const OK = {
  deal_flow: { count: 1156, error: null },
  trend_clusters: { count: 28, error: null },
  articles: { count: 912, error: null },
};

/* ── the tri-state ───────────────────────────────────────────────────── */

test("three counts that answered give three figures, grouped", async () => {
  const c = await loadAskCounters(clientFor(OK));
  assert.equal(c.deals.figure, "1,156");
  assert.equal(c.trends.figure, "28");
  assert.equal(c.feed.figure, "912");
});

test("a faulted count gives a null figure, never a zero", async () => {
  const c = await loadAskCounters(
    clientFor({ ...OK, articles: { count: null, error: { message: "57014 statement timeout" } } }),
  );
  assert.equal(c.feed.figure, null);
  // And the other two are untouched. Three reads, three answers.
  assert.equal(c.deals.figure, "1,156");
  assert.equal(c.trends.figure, "28");
});

test("a count of zero is a real answer and is drawn as one", async () => {
  /* This is not hypothetical. Live Feed's window resets at UTC midnight and the
     ingest pass runs after it, so this row legitimately reads 0 for several
     hours every day. Measured against production on 2026-08-30 at 04:48 UTC:
     0 since 00:00 UTC, with the newest ingested_at at 2026-08-29T02:08 UTC. */
  const c = await loadAskCounters(clientFor({ ...OK, articles: { count: 0, error: null } }));
  assert.equal(c.feed.figure, "0");
  assert.notEqual(c.feed.figure, null);
});

test("a head request that answered with no count at all is not a zero either", async () => {
  const c = await loadAskCounters(clientFor({ ...OK, deal_flow: { count: null, error: null } }));
  assert.equal(c.deals.figure, null);
});

/* ── the window ──────────────────────────────────────────────────────── */

test("every row carries its window, faulted or not", async () => {
  const c = await loadAskCounters(
    clientFor({ ...OK, trend_clusters: { count: null, error: { message: "down" } } }),
  );
  assert.equal(c.deals.window, COUNTER_WINDOWS.deals);
  assert.equal(c.trends.window, COUNTER_WINDOWS.trends);
  assert.equal(c.feed.window, COUNTER_WINDOWS.feed);
});

test("the windows say what the predicates do", () => {
  /* A window label that disagreed with its query is the defect this pair of
     constants exists to make visible. "all time" takes no floor; the other two
     name theirs. */
  assert.equal(COUNTER_WINDOWS.deals, "all time");
  assert.equal(COUNTER_WINDOWS.trends, "new this week");
  assert.equal(COUNTER_WINDOWS.feed, "since 00:00 UTC");
});

/* ── the two floors ──────────────────────────────────────────────────── */

test("the day floor is UTC midnight of the anchor's own day", () => {
  const anchor = Date.parse("2026-08-30T04:48:00.000Z");
  assert.equal(utcDayFloor(anchor), "2026-08-30T00:00:00.000Z");
});

test("the week floor is seven days back, matching trendCounts's own window", () => {
  const anchor = Date.parse("2026-08-30T04:48:00.000Z");
  assert.equal(weekFloor(anchor), "2026-08-23T04:48:00.000Z");
});

/* ── grouping ────────────────────────────────────────────────────────── */

test("counts are grouped in en-US regardless of the host locale", () => {
  /* Fixed rather than inherited: the string is built on the server and shipped
     in the payload, so a host that grouped differently would put one separator
     in the HTML and another in the hydration pass. */
  assert.equal(groupCount(1156), "1,156");
  assert.equal(groupCount(0), "0");
  assert.equal(groupCount(912), "912");
});
