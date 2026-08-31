// The two company-demand events.
//
// WHY THESE ASSERTIONS AND NOT A RESTATEMENT. `company-search-target.ts` wrote
// the local lesson down: a rule that lives inline in a `"use client"` page can
// only be tested by retyping it, and a test that retypes a rule passes against
// a tree that does not contain it. Everything asserted below is imported from
// `src/lib/company-events.ts`, which is the module both call sites import. The
// last test does not restate the route's event-name regex either; it reads the
// regex literal out of the route's own source and runs the shipped names
// through it, so a change to the route breaks this test rather than silently
// invalidating it.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COMPANY_LOOKUP_SEARCHED,
  COMPANY_PAGE_VIEWED,
  MAX_QUERY_CHARS,
  clampQuery,
  companyLookupPayload,
  companyPageViewImmediate,
  companyPageViewOnceKey,
  companyPageViewPayload,
  type CompanyPageViewInput,
} from "../../src/lib/company-events.ts";

const MISS: CompanyPageViewInput = {
  slug: "constellation-energy",
  query: "Constellation Energy",
  companyId: null,
  outcome: "empty",
  articleCount: 0,
};
const HIT: CompanyPageViewInput = {
  slug: "NVDA",
  query: "Nvidia",
  companyId: "3d8a6b43-3581-4bb5-8a83-10a5f14f7b28",
  outcome: "content",
  articleCount: 41,
};

// ---------------------------------------------------------------------------
// The page view
// ---------------------------------------------------------------------------

test("the miss branch emits, and says company_id is null rather than guessing", () => {
  const p = companyPageViewPayload(MISS);
  assert.equal(p.company_id, null);
  assert.equal(p.outcome, "empty");
  assert.equal(p.resolved, false);
  // Both strings. The slug and the string the resolver was handed differ, and
  // the gap between them is a known miss generator.
  assert.equal(p.slug, "constellation-energy");
  assert.equal(p.query, "Constellation Energy");
});

test("the hit branch carries the companies row id it resolved to", () => {
  const p = companyPageViewPayload(HIT);
  assert.equal(p.company_id, "3d8a6b43-3581-4bb5-8a83-10a5f14f7b28");
  assert.equal(p.resolved, true);
  assert.equal(p.article_count, 41);
});

test("thin is a hit, and is distinguishable from content", () => {
  const thin = companyPageViewPayload({ ...HIT, outcome: "thin", articleCount: 0 });
  assert.equal(thin.resolved, true, "a resolved row with no coverage is still a resolution");
  assert.equal(thin.outcome, "thin");
  assert.equal(thin.article_count, 0);
  assert.notEqual(thin.outcome, companyPageViewPayload(HIT).outcome);
});

test("the binary the brief asked for is still recoverable from three values", () => {
  for (const outcome of ["empty", "thin", "content"] as const) {
    const p = companyPageViewPayload({ ...HIT, outcome });
    assert.equal(p.resolved, outcome !== "empty");
  }
});

// ---------------------------------------------------------------------------
// The dedupe key. This is the half that stops the brief-open defect recurring.
// ---------------------------------------------------------------------------

test("two slugs for one row share a once key, so a company counts once a day", () => {
  const viaTicker = companyPageViewOnceKey(HIT);
  const viaName = companyPageViewOnceKey({ ...HIT, slug: "nvidia-corporation", query: "Nvidia Corporation" });
  assert.equal(viaTicker, viaName);
});

test("two failing strings are two facts and must not collapse", () => {
  const a = companyPageViewOnceKey(MISS);
  const b = companyPageViewOnceKey({ ...MISS, slug: "constellation-brands" });
  assert.notEqual(a, b);
});

test("a miss key is case-insensitive, so casing alone cannot double-count", () => {
  assert.equal(
    companyPageViewOnceKey(MISS),
    companyPageViewOnceKey({ ...MISS, slug: "Constellation-Energy" }),
  );
});

test("a miss key can never collide with a resolved row's key", () => {
  assert.ok(companyPageViewOnceKey(HIT).startsWith("id:"));
  assert.ok(companyPageViewOnceKey(MISS).startsWith("miss:"));
});

