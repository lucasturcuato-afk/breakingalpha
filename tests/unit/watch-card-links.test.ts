// Unit tests for where a Radar watchlist card goes.
//
// `src/lib/watch-links.ts` decides it, `src/lib/watch-data.ts` proves it
// against `companies` and puts it on `WatchlistItem.href`.
//
// WHY A UNIT TEST AND NOT A BROWSER SPEC. `/watch` is a server component, so
// its reads run between the Next server and Postgres and `page.route()` cannot
// reach them. A spec cannot put a private company, an industry, or a ticker
// the corpus does not carry on the screen on demand, and those are the cases
// that matter, because the assertions that matter here are negative ones.
//
// THE CONTRACT LOCKED HERE:
//
//   a `ticker` row whose ticker is in `companies`
//                       -> /company/<IDENTIFIER>, via the resolver's ticker
//                          branch
//   a `ticker` row whose slug is rewritten by CANONICAL (INTC -> Intel)
//                       -> still linked, via the resolver's NAME branch. A
//                          ticker-only check would drop twenty-odd names
//   BRK.B               -> NO href. `TICKER_RE` rejects the dot, the slug falls
//                          through to a name match that misses, and the reader
//                          would be told a company with 540 corpus mentions is
//                          not on Signalera. This is the live defect the proof
//                          exists for
//   a `ticker` row the corpus does not carry
//                       -> NO href
//   a `company` row     -> NO href. A product choice, not a resolution figure;
//                          the reasoning is in watch-links.ts
//   a `sector` row      -> NO href. `/signal` does not exist
//   the proof read failing
//                       -> NO href anywhere, never a link built on a query that
//                          did not answer
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWatch } from "../../src/lib/watch-data.ts";
import { linkLookups } from "../../src/lib/watch-links.ts";

/* ── the same fake client shape watch-loader-tristate.test.ts uses ───── */

interface Result {
  data: unknown;
  error: { message: string } | null;
}

interface Ops {
  table: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  or: string | null;
}

