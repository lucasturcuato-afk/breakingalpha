// What /company/<slug> can reach, and what it must never reach.
//
// THE DEFECT THIS LOCKS. `resolveAlias`'s name branch compared a CANONICALIZED
// needle against the RAW `companies.name` column. `canonicalize()` is a
// read-side display map; the column is written by the Python ingest pipeline,
// which has never heard of it. One side normalized, the other not, so for every
// row where the two disagree the comparison was unsatisfiable no matter what the
// table held. Measured read-only against the corpus, 13.0% of rows could not be
// reached from the slug the Company Intel index builds for them, including names
// with four-figure mention counts. The page rendered "not on Signalera" over a
// company that is very much on Signalera.
//
// WHY A UNIT TEST. The resolver runs between the Next server and Postgres, so a
// browser spec cannot reach it, and the cases that matter are the negative ones:
// a slug that must NOT move, and a candidate row that must NOT be accepted. The
// fake client below records the queries issued, so the non-regression test can
// assert THE BRANCH WAS NOT TAKEN rather than assert a name that would also be
// right for the wrong reason.
//
// THE CONTRACT LOCKED HERE:
//
//   exact name hit          -> resolves, and the symmetric pass is NEVER queried.
//                              This is the whole non-regression argument: a link
//                              that works today cannot be repointed by code that
//                              never runs for it
//   CANONICAL rewrote it    -> "JPMorgan" is stored, canonicalize makes the slug
//                              "jpmorgan-chase", and the row is reached through
//                              the CANONICAL inverse
//   legal suffix stripped   -> "Visa Inc." reached from /company/visa
//   trailing period         -> "Sei Investments Co." reached from a needle that
//                              lost the period
//   native hyphen           -> "Parker-Hannifin Corporation" reached from a slug
//                              round-trip that turned the hyphen into a space
//   a candidate that does not canonicalize to the target
//                           -> REJECTED. The prefix read is a candidate filter,
//                              never the decision
//
// WHAT THIS DOES NOT FIX, named because the PR body claims they are named here.
// Three catalog rows stay unreachable from their own index link:
//
//   "Miami International Holdings"
//   "The Arena Group Holdings, Inc."
//   "China Railway Construction Corporation Limited"
//
// One mechanism, and it is NOT the one the resolver owns. `canonicalize()` is
// not idempotent: `LEGAL_SUFFIX_RE` strips a trailing
// Markets|Holdings|Group|International on EVERY pass, and the detail route
// canonicalizes twice, once in page.tsx and again inside `resolveAlias`. So the
// index links "Miami International" and the resolver is handed "Miami", which
// is not a key any row canonicalizes to. The equality filter then correctly
// refuses "Miami International Holdings", because refusing a candidate that
// does not canonicalize to the target is the whole point of it.
//
// There is a SECOND non-idempotence, a trailing "." lost on the second pass
// ("Mitsui & Co." to "Mitsui & Co"), and it costs nothing: `nameMatchKey`
// normalizes trailing punctuation on both operands, so those rows resolve. The
// two are separated here because "canonicalize is not idempotent" reads as one
// defect when it is two, with different consequences. Fixing the first means
// changing `canonicalize`, which is a far larger blast radius than this file.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAlias, nameMatchKey } from "../../src/lib/data-access/aliasResolver.ts";

/* ── fake client ─────────────────────────────────────────────────────────── */

interface Row {
  id: string;
  name: string;
  ticker: string | null;
  sector: string | null;
  mention_count: number | null;
  key_themes: string[] | null;
  first_seen: string | null;
  last_updated: string | null;
  sec_cik: number | null;
}

function row(partial: Partial<Row> & { id: string; name: string }): Row {
  return {
    ticker: null,
    sector: null,
    mention_count: 1,
    key_themes: null,
    first_seen: null,
    last_updated: null,
    sec_cik: null,
    ...partial,
  };
}

/**
 * POSTGRES LIKE semantics, not a copy of anything in src/. `_` matches exactly
 * one character, `%` matches any run, `\` escapes the next character. The
 * resolver builds patterns for Postgres to run; the fake has to run them the
 * same way or the test would be measuring its own approximation.
 */
function likeMatches(value: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
      if (i < pattern.length) re += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      continue;
    }
    if (c === "%") re += "[\\s\\S]*";
    else if (c === "_") re += "[\\s\\S]";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i").test(value);
}

