/**
 * Unit tests for company-overview.ts. Pure, deterministic, no network, no Gemini.
 * Run: npx tsx --test src/lib/company-overview.test.ts
 *
 * The grounded-only contract is enforced by the PROMPT, so these tests pin the
 * prompt text (the model is mocked at the route layer, not here) plus the hash
 * and sanitizer behavior.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildOverviewPrompt,
  buildOverviewCacheRow,
  isOverviewCacheHit,
  overviewCacheFilter,
  overviewSourceHash,
  sanitizeOverview,
  isThinSource,
  COMPANY_OVERVIEW_OUTPUT_TYPE,
  OVERVIEW_MAX_CHARS,
  OVERVIEW_PROMPT_FINGERPRINT,
  type OverviewInputs,
} from "./company-overview";

const RICH: OverviewInputs = {
  name: "NVIDIA",
  ticker: "NVDA",
  sector: "Technology",
  industry: "Semiconductors",
  summary:
    "NVIDIA Corporation provides graphics and compute solutions. Its segments include Graphics and Compute & Networking, and it sells GPUs for data center, gaming, and professional visualization markets worldwide.",
  segments: null,
};

const THIN: OverviewInputs = {
  name: "Acme Private Co",
  ticker: null,
  sector: null,
  industry: null,
  summary: null,
  segments: null,
};

// ---------------------------------------------------------------------------
// Prompt: grounded-only + descriptive-only constraints are present
// ---------------------------------------------------------------------------

test("prompt states the strictly-grounded constraint", () => {
  const { system } = buildOverviewPrompt(RICH);
  assert.match(system, /STRICTLY GROUNDED/);
  assert.match(system, /Never invent or infer/i);
});

test("prompt forbids recommendation / directional language", () => {
  const { system } = buildOverviewPrompt(RICH);
  assert.match(system, /no buy, sell, hold, recommendation/i);
  assert.match(system, /DESCRIPTIVE ONLY/);
});

test("prompt caps length to 1-2 sentences and bans em-dashes", () => {
  const { system } = buildOverviewPrompt(RICH);
  assert.match(system, /1 to 2 sentences/i);
  assert.match(system, /Zero em-dashes/i);
});

test("rich prompt carries the provider summary verbatim as grounding", () => {
  const { user } = buildOverviewPrompt(RICH);
  assert.ok(user.includes(RICH.summary!), "summary must be in the user prompt");
  assert.match(user, /Ticker: NVDA/);
  assert.match(user, /Industry: Semiconductors/);
});

// ---------------------------------------------------------------------------
// Thin source: no invented detail, instructs brevity / empty
// ---------------------------------------------------------------------------

test("thin source is detected", () => {
  assert.equal(isThinSource(THIN), true);
  assert.equal(isThinSource(RICH), false);
});

test("thin prompt contains no fabricated facts, only the sparse inputs", () => {
  const { user } = buildOverviewPrompt(THIN);
  // The only company-specific token is the name; no ticker/sector/industry/summary.
  assert.match(user, /Company: Acme Private Co/);
  assert.ok(!/Ticker:/.test(user), "no ticker line for a thin source");
  assert.ok(!/Industry:/.test(user), "no industry line for a thin source");
  assert.match(user, /Provider summary: \(none provided\)/);
});

test("prompt instructs a shorter overview (or empty) on a thin source", () => {
  const { system } = buildOverviewPrompt(THIN);
  assert.match(system, /return a SHORTER overview/i);
  assert.match(system, /return an empty string/i);
});

// ---------------------------------------------------------------------------
// Source hash: stable, and changes when grounding inputs change
// ---------------------------------------------------------------------------

test("hash is stable for identical inputs", () => {
  assert.equal(overviewSourceHash(RICH), overviewSourceHash({ ...RICH }));
});

test("hash changes when the summary changes (cache invalidation)", () => {
  const changed = { ...RICH, summary: RICH.summary + " New segment added." };
  assert.notEqual(overviewSourceHash(RICH), overviewSourceHash(changed));
});

test("hash is insensitive to ticker casing and segment order", () => {
  const a = overviewSourceHash({ ...RICH, ticker: "nvda", segments: ["a", "b"] });
  const b = overviewSourceHash({ ...RICH, ticker: "NVDA", segments: ["b", "a"] });
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

test("sanitize strips fences/quotes, em-dashes, collapses whitespace", () => {
  const out = sanitizeOverview('```\n"NVIDIA designs GPUs — for AI."\n```');
  assert.equal(out, "NVIDIA designs GPUs, for AI.");
});

test("sanitize returns empty string for empty/whitespace", () => {
  assert.equal(sanitizeOverview(""), "");
  assert.equal(sanitizeOverview("   \n  "), "");
  assert.equal(sanitizeOverview(null), "");
});

test("sanitize hard-caps overly long output", () => {
  const long = "A".repeat(OVERVIEW_MAX_CHARS + 100);
  const out = sanitizeOverview(long);
  assert.ok(out.length <= OVERVIEW_MAX_CHARS + 3, `len ${out.length}`);
});

// ---------------------------------------------------------------------------
// Cache contract
//
// These pin the two defects that made the Primer cache a 100% miss and re-bill
// a gemini-2.5-flash call on every company page view:
//   1. output_type "company_overview" was not a member of output_type_enum.
//   2. source_id (a uuid column) was being handed a company NAME.
// Both raised 22P02 on the same insert, so fixing only the enum would have left
// the write still failing.
// ---------------------------------------------------------------------------

test("cache row carries no source_id: outputs.source_id is uuid, the cache key is a name", () => {
  const row = buildOverviewCacheRow("Apple Inc.", "Apple designs consumer hardware.", "abc123");
  assert.equal(
    Object.prototype.hasOwnProperty.call(row, "source_id"),
    false,
    "source_id must be absent; passing a company name into a uuid column raises 22P02"
  );
});

test("cache row identifies the company through content.target_company, which is what the read filters on", () => {
  const row = buildOverviewCacheRow("Apple Inc.", "Apple designs consumer hardware.", "abc123");
  assert.equal(row.content.target_company, "Apple Inc.");
  assert.equal(row.content.overview, "Apple designs consumer hardware.");
  assert.equal(row.content.source_hash, "abc123");
  assert.equal(row.source_table, "companies");
});

test("cache row output_type comes from the shared constant, not a fresh literal", () => {
  const row = buildOverviewCacheRow("Apple Inc.", "Apple designs consumer hardware.", "abc123");
  assert.equal(row.output_type, COMPANY_OVERVIEW_OUTPUT_TYPE);
});

test("cache hit requires a matching source_hash", () => {
  const hash = overviewSourceHash(RICH);
  assert.equal(
    isOverviewCacheHit({ target_company: "NVIDIA", overview: "NVIDIA designs GPUs.", source_hash: hash }, hash),
    true
  );
  assert.equal(
    isOverviewCacheHit(
      { target_company: "NVIDIA", overview: "NVIDIA designs GPUs.", source_hash: "stale" },
      hash
    ),
    false,
    "a stale hash must be a miss so changed inputs force exactly one regeneration"
  );
});

test("cache miss on absent, empty or whitespace-only overview", () => {
  const hash = overviewSourceHash(RICH);
  assert.equal(isOverviewCacheHit(null, hash), false);
  assert.equal(isOverviewCacheHit(undefined, hash), false);
  assert.equal(isOverviewCacheHit({ source_hash: hash }, hash), false);
  assert.equal(isOverviewCacheHit({ overview: "", source_hash: hash }, hash), false);
  assert.equal(isOverviewCacheHit({ overview: "   ", source_hash: hash }, hash), false);
});

test("a row written by buildOverviewCacheRow reads back as a hit for the same inputs", () => {
  // The round trip that never happened in production: write payload -> stored
  // content -> read decision. Same hash on both sides, no normalization skew.
  const hash = overviewSourceHash(RICH);
  const row = buildOverviewCacheRow(RICH.name, "NVIDIA designs GPUs for data centers.", hash);
  assert.equal(isOverviewCacheHit(row.content, hash), true);
});

// ---------------------------------------------------------------------------
// The read must SELECT BY HASH, not validate the hash after the fact.
//
// The route reads with `.order(created_at desc).limit(1)`, so any column this
// filter fails to narrow is decided by recency instead. PrimerTab POSTs two
// different bodies per mount for a company with both a curated description and
// a live quote (curated while `quote` is null, then the live Yahoo values once
// /api/company-kpis resolves and the effect deps flip). Two hashes under one
// cache key, so a filter that omits source_hash returns the other variant's row
// on every single read, regenerates, and writes again.
//
// These assert the SEAM. overviewCacheFilter is the object the route applies,
// column for column, in a loop; it is not a restatement of the route's query.
// ---------------------------------------------------------------------------

test("cache filter narrows on source_hash, so the read cannot return a mismatched row", () => {
  const hash = overviewSourceHash(RICH);
  const filter = overviewCacheFilter(RICH.name, hash);
  assert.equal(
    filter["content->>source_hash"],
    hash,
    "without this equality the read is latest-row-wins and the two PrimerTab variants evict each other forever"
  );
});

test("cache filter pins output_type and target_company alongside the hash", () => {
  const hash = overviewSourceHash(RICH);
  const filter = overviewCacheFilter(RICH.name, hash);
  assert.deepEqual(Object.keys(filter).sort(), [
    "content->>source_hash",
    "content->>target_company",
    "output_type",
  ]);
  assert.equal(filter.output_type, COMPANY_OVERVIEW_OUTPUT_TYPE);
  assert.equal(filter["content->>target_company"], RICH.name);
});

test("the two PrimerTab body variants produce two different cache filters", () => {
  // Same company, same mount. Variant A is the curated body sent while `quote`
  // is null; variant B is the live body sent once the quote resolves. Under a
  // filter that omits the hash these are indistinguishable, which is the defect.
  const curated: OverviewInputs = { ...RICH, industry: "Semiconductors" };
  const live: OverviewInputs = { ...RICH, industry: "Semiconductors - Specialized" };

  const a = overviewCacheFilter(curated.name, overviewSourceHash(curated));
  const b = overviewCacheFilter(live.name, overviewSourceHash(live));

  assert.equal(a["content->>target_company"], b["content->>target_company"], "same cache key company");
  assert.notEqual(
    a["content->>source_hash"],
    b["content->>source_hash"],
    "the two variants must be two distinct cache entries, not one contested key"
  );
});

test("a row written for one variant does not satisfy the other variant's filter", () => {
  const curated: OverviewInputs = { ...RICH, industry: "Semiconductors" };
  const live: OverviewInputs = { ...RICH, industry: "Semiconductors - Specialized" };
  const row = buildOverviewCacheRow(
    curated.name,
    "NVIDIA designs GPUs.",
    overviewSourceHash(curated)
  );
  // What the database would do with the live variant's filter against that row.
  const liveFilter = overviewCacheFilter(live.name, overviewSourceHash(live));
  assert.notEqual(
    row.content.source_hash,
    liveFilter["content->>source_hash"],
    "the filter must exclude this row rather than return it and fail validation afterwards"
  );
});

// ---------------------------------------------------------------------------
// The cache key covers the PROMPT, not just the inputs.
//
// Without this, rows written under an old prompt outlive every later prompt
// fix: the fix ships, the hash still matches, and cached companies keep serving
// what the old instructions produced. memo solves this with a hand-maintained
// MEMO_PROMPT_VERSION; this derives the fingerprint from the prompt builder so
// there is no constant to forget to bump.
// ---------------------------------------------------------------------------

test("the source hash depends on the prompt fingerprint, not only on the inputs", () => {
  // Drives the REAL hash function with two fingerprints. If the fingerprint is
  // dropped from the key, identical inputs collide across prompt versions and
  // this goes red.
  assert.notEqual(
    overviewSourceHash(RICH, "fingerprint-before-a-prompt-edit"),
    overviewSourceHash(RICH, "fingerprint-after-a-prompt-edit"),
    "a prompt change must invalidate every cached overview; otherwise a prompt fix never reaches cached companies"
  );
});

test("the default source hash is the one computed with the live prompt fingerprint", () => {
  // Pins the wiring: the exported constant is what the no-argument call uses,
  // so the route (which calls it with one argument) gets prompt-aware keys.
  assert.equal(overviewSourceHash(RICH), overviewSourceHash(RICH, OVERVIEW_PROMPT_FINGERPRINT));
});

test("the prompt fingerprint is a non-empty derived digest, not a placeholder", () => {
  assert.match(OVERVIEW_PROMPT_FINGERPRINT, /^[0-9a-f]{1,8}$/);
});
