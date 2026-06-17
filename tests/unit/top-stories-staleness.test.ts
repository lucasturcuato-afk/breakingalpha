// Unit tests for A1: republish-staleness in Top Stories.
// (src/lib/top-stories.ts collapseSameEvent + rankByFreshness)
//
// An old event re-emitted with a fresh feed pubDate used to escape same-event
// collapse (the 48h window) and surface as a separate "today" card pinned to the
// top by the relevance-saturated sort. The fix: collapse within the content-age
// ceiling, stamp the representative with the cluster's EARLIEST published_at
// (true event age), and rank with an event-age penalty so a stale event cannot
// pin to the top tier.
//
// Run: node --test tests/unit/top-stories-staleness.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collapseSameEvent,
  rankByFreshness,
  type TopStoryRow,
} from "../../src/lib/top-stories.ts";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function row(p: Partial<TopStoryRow> & Pick<TopStoryRow, "id">): TopStoryRow {
  return {
    title: null,
    source: null,
    summary: null,
    content: null,
    sector: null,
    industry_verticals: null,
    activity_types: null,
    sentiment: null,
    published_at: null,
    ingested_at: daysAgo(0),
    url: null,
    companies: null,
    primary_company: null,
    relevance_score: null,
    ...p,
  };
}

// One event (YYGH up ~60%) that broke 6 days ago, syndicated then, and re-emitted
// TODAY by a fresh feed (the bug). Same ticker + subject, near-identical titles.
const republishToday = row({
  id: "yygh-msn-today",
  source: "Google News (YYGH)",
  primary_company: "YY Group",
  relevance_score: 10,
  published_at: daysAgo(0),
  ingested_at: daysAgo(0),
  title: "Why Is YYGH Stock Soaring Nearly 60% Premarket Today? - MSN",
});
const original6dA = row({
  id: "yygh-yahoo-6d",
  source: "Google News (YYGH)",
  primary_company: "YY Group",
  relevance_score: 10,
  published_at: daysAgo(6),
  ingested_at: daysAgo(6),
  title: "Why Is YYGH Stock Soaring Nearly 60% Premarket Today? - Yahoo Finance",
});
const original6dB = row({
  id: "yygh-tv-6d",
  source: "Google News (YYGH)",
  primary_company: "YY Group",
  relevance_score: 9,
  published_at: daysAgo(6),
  ingested_at: daysAgo(6),
  title: "Why Is YYGH Stock Soaring Nearly 60% Premarket Today? - TradingView",
});
// Genuinely fresh, distinct events from today.
const freshNvda = row({
  id: "nvda-today",
  source: "Google News (NVDA)",
  primary_company: "Nvidia",
  relevance_score: 10,
  published_at: daysAgo(0),
  ingested_at: daysAgo(0),
  title: "Nvidia announces record data center revenue today",
});
const freshAapl = row({
  id: "aapl-today",
  source: "Google News (AAPL)",
  primary_company: "Apple",
  relevance_score: 9,
  published_at: daysAgo(0),
  ingested_at: daysAgo(0),
  title: "Apple unveils new accelerator chip at fall event today",
});

const isYYGH = (r: TopStoryRow) => (r.source ?? "").includes("YYGH");

test("the fresh-dated republish collapses into the older event (one YYGH survivor)", () => {
  const out = collapseSameEvent([republishToday, original6dA, original6dB, freshNvda, freshAapl]);
  assert.equal(out.filter(isYYGH).length, 1, "the 3 YYGH rows must collapse to one");
  assert.equal(out.length, 3, "YYGH cluster + NVDA + AAPL = 3 distinct stories");
});

test("the representative's displayed recency is the EVENT age, not today", () => {
  const out = collapseSameEvent([republishToday, original6dA, original6dB]);
  assert.equal(out.length, 1);
  const ageDays = (Date.now() - new Date(out[0].published_at!).getTime()) / DAY;
  assert.ok(ageDays > 5, `representative should read ~6d old, got ${ageDays.toFixed(2)}d`);
});

test("a stale event cannot pin to the top tier (freshness rank demotes it)", () => {
  const collapsed = collapseSameEvent([
    republishToday,
    original6dA,
    original6dB,
    freshNvda,
    freshAapl,
  ]);
  const ranked = rankByFreshness(collapsed);
  assert.ok(!isYYGH(ranked[0]), "top card must not be the 6-day-old event");
  const yyghIdx = ranked.findIndex(isYYGH);
  const nvdaIdx = ranked.findIndex((r) => r.id === "nvda-today");
  const aaplIdx = ranked.findIndex((r) => r.id === "aapl-today");
  assert.ok(nvdaIdx < yyghIdx, "fresh relevance-10 outranks the 6-day relevance-10 event");
  assert.ok(aaplIdx < yyghIdx, "fresh relevance-9 outranks the 6-day relevance-10 event");
});

test("the top is no longer a flat block of relevance-10 (Signal/rank spread)", () => {
  const ranked = rankByFreshness(
    collapseSameEvent([republishToday, original6dA, original6dB, freshNvda, freshAapl])
  );
  const order = ranked.map((r) => r.id);
  // Fresh NVDA (10, today) first; the 6-day YYGH event last despite relevance 10.
  assert.equal(order[0], "nvda-today");
  assert.equal(order[order.length - 1].startsWith("yygh"), true);
});

test("widening the window does NOT over-merge a distinct same-company event", () => {
  const distinctOffering = row({
    id: "yygh-offering-2d",
    source: "Google News (YYGH)",
    primary_company: "YY Group",
    relevance_score: 8,
    published_at: daysAgo(2),
    ingested_at: daysAgo(2),
    title: "YY Group prices secondary offering to fund expansion - Reuters",
  });
  const out = collapseSameEvent([original6dA, distinctOffering]);
  assert.equal(out.length, 2, "different events (low title Jaccard) must not merge");
});