function builder(table: string, resolve: (ops: Ops) => Result) {
  const ops: Ops = { table, eq: {}, in: {}, or: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "gte", "contains", "abortSignal"]) {
    chain[method] = () => chain;
  }
  chain.eq = (column: string, value: unknown) => {
    ops.eq[column] = value;
    return chain;
  };
  chain.in = (column: string, values: unknown[]) => {
    ops.in[column] = values;
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
const boom = (message: string): Result => ({ data: null, error: { message } });

/** Published `hours` ago, so the one-day window in recency.ts decides it. */
function agoHours(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

/**
 * The rows. One of each stored `type`, plus the two public cases that decide
 * whether the proof is doing anything: a dotted symbol the resolver's regex
 * rejects, and a symbol the corpus does not carry.
 */
const ENTRIES = [
  { id: "r1", identifier: "CEG", type: "ticker", display_name: "Constellation Energy", created_at: null },
  { id: "r2", identifier: "INTC", type: "ticker", display_name: "Intel", created_at: null },
  { id: "r3", identifier: "BRK.B", type: "ticker", display_name: "Berkshire Hathaway", created_at: null },
  { id: "r4", identifier: "ZZZZ", type: "ticker", display_name: "Not In The Corpus", created_at: null },
  { id: "r5", identifier: "Anthropic", type: "company", display_name: "Anthropic", created_at: null },
  { id: "r6", identifier: "Technology", type: "sector", display_name: null, created_at: null },
];

/**
 * The corpus. `companies` answers the two filters the proof applies, a ticker
 * set and a name set.
 *
 * CEG is reachable by ticker. Intel is reachable only by NAME, because
 * `CANONICAL` rewrites the slug "INTC" to "Intel" before the resolver ever sees
 * it and no row carries a ticker "INTEL". Berkshire Hathaway is in the corpus
 * under a name the slug "BRK.B" cannot reconstruct, which is the live defect.
 * ZZZZ is in neither set.
 */
const CORPUS_TICKERS = ["CEG"];
const CORPUS_NAMES = ["Constellation Energy", "Intel", "Berkshire Hathaway"];

function world(overrides: Partial<Record<string, Result>> = {}): (ops: Ops) => Result {
  return (ops) => {
    if (ops.table === "watchlist") return overrides.watchlist ?? ok(ENTRIES);
    if (ops.table === "follows") return ok([]);

    if (ops.table === "companies") {
      if (overrides.companies) return overrides.companies;
      if (ops.in.ticker) {
        const asked = new Set((ops.in.ticker as string[]).map((t) => t.toUpperCase()));
        return ok(CORPUS_TICKERS.filter((t) => asked.has(t)).map((ticker) => ({ ticker })));
      }
      if (ops.in.name) {
        const asked = new Set(ops.in.name as string[]);
        return ok(CORPUS_NAMES.filter((n) => asked.has(n)).map((name) => ({ name })));
      }
      return ok([]);
    }

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

async function cards(overrides: Partial<Record<string, Result>> = {}) {
  const { data } = await loadWatch(clientFor(world(overrides)), "u1");
  assert.ok(data, "the loader gave back no data");
  return data.watchlist;
}

function byIdentifier(
  items: Awaited<ReturnType<typeof cards>>,
  identifier: string,
) {
  const found = items.find((i) => i.identifier === identifier);
  assert.ok(found, `no card was drawn for ${identifier}`);
  return found;
}

/* ── the destinations that exist ─────────────────────────────────────── */

test("a ticker in the corpus links to /company/<IDENTIFIER>", async () => {
  const items = await cards();
  assert.equal(byIdentifier(items, "CEG").href, "/company/CEG");
});

test("a ticker CANONICAL rewrites is still linked, through the name branch", async () => {
  // `/company/INTC` reaches resolveAlias as "Intel", fails a ticker lookup for
  // a ticker that does not exist, and lands on the name match. A check that
  // only tried the ticker branch would omit this and twenty more like it.
  const lookups = linkLookups("INTC");
  assert.ok(lookups);
  assert.equal(lookups.name, "Intel");
  assert.notEqual(lookups.ticker, "INTC");

  const items = await cards();
  assert.equal(byIdentifier(items, "INTC").href, "/company/INTC");
});

/* ── the destinations that do not, which is what this file is for ────── */

test("BRK.B gets NO href, because the route cannot see it", async () => {
  // The regression this proof exists for. Berkshire Hathaway is in the corpus
  // and /company/BRK.B still answers "isn't on Signalera yet", because
  // TICKER_RE rejects the dot and the name reconstruction misses.
  const lookups = linkLookups("BRK.B");
  assert.ok(lookups);
  assert.equal(lookups.ticker, null, "BRK.B must not pass the ticker gate");
  assert.notEqual(lookups.name.toLowerCase(), "berkshire hathaway");

  const items = await cards();
  assert.equal(byIdentifier(items, "BRK.B").href, null);
});

test("a ticker the corpus does not carry gets NO href", async () => {
  const items = await cards();
  assert.equal(byIdentifier(items, "ZZZZ").href, null);
});

test("a private company row gets NO href", async () => {
  const items = await cards();
  assert.equal(byIdentifier(items, "Anthropic").href, null);
});

test("an industry row gets NO href, because /signal does not exist", async () => {
  const items = await cards();
  assert.equal(byIdentifier(items, "Technology").href, null);
});

test("a private identifier that WOULD resolve is still not linked", async () => {
  // The product choice stated in watch-links.ts, asserted so a kind check
  // moving cannot quietly reverse it. "Anthropic" is in the name set this
  // world answers with, and the card still carries no href.
  const items = await cards({
    companies: ok([{ name: "Anthropic" }, { name: "Intel" }, { name: "Constellation Energy" }]),
  });
  assert.equal(byIdentifier(items, "Anthropic").href, null);
});

/* ── the read behind the proof ───────────────────────────────────────── */

test("a failed proof read links nothing, rather than linking everything", async () => {
  const items = await cards({ companies: boom("57014 statement timeout") });
  for (const item of items) {
    assert.equal(item.href, null, `${item.identifier} was linked on a read that failed`);
  }
});

test("the proof read never omits a card, it only unlinks one", async () => {
  // A read that answered nothing must not shorten the watchlist. The tier is
  // built from the article reads; the proof only ever decides an href.
  const withProof = await cards();
  const withoutProof = await cards({ companies: boom("57014 statement timeout") });
  assert.equal(withProof.length, withoutProof.length);
  assert.deepEqual(
    withProof.map((i) => i.identifier),
    withoutProof.map((i) => i.identifier),
  );
});

test("exactly the proved public names carry a destination", async () => {
  // Asserted as a set rather than case by case, so a fourth kind or a widened
  // gate quietly gaining a link fails here rather than surfacing as a finding.
  const items = await cards();
  assert.equal(items.length, 6);
  assert.deepEqual(
    items.filter((i) => i.href !== null).map((i) => i.identifier),
    ["CEG", "INTC"],
  );
});

test("no href this mapping produces is a bare /company/ or a double slash", async () => {
  const items = await cards();
  for (const item of items) {
    if (item.href === null) continue;
    assert.match(item.href, /^\/company\/[^/]+$/, `malformed href: ${item.href}`);
  }
});
