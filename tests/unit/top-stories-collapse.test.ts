// Unit tests for same-event collapse in Top Stories (src/lib/top-stories.ts).
//
// The fixtures are REAL rows, copied from the live Top Stories candidate pool
// on 2026-09-02 and from the 7-day replay described in
// docs/recon/2026-09-02-clustered-top-stories-and-fact-layer-scope.md. Titles,
// sources and primary_company values are verbatim. That matters: the bug this
// fixes was a 0.038 miss against a threshold, and a synthetic fixture would not
// have reproduced it.
//
// Run: node --test tests/unit/top-stories-collapse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collapseSameEvent,
  collapseSameEventGroups,
  SAME_EVENT_TITLE_SIMILARITY,
  LEGACY_SAME_EVENT_TITLE_SIMILARITY,
  TOP_STORIES_COLLAPSE,
  TOP_STORIES_RANK_COLUMNS,
  type TopStoryRankRow,
} from "../../src/lib/top-stories.ts";
import { SAME_STORY_TITLE_SIMILARITY } from "../../src/lib/clustering-utils.ts";

const row = (o: Partial<TopStoryRankRow> & { id: string }): TopStoryRankRow => ({
  title: null,
  source: null,
  published_at: "2026-09-02T10:00:00Z",
  ingested_at: "2026-09-02T12:00:00Z",
  primary_company: null,
  relevance_score: 10,
  ...o,
});

// ── The live 2026-09-02 pool, trimmed to the rows that decide the outcome ────
const GOPRO_MERGE = row({
  id: "a-gopro-merge",
  title: "GoPro to Merge With Starman Optical in $285 Million Deal, Pivots Toward AI and Defense Markets",
  source: "Google News (GPRO)",
  primary_company: "GoPro",
  published_at: "2026-09-02T08:00:00Z",
});
const GOPRO_ACQUIRED = row({
  id: "b-gopro-acquired",
  title: "GoPro to be acquired by Starman Optical in $285 million deal",
  source: "Google News (GPRO)",
  primary_company: "GoPro",
  published_at: "2026-09-02T09:00:00Z",
});
const GOPRO_FT = row({
  id: "c-gopro-ft",
  title: "Struggling GoPro sells majority stake to optical maker Starman for $285 million",
  source: "FT Tech", // no gnews ticker — the row the old conjunct excluded
  primary_company: "GoPro",
  published_at: "2026-09-02T09:30:00Z",
});
const LILLY_YAHOO = row({
  id: "d-lilly-yahoo",
  title: "Eli Lilly to Buy Immunology Biotech Merida Biosciences in $2.9B Deal",
  source: "Yahoo",
  primary_company: "Eli Lilly",
});
const LILLY_GNEWS = row({
  id: "e-lilly-gnews",
  title: "Eli Lilly Buys Merida Biosciences For $2.9 Billion To Boost Immunology Pipeline",
  source: "Google News (LLY)",
  primary_company: "Eli Lilly",
});
const BIOXCEL = row({
  id: "f-bioxcel",
  title: "BioXcel files for bankruptcy, will sell assets to Teva for up to $125M",
  source: "Google News (TEVA)",
  primary_company: "BioXcel Therapeutics",
});

test("the shared threshold is ONE constant, not two", () => {
  // The whole point of importing from clustering-utils. If someone replaces the
  // re-export with a literal, this fails.
  assert.equal(SAME_EVENT_TITLE_SIMILARITY, SAME_STORY_TITLE_SIMILARITY);
  assert.equal(SAME_EVENT_TITLE_SIMILARITY, 0.35);
  assert.equal(TOP_STORIES_COLLAPSE.titleSimilarity, SAME_STORY_TITLE_SIMILARITY);
});

test("REGRESSION: the shipped 0.5 predicate leaves the GoPro duplicate in the list", () => {
  // This is the bug, pinned. Under the old settings the two GoPro rows survive
  // as separate stories, which is what put the same deal in slots 1 and 4.
  const kept = collapseSameEvent([GOPRO_MERGE, GOPRO_ACQUIRED, GOPRO_FT], {
    requireSameFeedTicker: true,
    titleSimilarity: LEGACY_SAME_EVENT_TITLE_SIMILARITY,
  });
  assert.equal(kept.length, 3, "old predicate should collapse nothing here");
});

