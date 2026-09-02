// Ownership and TTL gate for GET /api/export/company-pdf
// (src/lib/company-export.ts, wrapped by
//  src/app/api/export/company-pdf/route.ts).
//
// The defect: the route authenticated the caller, then built a SECOND
// unauthenticated client from the anon key and read the cache with it, keyed
// on nothing but the query parameter:
//
//   const anonSupabase = getAnonSupabase();
//   anonSupabase.from("watchlist_briefs").select(...).eq("identifier", identifier)
//
// Only the `entry` read was user-scoped. Any signed-in caller could name any
// identifier and receive the brief and top-15 articles behind another user's
// watchlist row. It also selected generated_at and ignored it, exporting
// briefs of any age while the watchlist page refused to render them past 12h.
//
// There is no non-prod database, so the gate is exercised against a fake
// PostgREST client that records every table it is asked for. That record is
// what proves the gate runs BEFORE the cache reads rather than filtering
// after them.
//
// Run: npx tsx --test tests/unit/company-export-ownership.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadCompanyExport,
  ownsIdentifier,
  type ExportClient,
} from "../../src/lib/company-export.ts";
import { WATCHLIST_BRIEF_TTL_MS, isBriefFresh } from "../../src/lib/watchlist-brief-ttl.ts";

const FRESH = new Date(Date.now() - 60_000).toISOString();
const STALE = new Date(Date.now() - WATCHLIST_BRIEF_TTL_MS - 60_000).toISOString();

type Fixture = {
  /** Row the watchlist lookup resolves to, or null for "not on your list". */
  entry: { identifier: string; type: string; display_name: string | null } | null;
  articles?: unknown[];
  brief?: { brief_text: string; generated_at: string } | null;
};

/** Fake PostgREST client. Records the tables touched and the filters applied. */
function fakeClient(fx: Fixture) {
  const touched: string[] = [];
  const filters: Record<string, unknown>[] = [];

  const client: ExportClient = {
    from(table: string) {
      touched.push(table);
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push({ table, op: "eq", col, val });
          return q;
        },
        ilike: (col: string, val: string) => {
          filters.push({ table, op: "ilike", col, val });
          return q;
        },
        order: () => q,
        limit: async () => ({ data: fx.articles ?? [] }),
        maybeSingle: async () => ({
          data: table === "watchlist" ? fx.entry : (fx.brief ?? null),
        }),
      };
      return q as unknown as ReturnType<ExportClient["from"]>;
    },
  };

  return { client, touched, filters };
}

test("DENIES an identifier that is not on the caller's watchlist", async () => {
  const { client, touched } = fakeClient({ entry: null });
  const out = await loadCompanyExport(client, "user-1", "NVDA");

  assert.deepEqual(out, { entry: null, articles: [], brief: null });
  // The load-bearing assertion: the cache was never read. A gate that filtered
  // after the fact would still have hit these tables.
  assert.deepEqual(touched, ["watchlist"]);
  assert.equal(touched.includes("watchlist_briefs"), false);
  assert.equal(touched.includes("watchlist_articles"), false);
});

test("ALLOWS an identifier the caller watches, and scopes the lookup to them", async () => {
  const { client, touched, filters } = fakeClient({
    entry: { identifier: "NVDA", type: "ticker", display_name: "Nvidia" },
    articles: [{ article_id: "a1", title: "Nvidia beats" }],
    brief: { brief_text: "SNAPSHOT", generated_at: FRESH },
  });
  const out = await loadCompanyExport(client, "user-1", "NVDA");

  assert.equal(out.entry?.identifier, "NVDA");
  assert.equal(out.articles.length, 1);
  assert.equal(out.brief?.brief_text, "SNAPSHOT");
  assert.deepEqual(touched, ["watchlist", "watchlist_articles", "watchlist_briefs"]);
  // The watchlist lookup is scoped to the caller's user_id.
  assert.ok(
    filters.some(
      (f) => f.table === "watchlist" && f.op === "eq" && f.col === "user_id" && f.val === "user-1",
    ),
    "watchlist lookup must be scoped to user_id",
  );
});

test("a stale brief is not exported, but the articles still are", async () => {
  const { client } = fakeClient({
    entry: { identifier: "NVDA", type: "ticker", display_name: "Nvidia" },
    articles: [{ article_id: "a1", title: "Nvidia beats" }],
    brief: { brief_text: "CONTAMINATED", generated_at: STALE },
  });
  const out = await loadCompanyExport(client, "user-1", "NVDA");

  assert.equal(out.brief, null, "a brief past the TTL must not be exported");
  assert.equal(out.articles.length, 1);
  assert.equal(out.entry?.identifier, "NVDA");
});

test("an ILIKE wildcard cannot pass the gate for an identifier not named", async () => {
  // "%" matches any of the caller's own rows. The row that comes back is
  // genuinely theirs, so a naive "did we get a row" check would allow it and
  // then read the cache for whatever it matched.
  const { client, touched } = fakeClient({
    entry: { identifier: "TSLA", type: "ticker", display_name: "Tesla" },
    brief: { brief_text: "TSLA brief", generated_at: FRESH },
  });
  const out = await loadCompanyExport(client, "user-1", "%");

  assert.deepEqual(out, { entry: null, articles: [], brief: null });
  assert.deepEqual(touched, ["watchlist"]);
});

test("case-insensitive match is allowed and reads under the STORED identifier", async () => {
  const { client, filters } = fakeClient({
    entry: { identifier: "NVDA", type: "ticker", display_name: "Nvidia" },
    articles: [],
    brief: { brief_text: "SNAPSHOT", generated_at: FRESH },
  });
  const out = await loadCompanyExport(client, "user-1", "nvda");

  assert.equal(out.entry?.identifier, "NVDA");
  // The cache must be keyed on the stored spelling, not the caller's, or a
  // case variant silently misses the rows the entry points at.
  for (const table of ["watchlist_articles", "watchlist_briefs"]) {
    assert.ok(
      filters.some(
        (f) => f.table === table && f.op === "eq" && f.col === "identifier" && f.val === "NVDA",
      ),
      `${table} must be read under the stored identifier`,
    );
  }
});

test("ownsIdentifier rejects null, non-string and mismatched rows", () => {
  assert.equal(ownsIdentifier(null, "NVDA"), false);
  assert.equal(ownsIdentifier(undefined, "NVDA"), false);
  assert.equal(ownsIdentifier({}, "NVDA"), false);
  assert.equal(ownsIdentifier({ identifier: 42 }, "NVDA"), false);
  assert.equal(ownsIdentifier({ identifier: "TSLA" }, "NVDA"), false);
  assert.equal(ownsIdentifier({ identifier: "NVDA" }, "NVDA"), true);
  assert.equal(ownsIdentifier({ identifier: "nvda" }, "NVDA"), true);
});

test("isBriefFresh is null-safe and honours the shared window", () => {
  assert.equal(isBriefFresh(null), false);
  assert.equal(isBriefFresh(undefined), false);
  assert.equal(isBriefFresh("not a date"), false);
  assert.equal(isBriefFresh(FRESH), true);
  assert.equal(isBriefFresh(STALE), false);
  // Exactly at the boundary is stale, not fresh.
  const now = Date.now();
  const exactly = new Date(now - WATCHLIST_BRIEF_TTL_MS).toISOString();
  assert.equal(isBriefFresh(exactly, now), false);
});