test("only the miss branch flushes immediately", () => {
  assert.equal(companyPageViewImmediate(MISS), true);
  assert.equal(companyPageViewImmediate(HIT), false);
  assert.equal(companyPageViewImmediate({ ...HIT, outcome: "thin" }), false);
});

// ---------------------------------------------------------------------------
// The typed string
// ---------------------------------------------------------------------------

test("the typed string is trimmed and capped, and the cap is visible in the data", () => {
  const long = "x".repeat(MAX_QUERY_CHARS + 40);
  const p = companyLookupPayload({
    query: `   ${long}   `,
    matches: 0,
    committed: true,
    destination: null,
    companyId: null,
  });
  assert.equal((p.query as string).length, MAX_QUERY_CHARS);
  // Not the truncated length. A cap set too tight has to be visible rather
  // than silently reshaping every long query into the same string.
  assert.equal(p.query_len, MAX_QUERY_CHARS + 40);
});

test("clampQuery trims before it caps", () => {
  assert.equal(clampQuery("  berkshire  "), "berkshire");
  assert.equal(clampQuery("   "), "");
});

// ---------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------

test("resolved follows the row count, not the navigation", () => {
  const hit = companyLookupPayload({
    query: "nvidia", matches: 3, committed: true,
    destination: "/company/Nvidia", companyId: "abc",
  });
  assert.equal(hit.resolved, true);
  assert.equal(hit.matches, 3);
  assert.equal(hit.company_id, "abc");

  // Zero rows but a speculative push: CANONICAL points at a name the substring
  // search never ran. The search still did not resolve, and must not claim to.
  const speculative = companyLookupPayload({
    query: "INTC", matches: 0, committed: true,
    destination: "/company/INTC", companyId: null,
  });
  assert.equal(speculative.resolved, false);
  assert.equal(speculative.destination, "/company/INTC");
});

test("dead_end is exactly typed, committed, nothing found, nowhere to go", () => {
  const base = { query: "brk.b", matches: 0, committed: true, destination: null, companyId: null };
  assert.equal(companyLookupPayload(base).dead_end, true);
  // A settled query the reader never committed is not a dead end; they may
  // still be typing.
  assert.equal(companyLookupPayload({ ...base, committed: false }).dead_end, false);
  // Rows were found.
  assert.equal(companyLookupPayload({ ...base, matches: 2 }).dead_end, false);
  // The reader was sent somewhere.
  assert.equal(companyLookupPayload({ ...base, destination: "/company/BRK.B" }).dead_end, false);
});

test("the settled and committed emits are one name split by a flag", () => {
  const settled = companyLookupPayload({
    query: "star", matches: 4, committed: false, destination: null, companyId: null,
  });
  assert.equal(settled.committed, false);
  assert.equal(settled.destination, null);
  assert.equal(settled.query, "star");
});

// ---------------------------------------------------------------------------
// The names have to survive the route that validates them
// ---------------------------------------------------------------------------

test("both event names pass the route's OWN regex, read from its source", () => {
  const src = readFileSync(
    new URL("../../src/app/api/user-events/route.ts", import.meta.url),
    "utf8",
  );
  const m = src.match(/const EVENT_NAME_RE = (\/.+\/);/);
  assert.ok(m, "EVENT_NAME_RE is no longer a bare regex literal in the route; update this test");
  const lit = m[1];
  const body = lit.slice(1, lit.lastIndexOf("/"));
  const flags = lit.slice(lit.lastIndexOf("/") + 1);
  const re = new RegExp(body, flags);

  // Guard the guard: a regex that accepted anything would make this vacuous.
  assert.equal(re.test("Company.Page.Viewed"), false);
  assert.equal(re.test("company.page"), false);

  assert.equal(re.test(COMPANY_PAGE_VIEWED), true, COMPANY_PAGE_VIEWED);
  assert.equal(re.test(COMPANY_LOOKUP_SEARCHED), true, COMPANY_LOOKUP_SEARCHED);

  const MAX_EVENT_NAME_LEN = 64;
  assert.ok(COMPANY_PAGE_VIEWED.length <= MAX_EVENT_NAME_LEN);
  assert.ok(COMPANY_LOOKUP_SEARCHED.length <= MAX_EVENT_NAME_LEN);
});