test("the Top Stories predicate collapses the GoPro event to one story", () => {
  const groups = collapseSameEventGroups(
    [GOPRO_MERGE, GOPRO_ACQUIRED, GOPRO_FT],
    TOP_STORIES_COLLAPSE,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].others.length, 2);
});

test("dropping the feed-ticker conjunct is what pulls in the non-gnews row", () => {
  // FT Tech has no "Google News (X)" label, so under the old conjunct it could
  // never join ANY cluster regardless of threshold. Isolate that one variable.
  const withTicker = collapseSameEventGroups([GOPRO_ACQUIRED, GOPRO_FT], {
    requireSameFeedTicker: true,
    titleSimilarity: SAME_EVENT_TITLE_SIMILARITY,
  });
  assert.equal(withTicker.length, 2, "ticker conjunct keeps the FT row separate");

  const withoutTicker = collapseSameEventGroups([GOPRO_ACQUIRED, GOPRO_FT], {
    requireSameFeedTicker: false,
    titleSimilarity: SAME_EVENT_TITLE_SIMILARITY,
  });
  assert.equal(withoutTicker.length, 1);
});

test("a full pool yields one entry per event and backfills the rendered list", () => {
  const groups = collapseSameEventGroups(
    [GOPRO_MERGE, GOPRO_ACQUIRED, BIOXCEL, GOPRO_FT, LILLY_YAHOO, LILLY_GNEWS],
    TOP_STORIES_COLLAPSE,
  );
  assert.equal(groups.length, 3, "GoPro, BioXcel, Eli Lilly");
  // Ordering is the input ordering, keyed on each group's best-placed member.
  assert.deepEqual(
    groups.map((g) => g.survivor.primary_company),
    ["GoPro", "BioXcel Therapeutics", "Eli Lilly"],
  );
  // Slot 3 is now a DISTINCT story rather than a second GoPro row.
  assert.notEqual(groups[2].survivor.primary_company, groups[0].survivor.primary_company);
});

test("different subjects never merge, whatever the titles say", () => {
  // The subject gate is the safety property. Two identical titles on different
  // companies must stay apart.
  const a = row({ id: "x", title: "Q2 Earnings Beat Estimates", primary_company: "Alpha Corp" });
  const b = row({ id: "y", title: "Q2 Earnings Beat Estimates", primary_company: "Beta Corp" });
  assert.equal(collapseSameEventGroups([a, b], TOP_STORIES_COLLAPSE).length, 2);
});

test("a null subject never clusters", () => {
  const a = row({ id: "x", title: "Q2 Earnings Beat Estimates", primary_company: null });
  const b = row({ id: "y", title: "Q2 Earnings Beat Estimates", primary_company: null });
  assert.equal(collapseSameEventGroups([a, b], TOP_STORIES_COLLAPSE).length, 2);
});

test("the 48h window still bounds a cluster", () => {
  const a = row({ ...GOPRO_ACQUIRED, id: "x", published_at: "2026-09-02T09:00:00Z" });
  const b = row({ ...GOPRO_MERGE, id: "y", published_at: "2026-08-28T09:00:00Z" });
  assert.equal(collapseSameEventGroups([a, b], TOP_STORIES_COLLAPSE).length, 2);
});

// ── survivor rule ────────────────────────────────────────────────────────────

test("survivor: relevance_score wins first and is never overridden", () => {
  const low = row({ ...GOPRO_MERGE, id: "a", relevance_score: 4, content_type: "full_text" });
  const high = row({ ...GOPRO_ACQUIRED, id: "b", relevance_score: 10, content_type: "snippet" });
  const [g] = collapseSameEventGroups([low, high], TOP_STORIES_COLLAPSE);
  assert.equal(g.survivor.id, "b", "a prose row must NOT beat a higher-ranked one");
});

test("survivor: at equal relevance, prose beats headline-only", () => {
  const snippet = row({ ...GOPRO_MERGE, id: "a", content_type: "snippet" });
  const prose = row({ ...GOPRO_ACQUIRED, id: "b", content_type: "full_text" });
  const [g] = collapseSameEventGroups([snippet, prose], TOP_STORIES_COLLAPSE);
  assert.equal(g.survivor.id, "b");
});

