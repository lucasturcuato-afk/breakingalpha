// Unit tests for sector-type watchlist matching
// (src/lib/watchlist-utils.ts resolveSectorEntry / buildArticleOrFilter).
//
// The defect: buildArticleOrFilter accepted a `type` parameter and never read
// it, so a sector subscription was served as
//   primary_company ILIKE '%Finance%' OR title ILIKE '%Finance%'
// which matches the word "finance" in prose and has nothing to do with the
// article's sector. Same defect class as the watchlist boost's substring match.
//
// The contract locked here:
//   sector           -> jsonb containment on industry_verticals / activity_types
//   ticker, company  -> UNCHANGED fuzzy ILIKE across primary_company + title
//   unmappable       -> null, so the caller renders nothing rather than the
//                       wrong articles
//
// The jsonb literal form matters: industry_verticals is JSONB, not text[], so
// cs.["Technology"] is required and cs.{Technology} is rejected by Postgres
// with 400 22P02. Verified against the live PostgREST instance.
//
// Run: node --test tests/unit/watchlist-sector-filter.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildArticleOrFilter,
  resolveSectorEntry,
} from "../../src/lib/watchlist-utils.ts";

test("exact industry vertical resolves to industry_verticals", () => {
  assert.deepEqual(resolveSectorEntry("Technology"), {
    column: "industry_verticals",
    value: "Technology",
  });
  assert.deepEqual(resolveSectorEntry("Consumer & Retail"), {
    column: "industry_verticals",
    value: "Consumer & Retail",
  });
});

test("activity types resolve to activity_types, not verticals", () => {
  // Private Equity and Venture Capital are the OTHER dimension. Matching them
  // against industry_verticals would return nothing, forever, silently.
  assert.deepEqual(resolveSectorEntry("Private Equity"), {
    column: "activity_types",
    value: "Private Equity",
  });
  assert.deepEqual(resolveSectorEntry("Venture Capital"), {
    column: "activity_types",
    value: "Venture Capital",
  });
});

test("stored shorthands resolve to the canonical vertical", () => {
  // The five divergent rows the free-text fallthrough produced.
  const cases: [string, string][] = [
    ["Finance", "Financial Services"],
    ["Energy", "Energy & Oil/Gas"],
    ["Consumer", "Consumer & Retail"],
    ["Healthcare", "Healthcare & Biotech"],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(
      resolveSectorEntry(input),
      { column: "industry_verticals", value: expected },
      `${input} -> ${expected}`,
    );
  }
});

test("resolution is case- and whitespace-insensitive but returns canonical casing", () => {
  // The stored taxonomy values are case-sensitive, so the canonical casing has
  // to come back out even when the input is not canonical.
  assert.deepEqual(resolveSectorEntry("  energy & OIL/gas "), {
    column: "industry_verticals",
    value: "Energy & Oil/Gas",
  });
  assert.deepEqual(resolveSectorEntry("TECHNOLOGY"), {
    column: "industry_verticals",
    value: "Technology",
  });
});

test("unmappable sector values resolve to null", () => {
  // Public Markets has no defensible target; Geopolitics & Macro straddles two
  // activity types. Both must stay null rather than silently pick one.
  assert.equal(resolveSectorEntry("Public Markets"), null);
  assert.equal(resolveSectorEntry("Geopolitics & Macro"), null);
  assert.equal(resolveSectorEntry(""), null);
  assert.equal(resolveSectorEntry("   "), null);
});

test("sector filter emits a JSONB containment condition", () => {
  // cs.["Technology"], NOT cs.{Technology}: industry_verticals is jsonb and
  // rejects the postgres array literal with 22P02.
  assert.equal(
    buildArticleOrFilter("Technology", null, "sector"),
    'industry_verticals.cs.["Technology"]',
  );
  assert.equal(
    buildArticleOrFilter("Finance", null, "sector"),
    'industry_verticals.cs.["Financial Services"]',
  );
  assert.equal(
    buildArticleOrFilter("Private Equity", null, "sector"),
    'activity_types.cs.["Private Equity"]',
  );
});

test("sector filter never emits an ILIKE condition", () => {
  // The whole point: no substring matching on prose for a sector entry.
  for (const s of ["Technology", "Finance", "Energy", "Private Equity"]) {
    const filter = buildArticleOrFilter(s, null, "sector");
    assert.ok(filter, `${s} should produce a filter`);
    assert.ok(!filter!.includes("ilike"), `${s} must not use ilike: ${filter}`);
    assert.ok(!filter!.includes("primary_company"), `${s} must not touch primary_company`);
    assert.ok(!filter!.includes("title"), `${s} must not touch title`);
  }
});

test("a value with a special character survives the or-grammar", () => {
  // Ampersand and slash appear in real taxonomy values and must not be mangled.
  assert.equal(
    buildArticleOrFilter("Energy", null, "sector"),
    'industry_verticals.cs.["Energy & Oil/Gas"]',
  );
});

test("unmappable sector entry yields null, not an unfiltered query", () => {
  // Callers treat null as "no articles". Returning a bare term here would show
  // the reader unrelated articles under a sector heading.
  assert.equal(buildArticleOrFilter("Public Markets", null, "sector"), null);
});

test("ticker and company behaviour is unchanged", () => {
  const ticker = buildArticleOrFilter("GS", "Goldman Sachs Group Inc", "ticker");
  assert.equal(
    ticker,
    "primary_company.ilike.%Goldman Sachs Group Inc%," +
      "title.ilike.%Goldman Sachs Group Inc%," +
      "primary_company.ilike.%Goldman Sachs%," +
      "title.ilike.%Goldman Sachs%," +
      "primary_company.ilike.%GS%",
  );

  const company = buildArticleOrFilter("Anthropic", null, "company");
  assert.equal(
    company,
    "primary_company.ilike.%Anthropic%,title.ilike.%Anthropic%",
  );
});

test("an unknown type keeps the legacy ticker-style behaviour", () => {
  // Defensive: the enum is ticker|company|sector, but the caller passes
  // `watchlistRow?.type ?? "ticker"`, so an unexpected value must not crash or
  // silently become a sector query.
  assert.equal(
    buildArticleOrFilter("Anthropic", null, "something-else"),
    "primary_company.ilike.%Anthropic%,title.ilike.%Anthropic%",
  );
});
