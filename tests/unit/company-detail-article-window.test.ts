import { test } from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyDetail } from "../../src/lib/data-access/getCompanyDetail.ts";
import { ARTICLE_DAYS_FAST, ARTICLE_DAYS_WIDE } from "../../src/lib/article-window.ts";

// ---------------------------------------------------------------------------
// Call-level proof for the adaptive article window.
//
// The unit tests in article-window.test.ts pin the policy. These pin what
// getCompanyDetail actually DOES with it, which is the part a reviewer cannot
// verify by loading Nvidia: a well-covered company must issue the SAME single
// articles query it issued before this change, and a thin one must issue a
// second, wider query and keep its result.
//
// The fake client is a chainable thenable. Every PostgREST builder method
// returns itself and records its arguments; awaiting it yields the canned row
// set queued for that table. That is enough to count queries per table and to
// read back the `published_at` bound each articles query was built with.
// ---------------------------------------------------------------------------

type Canned = { data: unknown; error: unknown };
type Call = { table: string; index: number; method: string; args: unknown[] };

const CHAIN_METHODS = ["select", "eq", "ilike", "in", "gte", "order", "limit", "or"] as const;

function makeSupabase(plan: Record<string, Canned[]>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const from = (table: string) => {
    const index = counts[table] ?? 0;
    counts[table] = index + 1;
    const settle = () => {
      const queue = plan[table] ?? [];
      return queue[Math.min(index, queue.length - 1)] ?? { data: [], error: null };
    };
    const builder: Record<string, unknown> = {};
    for (const m of CHAIN_METHODS) {
      builder[m] = (...args: unknown[]) => {
        calls.push({ table, index, method: m, args });
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(settle());
    builder.then = (ok: unknown, err: unknown) =>
      Promise.resolve(settle()).then(ok as never, err as never);
    return builder;
  };
  return {
    client: { from } as unknown as SupabaseClient,
    calls,
    articleQueryCount: () => (counts.articles ?? 0),
    /** The `published_at` lower bound of the nth articles query, in days back. */
    articleWindowDays: (n: number) => {
      const c = calls.find(
        (x) => x.table === "articles" && x.index === n && x.method === "gte" && x.args[0] === "published_at",
      );
      if (!c) return null;
      const ms = Date.now() - new Date(c.args[1] as string).getTime();
      return Math.round(ms / 86_400_000);
    },
  };
}

const COMPANY = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Tjoapack",
  ticker: null,
  sector: null,
  mention_count: 1,
  key_themes: [],
  first_seen: null,
  last_updated: null,
  sec_cik: null,
};

function article(id: string) {
  return {
    id, title: `t-${id}`, source: null, url: null,
    published_at: new Date().toISOString(), sentiment: null, deal_type: null,
    relevance_score: 5, sector: null, summary: null, relevance_reason: null,
    sentiment_reason: null, ingested_at: null,
  };
}

function plan(articleQueues: Canned[]) {
  return {
    companies: [{ data: [COMPANY], error: null }],
    aliases: [{ data: [], error: null }],
    company_mentions: [{ data: [], error: null }],
    articles: articleQueues,
    source_credibility: [{ data: [], error: null }],
  };
}

test("a well-covered company issues ONE articles query and keeps the fast rows", async () => {
  const fast = [article("a"), article("b"), article("c"), article("d")];
  const sb = makeSupabase(plan([{ data: fast, error: null }]));
  const out = await getCompanyDetail(sb.client, "Tjoapack");

  assert.equal(sb.articleQueryCount(), 1, "the head must not pay a second round trip");
  assert.equal(sb.articleWindowDays(0), ARTICLE_DAYS_FAST);
  assert.deepEqual(out?.articles.map((a) => a.id), ["a", "b", "c", "d"]);
});

test("an empty company escalates to the wide window and renders the wide rows", async () => {
  const wide = [article("x"), article("y")];
  const sb = makeSupabase(plan([
    { data: [], error: null },
    { data: wide, error: null },
  ]));
  const out = await getCompanyDetail(sb.client, "Tjoapack");

  assert.equal(sb.articleQueryCount(), 2);
  assert.equal(sb.articleWindowDays(0), ARTICLE_DAYS_FAST);
  assert.equal(sb.articleWindowDays(1), ARTICLE_DAYS_WIDE);
  assert.deepEqual(out?.articles.map((a) => a.id), ["x", "y"]);
});

test("a thin-but-not-empty company escalates too", async () => {
  const sb = makeSupabase(plan([
    { data: [article("a")], error: null },
    { data: [article("a"), article("b"), article("c")], error: null },
  ]));
  const out = await getCompanyDetail(sb.client, "Tjoapack");
  assert.equal(sb.articleQueryCount(), 2);
  assert.equal(out?.articles.length, 3);
});

test("the wide rung cannot shrink the page", async () => {
  // Wide read comes back short (concurrent delete, or a partial answer). The
  // page keeps what it already had rather than losing a row.
  const sb = makeSupabase(plan([
    { data: [article("a"), article("b")], error: null },
    { data: [article("z")], error: null },
  ]));
  const out = await getCompanyDetail(sb.client, "Tjoapack");
  assert.equal(sb.articleQueryCount(), 2);
  assert.deepEqual(out?.articles.map((a) => a.id), ["a", "b"]);
});

test("a failed wide rung leaves the fast result alone", async () => {
  const sb = makeSupabase(plan([
    { data: [article("a")], error: null },
    { data: null, error: { message: "boom" } },
  ]));
  const out = await getCompanyDetail(sb.client, "Tjoapack");
  assert.equal(sb.articleQueryCount(), 2);
  assert.deepEqual(out?.articles.map((a) => a.id), ["a"]);
});

test("a failed fast rung does not trigger an escalation", async () => {
  // An errored read has no trustworthy row count, so 0 rows must not be read
  // as "thin" and answered with a second query against an already-sick table.
  const sb = makeSupabase(plan([{ data: null, error: { message: "timeout" } }]));
  const out = await getCompanyDetail(sb.client, "Tjoapack");
  assert.equal(sb.articleQueryCount(), 1);
  assert.deepEqual(out?.articles, []);
});
