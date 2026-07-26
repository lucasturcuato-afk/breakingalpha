/**
 * Unit tests for company-cik-preference.ts and the rankCluster ordering that
 * consumes it. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/company-cik-preference.test.ts
 *
 * The fixtures are the real production clusters where the page and the API
 * disagreed. TSM is the headline: 439 mentions on the CIK-less row versus 201
 * on the filer row, which is why mention-count ranking sent the page to the
 * wrong place.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCik, compareCikFirst, preferCik } from "./company-cik-preference";
import { rankCluster } from "./data-access/aliasResolver";
import type { ResolverRow } from "./data-access/aliasResolver";

function row(
  name: string,
  mention_count: number | null,
  sec_cik: number | null,
  extra: Partial<ResolverRow> = {},
): ResolverRow {
  return {
    id: extra.id ?? `id-${name.toLowerCase().replace(/\W+/g, "-")}`,
    name,
    ticker: extra.ticker ?? null,
    sector: null,
    mention_count,
    key_themes: null,
    first_seen: extra.first_seen ?? null,
    last_updated: extra.last_updated ?? null,
    sec_cik,
  };
}

// Real production rows, ticker TSM.
const TSMC = row("TSMC", 439, null, { ticker: "TSM" });
const TAIWAN_SEMI = row("Taiwan Semiconductor", 201, 1046179, { ticker: "TSM" });

test("hasCik distinguishes a filer row from a name fragment", () => {
  assert.equal(hasCik(TAIWAN_SEMI), true);
  assert.equal(hasCik(TSMC), false);
  // 0 is a real CIK-shaped value and must not be treated as absent.
  assert.equal(hasCik({ sec_cik: 0 }), true);
  assert.equal(hasCik({ sec_cik: undefined }), false);
});

test("prefer-CIK wins over a higher mention count: the live TSM case", () => {
  // Input order deliberately puts the higher-mention CIK-less row first, which
  // is what the old mention_count sort produced.
  const ranked = rankCluster([TSMC, TAIWAN_SEMI]);
  assert.equal(ranked[0].name, "Taiwan Semiconductor");
  assert.equal(ranked[0].sec_cik, 1046179);
  // The fragment survives as a sibling; it is demoted, never dropped.
  assert.equal(ranked[1].name, "TSMC");
  assert.equal(ranked.length, 2);
});

test("the other three live splits rank to the filer row", () => {
  const cases: Array<[ResolverRow[], string]> = [
    [[row("Peloton", 26, null), row("Peloton Interactive Inc.", 15, 1639825)], "Peloton Interactive Inc."],
    [[row("Rigetti", 74, null), row("Gett", 1, 1838359)], "Gett"],
    [[row("Gemini", 21, null), row("Gemini Space Station, Inc.", 17, 2055592)], "Gemini Space Station, Inc."],
  ];
  for (const [cluster, expected] of cases) {
    assert.equal(rankCluster(cluster)[0].name, expected);
  }
});

test("all-null cluster falls back to mention_count exactly as before", () => {
  // Samsung: four real rows under ticker SSNLF, no CIK on any of them.
  const samsung = [
    row("Samsung Electronics Co. Ltd.", 3, null),
    row("Samsung", 130, null),
    row("Samsung Electronics Co.", 13, null),
    row("Samsung Electronics", 26, null),
  ];
  const ranked = rankCluster(samsung);
  assert.deepEqual(
    ranked.map((r) => r.name),
    ["Samsung", "Samsung Electronics", "Samsung Electronics Co.", "Samsung Electronics Co. Ltd."],
  );
});

test("single-row clusters are unchanged whether or not they carry a CIK", () => {
  const withCik = [row("Caterpillar", 197, 18230, { ticker: "CAT" })];
  assert.deepEqual(rankCluster(withCik), withCik);

  const withoutCik = [row("Some Private Co", 4, null)];
  assert.deepEqual(rankCluster(withoutCik), withoutCik);

  assert.deepEqual(rankCluster([]), []);
});

test("among several CIK-bearing rows the old hierarchy still decides", () => {
  // Two filers in one cluster: mention_count breaks the tie, as before.
  const ranked = rankCluster([row("Filer Low", 5, 111), row("Filer High", 90, 222)]);
  assert.equal(ranked[0].name, "Filer High");
});

test("mention_count nulls sort below zero, preserving prior behavior", () => {
  const ranked = rankCluster([row("Unknown", null, null), row("Zero", 0, null)]);
  assert.equal(ranked[0].name, "Zero");
});

test("ranking is stable and deterministic on full ties", () => {
  const a = row("Alpha", 10, null, { id: "id-a" });
  const b = row("Beta", 10, null, { id: "id-b" });
  assert.equal(rankCluster([b, a])[0].id, "id-a", "id is the final tiebreaker");
  assert.equal(rankCluster([a, b])[0].id, "id-a", "and it does not depend on input order");
});

test("rankCluster does not mutate its input", () => {
  const input = [TSMC, TAIWAN_SEMI];
  const before = input.map((r) => r.name);
  rankCluster(input);
  assert.deepEqual(input.map((r) => r.name), before);
});

test("compareCikFirst is a pure fragment: equal on same-side pairs", () => {
  assert.equal(compareCikFirst(TAIWAN_SEMI, TSMC) < 0, true);
  assert.equal(compareCikFirst(TSMC, TAIWAN_SEMI) > 0, true);
  assert.equal(compareCikFirst(TSMC, row("Other", 1, null)), 0);
  assert.equal(compareCikFirst(TAIWAN_SEMI, row("Other", 1, 999)), 0);
});

test("preferCik keeps the caller's order and only promotes a CIK row", () => {
  // This is the sec-filings.ts contract, unchanged by the extraction.
  assert.equal(preferCik([TSMC, TAIWAN_SEMI])?.name, "Taiwan Semiconductor");
  assert.equal(preferCik([TSMC, row("Other", 1, null)])?.name, "TSMC", "no CIK anywhere: first row wins");
  assert.equal(preferCik([]), null);
});

test("page and API agree on the TSM cluster after the change", () => {
  // The API path is preferCik over its own candidate order; the page path is
  // rankCluster. Both must land on the same row, which is the whole point.
  const cluster = [TSMC, TAIWAN_SEMI];
  assert.equal(rankCluster(cluster)[0].id, preferCik(cluster)?.id);
});
