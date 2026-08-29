// Unit tests for the Watch loader's read discipline (src/lib/watch-data.ts).
//
// WHY THESE AND NOT AN E2E SPEC. `/watch` is a server component: its reads go
// from the Next server to Postgres, never through the browser, so
// `page.route()` cannot reach them and Playwright cannot force a per-entry
// fault. The browser spec beside this one proves what the reader SEES; this
// proves what the loader DECIDES, by handing it a client whose queries fail on
// command.
//
// THE CONTRACT LOCKED HERE, and it is the one the unit exists for:
//
//   a per-entry article read that FAULTED  -> named in watchlistCouldNotRead,
//                                             absent from watchlist AND from
//                                             quietNames
//   a per-entry read that answered EMPTY   -> a quiet name, which is a real
//                                             answer
//   the watchlist ROW read failing         -> watchlistRead "failed", and NO
//                                             quiet names at all, because
//                                             nothing was read to be quiet
//   a follow whose match THREW             -> followsCouldNotCheck, never
//                                             followsQuiet
//   a MUTED follow                         -> followsMuted, and neither quiet
//                                             nor covered. The desktop folds
//                                             these into quiet
//                                             (radar/following/page.tsx:196).
//
// Getting the first one wrong makes quietNames a false claim about the
// reader's own list, in prose, which is worse than the false zero fixed in PR #698.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWatch } from "../../src/lib/watch-data.ts";

/* ── a Supabase client that fails where it is told to ────────────────── */

interface Result {
  data: unknown;
  error: { message: string } | null;
}

/** Everything a query recorded before it was awaited. */
interface Ops {
  table: string;
  eq: Record<string, unknown>;
  or: string | null;
}

type Resolver = (ops: Ops) => Result;

function builder(table: string, resolve: Resolver) {
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
  // Thenable, so `await query` runs the resolver exactly as PostgREST would.
  chain.then = (ok: (v: Result) => unknown, fail?: (e: unknown) => unknown) =>
    Promise.resolve(resolve(ops)).then(ok, fail);
  return chain;
}

