// Unit tests for where a Watch watchlist card goes (src/components/watch/links.ts).
//
// WHY A UNIT TEST AND NOT A BROWSER SPEC. `/watch` is a server component, so
// its watchlist read runs between the Next server and Postgres and
// `page.route()` cannot reach it. A spec cannot put a private company or an
// industry on the screen on demand, and those two are the cases that matter:
// a card with nowhere to go must NOT become a link.
//
// THE CONTRACT LOCKED HERE:
//
//   a `ticker` row    -> /company/<TICKER>, the raw symbol, no slugification
//   a `company` row   -> NO href. The identifier is a name, not a symbol, and
//                        the route resolves a slug to a company by exact name
//                        match, so linking one sends an unknown share of
//                        entries to a miss state
//   a `sector` row    -> NO href. `/signal` does not exist
//
// The rows go through `loadWatch` rather than being hand-written as
// `WatchlistItem`s on purpose: the thing under test is that the value the
// LOADER puts in `identifier` for a real `watchlist` row is the value the
// route takes. A hand-written item would prove the mapping against itself.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWatch } from "../../src/lib/watch-data.ts";
import { watchlistHref } from "../../src/components/watch/links.ts";

/* ── the same fake client shape watch-loader-tristate.test.ts uses ───── */

interface Result {
  data: unknown;
  error: { message: string } | null;
}

interface Ops {
  table: string;
  eq: Record<string, unknown>;
  or: string | null;
}

function builder(table: string, resolve: (ops: Ops) => Result) {
  const ops: Ops = { table, eq: {}, or: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "gte", "contains", "in", "abortSignal"]) {
    chain[method] = () => chain;
  }
  chain.eq = (column: string, value: unknown) => {
    ops.eq[column] = value;
    return chain;
  };
  chain.or = (filter: string) => {
    ops.or = filter;
    return chain;
  };
  chain.then = (okFn: (v: Result) => unknown, failFn?: (e: unknown) => unknown) =>
    Promise.resolve(resolve(ops)).then(okFn, failFn);
  return chain;
}

function clientFor(resolve: (ops: Ops) => Result): SupabaseClient {
  return {
    from: (table: string) => builder(table, resolve),
    rpc: () => Promise.resolve({ data: null, error: { message: "no rpc in this test" } }),
  } as unknown as SupabaseClient;
}

const ok = (data: unknown): Result => ({ data, error: null });

/** Published `hours` ago, so the one-day window in recency.ts decides it. */
function agoHours(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

/** One of each stored `type`, which is one of each drawn kind. */
const ENTRIES = [
  { id: "r1", identifier: "CEG", type: "ticker", display_name: "Constellation Energy", created_at: null },
  { id: "r2", identifier: "Anthropic", type: "company", display_name: "Anthropic", created_at: null },
  { id: "r3", identifier: "Technology", type: "sector", display_name: null, created_at: null },
];

/** Every entry loud, so all three reach `data.watchlist` as cards. */
function world(): (ops: Ops) => Result {
  return (ops) => {
    if (ops.table === "watchlist") return ok(ENTRIES);
    if (ops.table === "follows") return ok([]);
    if (ops.table === "watchlist_articles") {
      return ok([
        {
          title: `A story about ${String(ops.eq.identifier)}`,
          source: "Reuters",
          published_at: agoHours(3),
          relevance_score: 9,
          fetched_at: agoHours(2),
        },
      ]);
    }
    if (ops.table === "articles") {
      return ok([
        {
          title: "Contracting accelerates across four utilities",
          source: "Reuters",
          published_at: agoHours(4),
          relevance_score: 7,
        },
      ]);
    }
    throw new Error(`unexpected table ${ops.table}`);
  };
}

async function cards() {
  const { data } = await loadWatch(clientFor(world()), "u1");
  assert.ok(data, "the loader gave back no data");
  return data.watchlist;
}

/* ── the one kind that has a destination ─────────────────────────────── */

test("a ticker row links to /company/<TICKER>, with the raw symbol as the slug", async () => {
  const items = await cards();
  const ticker = items.find((i) => i.kind === "public");
  assert.ok(ticker, "no public card was drawn");
  assert.equal(watchlistHref(ticker), "/company/CEG");
});

test("the slug is the stored identifier and nothing derived from the display name", async () => {
  // `/company/[id]` turns "constellation-energy" into a name lookup and "CEG"
  // into a ticker lookup, and only the second one is the row's own value. A
  // mapping that reached for `qualifier` would pass a display string.
  const items = await cards();
  const ticker = items.find((i) => i.kind === "public");
  assert.ok(ticker);
  assert.equal(watchlistHref(ticker), `/company/${ticker.identifier}`);
});

test("a lower-cased or padded symbol still resolves to one written form", () => {
  assert.equal(watchlistHref({ kind: "public", identifier: " ceg " }), "/company/CEG");
});

test("a public entry with no symbol left after trimming gets no link", () => {
  // Absence of a destination, not a link to `/company/`.
  assert.equal(watchlistHref({ kind: "public", identifier: "   " }), null);
});

/* ── the two kinds that do not, which is what this file is for ───────── */

test("a private company row gets NO href, not a link into a miss state", async () => {
  const items = await cards();
  const priv = items.find((i) => i.kind === "private");
  assert.ok(priv, "no private card was drawn");
  assert.equal(watchlistHref(priv), null);
});

test("an industry row gets NO href, because /signal does not exist", async () => {
  const items = await cards();
  const industry = items.find((i) => i.kind === "industry");
  assert.ok(industry, "no industry card was drawn");
  assert.equal(watchlistHref(industry), null);
});

test("exactly one of the three drawn kinds carries a destination", async () => {
  // The count is asserted rather than the three cases alone, so a fourth kind
  // quietly gaining a link is a failure here rather than a finding later.
  const items = await cards();
  assert.equal(items.length, 3);
  const linked = items.filter((i) => watchlistHref(i) !== null);
  assert.deepEqual(
    linked.map((i) => i.kind),
    ["public"],
  );
});

test("no href this mapping produces is a bare /company/ or a double slash", async () => {
  const items = await cards();
  for (const item of items) {
    const href = watchlistHref(item);
    if (href === null) continue;
    assert.match(href, /^\/company\/[^/]+$/, `${item.kind} produced a malformed href: ${href}`);
  }
});
