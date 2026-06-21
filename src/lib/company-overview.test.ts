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
  overviewSourceHash,
  sanitizeOverview,
  isThinSource,
  OVERVIEW_MAX_CHARS,
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