function clientFor(resolve: Resolver): SupabaseClient {
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

const ENTRIES = [
  { id: "r1", identifier: "CEG", type: "ticker", display_name: "Constellation Energy", created_at: null },
  { id: "r2", identifier: "ZION", type: "ticker", display_name: "Zions", created_at: null },
  { id: "r3", identifier: "NVDA", type: "ticker", display_name: "Nvidia", created_at: null },
  { id: "r4", identifier: "Real Estate", type: "sector", display_name: null, created_at: null },
];

/**
 * The default world: CEG loud, ZION quiet, NVDA's read FAULTS, Real Estate
 * loud. One follow covered, one quiet, one muted, one that throws.
 */
function world(overrides: Partial<Record<string, Result>> = {}): Resolver {
  return (ops) => {
    if (ops.table === "watchlist") return overrides.watchlist ?? ok(ENTRIES);
    if (ops.table === "follows") return overrides.follows ?? ok(FOLLOWS);

    if (ops.table === "watchlist_articles") {
      const identifier = String(ops.eq.identifier);
      if (identifier === "NVDA") return boom("57014 statement timeout");
      if (identifier === "ZION") return ok([]);
      return ok([
        {
          title: "Constellation lifts contracted volume guidance",
          source: "Reuters",
          published_at: agoHours(3),
          relevance_score: 9,
          fetched_at: agoHours(2),
        },
        {
          title: "A second, weaker story about the same name",
          source: "Bloomberg",
          published_at: agoHours(5),
          relevance_score: 4,
          fetched_at: agoHours(2),
        },
        {
          title: "Last week's story, outside the window",
          source: "WSJ",
          published_at: agoHours(200),
          relevance_score: 10,
          fetched_at: agoHours(2),
        },
      ]);
    }

    if (ops.table === "articles") {
      // The sector read and the follow matcher both hit `articles`; the filter
      // is what tells them apart. `buildArticleOrFilter` emits a containment
      // filter for a sector and ILIKE conditions for a name.
      if (ops.or?.startsWith("industry_verticals.cs.")) {
        return ok([
          {
            title: "Two REITs refinance into the same window",
            source: "Reuters",
            published_at: agoHours(6),
            relevance_score: 7,
          },
        ]);
      }
      if (ops.or?.includes("Talen")) return boom("57014 statement timeout");
      if (ops.or?.includes("Vistra")) {
        return ok([
          {
            id: "a-vistra",
            title: "Vistra commits Comanche Peak capacity",
            source: "Reuters",
            published_at: agoHours(30),
            summary: null,
            url: null,
            industry_verticals: null,
            activity_types: null,
            primary_company: "Vistra",
          },
        ]);
      }
      return ok([]);
    }

    throw new Error(`unexpected table ${ops.table}`);
  };
}

const FOLLOWS = [
  { id: "f1", follow_type: "company", target: "Vistra", display_name: "Vistra", matched_keywords: ["Vistra"], embedding: null, muted: false, created_at: "2026-01-01" },
  { id: "f2", follow_type: "company", target: "Quiet Co", display_name: "Quiet Co", matched_keywords: ["Quiet Co"], embedding: null, muted: false, created_at: "2026-01-02" },
  { id: "f3", follow_type: "company", target: "Talen", display_name: "Talen", matched_keywords: ["Talen"], embedding: null, muted: false, created_at: "2026-01-03" },
  { id: "f4", follow_type: "company", target: "Muted Co", display_name: "Muted Co", matched_keywords: ["Muted Co"], embedding: null, muted: true, created_at: "2026-01-04" },
];

/* ── the tier 2 tri-state ────────────────────────────────────────────── */

test("a per-entry read that faulted is named, and is never a quiet name", async () => {
  const { data } = await loadWatch(clientFor(world()), "u1");
  assert.ok(data);

  // NVDA's read errored. It is named as unread.
  assert.deepEqual(data.watchlistCouldNotRead, ["Nvidia"]);
  // And it is in neither of the two lists a reader would read as an answer.
  assert.ok(!data.quietNames.includes("Nvidia"));
  assert.ok(!data.watchlist.some((i) => i.identifier === "NVDA"));
});

test("a read that answered empty is a quiet name, which is a real answer", async () => {
  const { data } = await loadWatch(clientFor(world()), "u1");
  assert.ok(data);
  assert.deepEqual(data.quietNames, ["Zions"]);
});

test("an article outside the recency window does not make a name loud", async () => {
  // CEG's third article is 200 hours old and carries the HIGHEST relevance
  // score, so a top-story pick that ran before the window filter would choose
  // it and date the card last week.
  const { data } = await loadWatch(clientFor(world()), "u1");
  const ceg = data?.watchlist.find((i) => i.identifier === "CEG");
  assert.ok(ceg);
  assert.equal(ceg.headline, "Constellation lifts contracted volume guidance");
  // "Reuters · 1 more today": the count is the OTHER articles in the window,
  // never the total, matching WatchlistGallery.tsx:242.
  assert.equal(ceg.source, "Reuters · 1 more today");
});

test("the kind predicate matches the desk's, and industries read the articles table", async () => {
  const { data } = await loadWatch(clientFor(world()), "u1");
  assert.ok(data);
  assert.equal(data.watchlist.find((i) => i.identifier === "CEG")?.kind, "public");
  const re = data.watchlist.find((i) => i.identifier === "Real Estate");
  assert.ok(re, "an industry entry must be readable at all; watchlist_articles never carries one");
  assert.equal(re.kind, "industry");
  assert.equal(re.qualifier, "Industry · 1 today");
});

test("a failed ROW read claims nothing about the reader's names", async () => {
  const { data, stage } = await loadWatch(
    clientFor(world({ watchlist: boom("42501 permission denied") })),
    "u1",
  );
  assert.ok(data);
  assert.equal(stage, "ready");
  assert.equal(data.watchlistRead, "failed");
  // No cards, no quiet names, no unread names. Nothing was read, so there is
  // nothing to say. The screen draws the failure notice off watchlistRead.
  assert.deepEqual(data.watchlist, []);
  assert.deepEqual(data.quietNames, []);
  assert.deepEqual(data.watchlistCouldNotRead, []);
  // The other tier is untouched by it.
  assert.equal(data.followingRead, "ok");
});

/* ── tier 3: quiet, muted and failed are three states ────────────────── */

test("a follow whose match threw is never counted quiet", async () => {
  const { data } = await loadWatch(clientFor(world()), "u1");
  assert.ok(data);
  assert.deepEqual(data.followsCouldNotCheck, ["Talen"]);
  assert.equal(data.followsQuiet, 1); // Quiet Co only.
  assert.equal(data.followsWithCoverage, 1); // Vistra only.
});

test("muted is split out of quiet rather than folded in", async () => {
  const { data } = await loadWatch(clientFor(world()), "u1");
  assert.ok(data);
  assert.equal(data.followsMuted, 1);
  // The desktop's `quiet` predicate is `!d.failed && (d.follow.muted ||
  // d.articles.length === 0)`, which would say 2 here. A muted follow was
  // never matched, so it has no coverage answer to report.
  assert.notEqual(data.followsQuiet, 2);
});

test("follow rows ship under one unlabelled cluster", async () => {
  const { data } = await loadWatch(clientFor(world()), "u1");
  assert.ok(data);
  assert.equal(data.following.length, 1);
  assert.equal(data.following[0].label, null);
  assert.deepEqual(
    data.following[0].rows.map((r) => r.headline),
    ["Vistra commits Comanche Peak capacity"],
  );
  assert.match(data.following[0].rows[0].meta, /^REUTERS · [A-Z]{3} \d+$/);
});

test("a failed follows read is not an empty follow list", async () => {
  const { data } = await loadWatch(
    clientFor(world({ follows: boom("42P01 relation does not exist") })),
    "u1",
  );
  assert.ok(data);
  assert.equal(data.followingRead, "failed");
  assert.deepEqual(data.following, []);
  assert.equal(data.followsQuiet, 0);
  assert.equal(data.watchlistRead, "ok");
});

/* ── no reader ───────────────────────────────────────────────────────── */

test("no reader is null data, not an empty screen", async () => {
  const { data, stage } = await loadWatch(clientFor(world()), null);
  assert.equal(data, null);
  assert.equal(stage, "error");
});

/* ── nothing invented ────────────────────────────────────────────────── */

test("every figure is a count of rows, and no tracked-views field exists", async () => {
  const { data } = await loadWatch(clientFor(world()), "u1");
  assert.ok(data);
  // The tier is omitted, not emptied: there is no field to fill in later
  // without also deciding where `headline` comes from.
  assert.ok(!("trackedViews" in data));
  // followsWithCoverage + followsQuiet + followsMuted + couldNotCheck accounts
  // for every follow row exactly once.
  assert.equal(
    data.followsWithCoverage +
      data.followsQuiet +
      data.followsMuted +
      data.followsCouldNotCheck.length,
    FOLLOWS.length,
  );
});