test("survivor: an absent content_type is treated as no preference", () => {
  // watchlist-brief builds rank rows from TOP_STORIES_COLUMNS, which does not
  // select content_type. An undefined column must not change any pick.
  const a = row({ ...GOPRO_MERGE, id: "a" });
  const b = row({ ...GOPRO_ACQUIRED, id: "b" });
  const withUndef = collapseSameEventGroups([a, b], TOP_STORIES_COLLAPSE)[0].survivor.id;
  const withSnippets = collapseSameEventGroups(
    [{ ...a, content_type: "snippet" }, { ...b, content_type: "snippet" }],
    TOP_STORIES_COLLAPSE,
  )[0].survivor.id;
  assert.equal(withUndef, withSnippets);
});

test("survivor: falls through to title completeness, then earliest, then id", () => {
  const short = row({ ...GOPRO_ACQUIRED, id: "z-short" });
  const long = row({ ...GOPRO_MERGE, id: "a-long" });
  const [g] = collapseSameEventGroups([short, long], TOP_STORIES_COLLAPSE);
  assert.equal(g.survivor.id, "a-long", "the more specific headline wins");

  // Fully tied on 1-4 => lowest id, deterministically.
  const t1 = row({ ...GOPRO_MERGE, id: "bbb" });
  const t2 = row({ ...GOPRO_MERGE, id: "aaa" });
  assert.equal(collapseSameEventGroups([t1, t2], TOP_STORIES_COLLAPSE)[0].survivor.id, "aaa");
});

test("survivor selection is order-independent and repeatable", () => {
  const pool = [GOPRO_MERGE, GOPRO_ACQUIRED, GOPRO_FT];
  const forward = collapseSameEventGroups(pool, TOP_STORIES_COLLAPSE)[0].survivor.id;
  const reversed = collapseSameEventGroups([...pool].reverse(), TOP_STORIES_COLLAPSE)[0].survivor.id;
  assert.equal(forward, reversed, "the pick must not depend on input order");
  assert.equal(forward, collapseSameEventGroups(pool, TOP_STORIES_COLLAPSE)[0].survivor.id);
});

test("`others` is ordered by the same rule, best first", () => {
  const [g] = collapseSameEventGroups(
    [GOPRO_ACQUIRED, GOPRO_FT, GOPRO_MERGE],
    TOP_STORIES_COLLAPSE,
  );
  const all = [g.survivor, ...g.others];
  assert.equal(new Set(all.map((r) => r.id)).size, 3, "no member lost or duplicated");
  assert.equal(g.others.length, 2);
});

// ── the watchlist-brief path must be untouched ───────────────────────────────

test("collapseSameEvent defaults to the PRE-change predicate", () => {
  // src/lib/watchlist-brief.ts calls collapseSameEvent(rows) with no options.
  // If these defaults ever move, the brief email's content changes silently.
  const noOptions = collapseSameEvent([GOPRO_MERGE, GOPRO_ACQUIRED, GOPRO_FT]);
  const explicitOld = collapseSameEvent([GOPRO_MERGE, GOPRO_ACQUIRED, GOPRO_FT], {
    requireSameFeedTicker: true,
    titleSimilarity: LEGACY_SAME_EVENT_TITLE_SIMILARITY,
  });
  assert.deepEqual(noOptions.map((r) => r.id), explicitOld.map((r) => r.id));
  assert.equal(noOptions.length, 3);
  assert.equal(LEGACY_SAME_EVENT_TITLE_SIMILARITY, 0.5);
});

test("collapseSameEvent returns exactly the survivors of collapseSameEventGroups", () => {
  const pool = [GOPRO_MERGE, GOPRO_ACQUIRED, BIOXCEL, GOPRO_FT, LILLY_YAHOO, LILLY_GNEWS];
  assert.deepEqual(
    collapseSameEvent(pool, TOP_STORIES_COLLAPSE).map((r) => r.id),
    collapseSameEventGroups(pool, TOP_STORIES_COLLAPSE).map((g) => g.survivor.id),
  );
});

// ── the ranking query must stay cheap ────────────────────────────────────────

test("RANK_COLUMNS carries content_type and NOT the wide columns", () => {
  // sql/0023 documents that carrying `content`/`summary` through this sort took
  // it past the statement timeout. Pin the column list so a future edit that
  // adds a wide column to satisfy some new tiebreak fails here first.
  assert.match(TOP_STORIES_RANK_COLUMNS, /\bcontent_type\b/);
  assert.doesNotMatch(TOP_STORIES_RANK_COLUMNS, /(^|,)\s*content\s*(,|$)/);
  assert.doesNotMatch(TOP_STORIES_RANK_COLUMNS, /(^|,)\s*summary\s*(,|$)/);
});