interface Query {
  table: string;
  eq: Record<string, unknown>;
  ilike: [string, string] | null;
  in: Record<string, unknown[]>;
  limit: number | null;
}

interface Harness {
  client: SupabaseClient;
  queries: Query[];
  /** Name-branch reads: the exact match plus any symmetric-pass candidate reads. */
  nameReads: () => Query[];
}

function harness(rows: Row[]): Harness {
  const queries: Query[] = [];

  function run(q: Query): { data: unknown; error: null } {
    if (q.table === "aliases") return { data: [], error: null };
    let out = rows.filter((r) => {
      if ("id" in q.eq && r.id !== q.eq.id) return false;
      if ("ticker" in q.eq && (r.ticker ?? null) !== q.eq.ticker) return false;
      if (q.ilike && !likeMatches(r.name, q.ilike[1])) return false;
      return true;
    });
    out = [...out].sort(
      (a, b) => (b.mention_count ?? -1) - (a.mention_count ?? -1) || a.id.localeCompare(b.id),
    );
    if (q.limit != null) out = out.slice(0, q.limit);
    return { data: out, error: null };
  }

  function builder(table: string) {
    const q: Query = { table, eq: {}, ilike: null, in: {}, limit: null };
    queries.push(q);
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => chain;
    chain.eq = (col: string, val: unknown) => {
      q.eq[col] = val;
      return chain;
    };
    chain.ilike = (col: string, pattern: string) => {
      q.ilike = [col, pattern];
      return chain;
    };
    chain.in = (col: string, vals: unknown[]) => {
      q.in[col] = vals;
      return chain;
    };
    chain.limit = (n: number) => {
      q.limit = n;
      return chain;
    };
    chain.maybeSingle = () => {
      const res = run(q);
      return Promise.resolve({
        data: (res.data as unknown[])[0] ?? null,
        error: null,
      });
    };
    chain.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve(run(q)).then(ok, fail);
    return chain;
  }

  return {
    client: { from: (table: string) => builder(table) } as unknown as SupabaseClient,
    queries,
    nameReads: () => queries.filter((q) => q.table === "companies" && q.ilike !== null),
  };
}

/* ── the corpus shapes that were unreachable, modelled on real rows ──────── */

const JPMORGAN = row({ id: "a1", name: "JPMorgan", ticker: "JPM", sec_cik: 19617, mention_count: 647 });
const VISA = row({ id: "a2", name: "Visa Inc.", ticker: "V", sec_cik: 1403161, mention_count: 515 });
const SEI = row({ id: "a3", name: "Sei Investments Co.", ticker: "SEIC", sec_cik: 350894, mention_count: 248 });
const PARKER = row({ id: "a4", name: "Parker-Hannifin Corporation", ticker: "PH", sec_cik: 76334, mention_count: 165 });
const APPLE = row({ id: "a5", name: "Apple", ticker: "AAPL", sec_cik: 320193, mention_count: 900 });

/* ── the repair ──────────────────────────────────────────────────────────── */

test("a slug whose name CANONICAL rewrites reaches its row", async () => {
  // canonicalize("JPMorgan") is "JPMorgan Chase", so the index builds
  // /company/jpmorgan-chase and the old exact match looked for a row literally
  // named "JPMorgan Chase", which does not exist.
  const h = harness([JPMORGAN, APPLE]);
  const res = await resolveAlias(h.client, "jpmorgan-chase");
  assert.ok(res, "/company/jpmorgan-chase must not render the empty state");
  assert.equal(res.canonical.id, JPMORGAN.id);
});

test("a slug whose name lost a legal suffix reaches its row", async () => {
  const h = harness([VISA, APPLE]);
  const res = await resolveAlias(h.client, "visa");
  assert.ok(res, "/company/visa must not render the empty state");
  assert.equal(res.canonical.id, VISA.id);
});

test("a slug whose name lost a trailing period reaches its row", async () => {
  const h = harness([SEI, APPLE]);
  const res = await resolveAlias(h.client, "sei-investments-co");
  assert.ok(res);
  assert.equal(res.canonical.id, SEI.id);
});

test("a slug round-trip that flattened a native hyphen reaches its row", async () => {
  // slugify writes "-" for a space and slugToCompanyName reads EVERY "-" back
  // as a space, so the stored hyphen cannot survive the trip.
  const h = harness([PARKER, APPLE]);
  const res = await resolveAlias(h.client, "parker-hannifin");
  assert.ok(res);
  assert.equal(res.canonical.id, PARKER.id);
});

