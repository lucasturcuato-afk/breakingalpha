// Unit tests for B1: Signal score decoupled from completeness.
// (src/lib/article-signal.tsx getAdjustedScore / getCompleteness)
//
// Before the fix, getAdjustedScore multiplied relevance_score by a completeness
// weight (headline 0.5). Because the top-stories tier saturates at relevance 10
// and almost every high-relevance item is a content-NULL gnews snippet (mapped
// to "headline"), every card rendered a flat 10 x 0.5 = 5.0. The fix makes Signal
// the native relevance_score and keeps completeness as a separate badge.
//
// Run: node --test tests/unit/signal-score-decouple.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdjustedScore, getCompleteness } from "../../src/lib/article-signal-score.ts";

// A representative top-15 set: relevance saturated near the top, most items are
// content-NULL gnews snippets (headline completeness), a few have a body.
const ROWS: Array<{ relevance_score: number; content: string | null; summary: string | null }> = [
  { relevance_score: 10, content: null, summary: "short snippet" },
  { relevance_score: 10, content: null, summary: "short snippet" },
  { relevance_score: 10, content: null, summary: "short snippet" },
  { relevance_score: 10, content: "x".repeat(900), summary: null }, // full text
  { relevance_score: 9, content: null, summary: "short snippet" },
  { relevance_score: 9, content: null, summary: "short snippet" },
  { relevance_score: 9, content: "y".repeat(200), summary: null }, // summary
  { relevance_score: 8, content: null, summary: "short snippet" },
  { relevance_score: 8, content: null, summary: "short snippet" },
  { relevance_score: 8, content: null, summary: "short snippet" },
  { relevance_score: 7, content: null, summary: "short snippet" },
  { relevance_score: 7, content: null, summary: "short snippet" },
  { relevance_score: 6, content: null, summary: "short snippet" },
  { relevance_score: 6, content: null, summary: "short snippet" },
  { relevance_score: 6, content: null, summary: "short snippet" },
];

const signals = ROWS.map((r) =>
  getAdjustedScore(r.relevance_score, getCompleteness(r.content, r.summary))
);

test("Signal values spread across the card set (variance > 0)", () => {
  const distinct = new Set(signals);
  assert.ok(distinct.size > 1, `expected >1 distinct Signal, got ${[...distinct].join(",")}`);
  // The old behavior produced a single value (5.0) for every headline row.
  assert.notDeepEqual([...distinct], [5]);
});

test("Signal equals native relevance_score, independent of completeness", () => {
  assert.equal(getAdjustedScore(10, "headline"), 10);
  assert.equal(getAdjustedScore(10, "summary"), 10);
  assert.equal(getAdjustedScore(10, "full"), 10);
  // De-saturated grader: a re-scored 9 reads 9, an 8 reads 8, with no penalty.
  assert.equal(getAdjustedScore(9, "headline"), 9);
  assert.equal(getAdjustedScore(9, "full"), 9);
  assert.equal(getAdjustedScore(8, "headline"), 8);
  assert.equal(getAdjustedScore(7, "headline"), 7);
});

test("a headline-only item keeps its native score (completeness is a badge only)", () => {
  // getCompleteness(null, short summary) -> "headline". The score is unchanged.
  const completeness = getCompleteness(null, "short snippet");
  assert.equal(completeness, "headline");
  assert.equal(getAdjustedScore(9, completeness), 9);
  assert.equal(getAdjustedScore(8, completeness), 8);
});

test("a content-NULL relevance-10 breaker is NOT suppressed below weaker items", () => {
  const breaker = getAdjustedScore(10, getCompleteness(null, "short")); // headline
  const weakerFull = getAdjustedScore(9, getCompleteness("z".repeat(900), null)); // full
  assert.equal(breaker, 10);
  assert.ok(
    breaker! > weakerFull!,
    `headline breaker (${breaker}) must outrank a weaker full-text item (${weakerFull})`
  );
});

test("null relevance still yields null (render hides the pill)", () => {
  assert.equal(getAdjustedScore(null, "headline"), null);
  assert.equal(getAdjustedScore(undefined, "full"), null);
});