/* ── the guard ───────────────────────────────────────────────────────────── */

test("an exact name hit issues exactly one name read and never runs the symmetric pass", async () => {
  // THE SEAM, NOT A SYMPTOM. Asserting only that /company/apple still resolves
  // to Apple would stay green with the guard deleted, because the symmetric
  // pass would find Apple too. The query log is what proves the branch did not
  // run, which is the whole reason a working link cannot be repointed.
  const h = harness([APPLE, JPMORGAN, VISA]);
  const res = await resolveAlias(h.client, "apple");
  assert.ok(res);
  assert.equal(res.canonical.id, APPLE.id);
  assert.equal(
    h.nameReads().length,
    1,
    "the exact match answered, so no candidate read may be issued",
  );
});

test("a miss runs the symmetric pass, so the guard is load bearing in both directions", async () => {
  const h = harness([VISA]);
  const res = await resolveAlias(h.client, "visa");
  assert.ok(res);
  assert.ok(
    h.nameReads().length > 1,
    "the exact match missed, so candidate reads must have been issued",
  );
});

/* ── what must never be accepted ─────────────────────────────────────────── */

test("a candidate that does not canonicalize to the target is rejected", async () => {
  // "Visandia Holdings" is returned by the same `Visa%` prefix read that finds
  // "Visa Inc.", and it must lose. The prefix is a candidate filter; the
  // decision is nameMatchKey equality on both sides.
  //
  // THE DECOY CARRIES A CIK ON PURPOSE, and the first draft of this test did
  // not. That draft named the equality filter and measured `rankCluster`
  // instead: with no CIK on the decoy, the CIK-first comparator put "Visa Inc."
  // ahead of it before mention_count was ever read, so the assertion held with
  // the filter DELETED. Green under its own mutation is the incidental
  // fingerprint CLAUDE.md documents, and it is the reason this comment exists
  // rather than a quiet edit.
  //
  // Same side of the CIK line, the next comparator is mention_count, and the
  // decoy wins it outright. Every tiebreaker `rankCluster` owns now prefers the
  // decoy, so the ONLY thing that can keep it out of the answer is the filter
  // this test is named for. Proved by mutation: replace the filter with an
  // unconditional `hits.push(row)` and this test goes red.
  const decoy = row({
    id: "d1",
    name: "Visandia Holdings",
    mention_count: 99999,
    sec_cik: 9999999,
  });
  const h = harness([decoy, VISA]);
  const res = await resolveAlias(h.client, "visa");
  assert.ok(res);
  assert.equal(res.canonical.id, VISA.id, "the higher-mention decoy must not win");
});

test("a slug for a company that is genuinely absent still renders the empty state", async () => {
  const h = harness([APPLE, VISA]);
  const res = await resolveAlias(h.client, "a-company-that-does-not-exist");
  assert.equal(res, null, "the fix must not invent a company for an unknown slug");
});

test("a prefix that reaches a longer unrelated name resolves nothing", async () => {
  // /company/coca is not /company/coca-cola. The prefix read returns the longer
  // row; the equality filter throws it away.
  const cola = row({ id: "c1", name: "Coca-Cola Europacific Partners", mention_count: 69 });
  const h = harness([cola]);
  const res = await resolveAlias(h.client, "coca");
  assert.equal(res, null);
});

/* ── the key itself ──────────────────────────────────────────────────────── */

test("nameMatchKey absorbs separator and trailing punctuation, and nothing else", () => {
  assert.equal(nameMatchKey("Parker-Hannifin"), nameMatchKey("Parker Hannifin"));
  assert.equal(nameMatchKey("Sei Investments Co."), nameMatchKey("Sei Investments Co"));
  assert.equal(nameMatchKey("Altria Group,"), nameMatchKey("Altria Group"));
  assert.equal(nameMatchKey("  T-Mobile   US  "), "t mobile us");
  // It is an equality after normalization, not a fuzzy match.
  assert.notEqual(nameMatchKey("Visa"), nameMatchKey("Visandia"));
  assert.notEqual(nameMatchKey("Meta"), nameMatchKey("Metals X"));
  assert.notEqual(nameMatchKey("Coca-Cola"), nameMatchKey("Coca-Cola Europacific"));
});
