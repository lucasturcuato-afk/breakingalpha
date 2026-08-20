/**
 * Unit tests for the article-cluster expansion: the normalized company key,
 * the union builder, the hard cap, and the contaminated-ticker gate.
 * Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/company-cluster-variants.test.ts
 *
 * Every fixture below is a real production shape read from prod on 2026-08-18,
 * not an invention. The contaminated tickers in particular are live rows: one
 * `companies.ticker` value carrying two unrelated companies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanyKey, sameCompanyKey } from "./company-cluster-key";
import {
  buildClusterVariants,
  casingForms,
  MAX_CLUSTER_VARIANTS,
  MAX_PREDICATE_BYTES,
  type ClusterCandidate,
} from "./company-cluster-variants";
import { buildCompanyContainsOr, getCompanyVariants } from "./company-intel";

function cand(
  name: string,
  mentionCount: number | null,
  source: ClusterCandidate["source"] = "widened",
): ClusterCandidate {
  return { name, mentionCount, source };
}

// ---------------------------------------------------------------------------
// normalizeCompanyKey: parity with backend/company_match.py
// ---------------------------------------------------------------------------

test("normalizeCompanyKey strips trailing corporate suffixes", () => {
  assert.equal(normalizeCompanyKey("Bank of America Corp"), "bank of america");
  assert.equal(normalizeCompanyKey("Bank of America Corporation"), "bank of america");
  assert.equal(normalizeCompanyKey("Bank of America Corp."), "bank of america");
  assert.equal(normalizeCompanyKey("Targa Resources, Inc."), "targa resources");
  assert.equal(normalizeCompanyKey("ILLUMINA, INC."), "illumina");
  assert.equal(normalizeCompanyKey("SEI Investments Company"), "sei investments");
  assert.equal(normalizeCompanyKey("Alphabet Inc"), "alphabet");
});

test("normalizeCompanyKey folds punctuation, casing and ampersands", () => {
  assert.equal(normalizeCompanyKey("Wells Fargo & Company"), "wells fargo");
  assert.equal(normalizeCompanyKey("Wells Fargo & Co."), "wells fargo");
  assert.equal(normalizeCompanyKey("Parker-Hannifin Corporation"), "parker hannifin");
  assert.equal(normalizeCompanyKey("Parker Hannifin"), "parker hannifin");
  assert.equal(normalizeCompanyKey("BANK OF AMERICA"), "bank of america");
  assert.equal(normalizeCompanyKey("Moody’s Analytics"), "moodys analytics");
});

test("normalizeCompanyKey strips up to three suffix passes but never empties", () => {
  assert.equal(normalizeCompanyKey("Acme Holdings Group Inc"), "acme");
  // Port of the Python empty guard: a bare suffix word survives.
  assert.equal(normalizeCompanyKey("Inc."), "inc");
  assert.equal(normalizeCompanyKey("Group"), "group");
  assert.equal(normalizeCompanyKey(""), "");
});

test("sameCompanyKey separates the live contaminated pairs", () => {
  assert.equal(sameCompanyKey("Gett", "Rigetti"), false);
  assert.equal(sameCompanyKey("Stran", "Astrana Health"), false);
  assert.equal(sameCompanyKey("MMV", "Commvault Systems"), false);
  assert.equal(sameCompanyKey("SCA", "Bitcoin"), false);
  assert.equal(sameCompanyKey("CHAMP", "ChampionX"), false);
  assert.equal(sameCompanyKey("Trump", "Trump Media"), false);
  assert.equal(sameCompanyKey("BCG", "Kingswood"), false);
  // ...while still folding the suffix/casing variants it must fold.
  assert.equal(sameCompanyKey("Bank of America", "Bank of America Corp"), true);
  assert.equal(sameCompanyKey("Parker Hannifin", "Parker-Hannifin Corporation"), true);
});

// ---------------------------------------------------------------------------
// casingForms
// ---------------------------------------------------------------------------

test("casingForms emits the stored spellings ingest actually writes", () => {
  const boa = casingForms("Bank of America");
  assert.ok(boa.includes("Bank of America"));
  assert.ok(boa.includes("Bank Of America"), "Title Case capitalizes 'Of' (10 live rows)");
  assert.ok(boa.includes("BANK OF AMERICA"));
  // "SEI INVESTMENTS CO" is the stored form; "SEI Investments Co" is the one
  // articles carry. ALL-CAPS-first + Title rest is what bridges them.
  assert.ok(casingForms("SEI INVESTMENTS CO").includes("SEI Investments Co"));
  assert.ok(casingForms("parker-hannifin").includes("Parker-Hannifin"));
  assert.deepEqual(casingForms("   "), []);
});

test("casingForms is deduped and leads with the stored form", () => {
  const f = casingForms("AMD");
  assert.equal(f[0], "AMD");
  assert.equal(new Set(f).size, f.length);
});

// ---------------------------------------------------------------------------
// Union builder
// ---------------------------------------------------------------------------

test("union builder covers head, siblings, alias rows and widened rows", () => {
  const r = buildClusterVariants("Bank of America", [
    cand("Bank of America", 402, "head"),
    cand("Bank of America", 402, "alias"),
    cand("Bank of America Corp", 155),
    cand("Bank of America Corporation", 55),
    cand("Bank of America Corp.", 3),
  ]);
  assert.deepEqual(r.baseForms, [
    "Bank of America",
    "Bank of America Corp",
    "Bank of America Corporation",
    "Bank of America Corp.",
  ]);
  for (const v of [
    "Bank of America",
    "Bank Of America",
    "BANK OF AMERICA",
    "Bank of America Corp",
    "Bank Of America Corporation",
  ]) {
    assert.ok(r.variants.includes(v), `expected variant ${v}`);
  }
  assert.equal(r.truncated, false);
  assert.equal(r.droppedVariantCount, 0);
});

test("union builder is a strict superset of today's head-only variants", () => {
  for (const head of ["Bank of America", "Wells Fargo", "Nvidia", "Targa Resources"]) {
    const r = buildClusterVariants(head, [cand(head, 100, "head")]);
    for (const v of getCompanyVariants(head)) {
      assert.ok(r.variants.includes(v), `${head}: lost pre-existing variant ${v}`);
    }
  }
});

test("union builder dedupes case-sensitively: casing variants are meaningful", () => {
  const r = buildClusterVariants("Nvidia", [
    cand("Nvidia", 2273, "head"),
    cand("NVIDIA Corporation", 68),
    cand("Nvidia Corp.", 68),
  ]);
  assert.equal(new Set(r.variants).size, r.variants.length, "no duplicates");
  assert.ok(r.variants.includes("Nvidia"));
  assert.ok(r.variants.includes("NVIDIA"), "ALL CAPS is a distinct stored element");
});

test("union builder priority order is head first, then mention_count desc, then name asc", () => {
  const r = buildClusterVariants("Acme", [
    cand("Acme Corp", 5),
    cand("Acme Inc", 50),
    cand("Acme", 1, "head"),
    cand("Acme Company", 5),
  ]);
  assert.deepEqual(r.baseForms, ["Acme", "Acme Inc", "Acme Company", "Acme Corp"]);
  assert.equal(r.variants[0], "Acme");
});

test("union builder produces a valid, non-empty PostgREST predicate for a blank head", () => {
  const r = buildClusterVariants("", []);
  assert.ok(r.variants.length > 0);
  assert.notEqual(buildCompanyContainsOr(r.variants), "");
});

// ---------------------------------------------------------------------------
// Cap / truncation
// ---------------------------------------------------------------------------

test("cap truncates deterministically and counts what it dropped", () => {
  // All fold onto "acme holdings", so the gate keeps them and only the cap bites.
  const forms = Array.from({ length: 40 }, (_, i) => cand(`Acme Holdings ${i % 2 ? "Corp" : "Inc"}`, 40 - i));
  const uncapped = buildClusterVariants("Acme Holdings", [cand("Acme Holdings", 99, "head"), ...forms]);
  assert.equal(uncapped.truncated, false);

  const capped = buildClusterVariants(
    "Acme Holdings",
    [cand("Acme Holdings", 99, "head"), ...forms],
    { maxVariants: 3 },
  );
  assert.equal(capped.variants.length, 3);
  assert.equal(capped.truncated, true);
  assert.equal(capped.droppedVariantCount, uncapped.variants.length - 3);
  // Deterministic prefix: the capped set is the head of the uncapped set.
  assert.deepEqual(capped.variants, uncapped.variants.slice(0, 3));
  // Re-running gives the identical answer.
  assert.deepEqual(
    buildClusterVariants("Acme Holdings", [cand("Acme Holdings", 99, "head"), ...forms], { maxVariants: 3 }).variants,
    capped.variants,
  );
});

// TITLE CORRECTED. This test used to be named "cap never drops the
// pre-existing head variant, so nothing visible today disappears". The clause
// after the comma was false and this test never tested it. What it proves is
// that the VARIANT cap keeps the pre-existing head variant. Rows visible today
// CAN still disappear, because getCompanyDetail applies a separate
// ARTICLE_LIMIT = 50 to the widened match set: measured, 159 rendered rows
// leave across 39 heads while 1,807 enter. See company-cluster-variants.ts.
test("cap never drops the pre-existing head variant", () => {
  const forms = [cand("Bank of America Corp", 155), cand("Bank of America Corporation", 55)];
  const capped = buildClusterVariants("Bank of America", [cand("Bank of America", 402, "head"), ...forms], {
    maxVariants: 1,
  });
  assert.deepEqual(capped.variants, ["Bank of America"]);
  assert.equal(capped.truncated, true);
});

// Every one of these folds back onto the bare head key, so they all survive
// the gate and the only thing that can stop them is the cap.
const LEGAL_SUFFIXES = [
  "Inc", "Inc.", ", Inc.", "Incorporated", "Corp", "Corp.", "Corporation",
  "Co", "Co.", "Company", "& Company", "LLC", "Ltd", "Ltd.", "Limited",
  "PLC", "Holdings", "Group", "SE", "SpA", "Oyj", "ASA",
];
function suffixForms(head: string): ClusterCandidate[] {
  return LEGAL_SUFFIXES.map((sfx, i) =>
    cand(sfx.startsWith(",") ? `${head}${sfx}` : `${head} ${sfx}`, LEGAL_SUFFIXES.length - i),
  );
}

test("byte cap bounds the encoded predicate below the configured byte budget", () => {
  const long = "Extraordinarily Long Company Name For Predicate Byte Budget Testing";
  const forms = suffixForms(long);
  const uncapped = buildClusterVariants(long, [cand(long, 999, "head"), ...forms]);
  assert.equal(uncapped.baseForms.length, forms.length + 1, "gate must keep every suffix form");

  const r = buildClusterVariants(long, [cand(long, 999, "head"), ...forms], { maxPredicateBytes: 900 });
  assert.ok(r.predicateBytes <= 900, `predicateBytes=${r.predicateBytes}`);
  assert.equal(r.truncated, true);
  assert.ok(r.droppedVariantCount > 0);
  assert.ok(encodeURIComponent(buildCompanyContainsOr(r.variants)).length <= 900);
});

// CEILING CORRECTED. This test used to assert against a 25,205-byte URL
// ceiling. That number is a SERVER-side boundary the running client never
// reaches. Three steps, only the last of which binds:
//
//   1. 25,205 bytes  server-side URI boundary, reachable only from a client
//                    with no response-header cap (curl).
//   2. ~15,482 bytes the `content-location` RESPONSE header at the last
//                    accepted size, ~15,513 at the first rejected one. On a
//                    2xx PostgREST echoes the whole query back in that header,
//                    and node/undici caps TOTAL response headers at
//                    http.maxHeaderSize = 16,384.
//   3. ~14,062 bytes the effective REQUEST-URL ceiling, which is this constant.
//
// The failure mode is a client-side throw, `TypeError: fetch failed` with
// cause UND_ERR_HEADERS_OVERFLOW, NOT a bare 400. Measured against prod on
// node v25.8.0 with the real getCompanyDetail query shape: 14,062 bytes -> 200,
// 14,119 bytes -> throw. Independently re-derived from successful requests
// only on 2026-08-20: 14,040 bytes. It is a ~14 KB number, not an exact one,
// because it moves with how much of the predicate is percent-encoded.
// See the MAX_CLUSTER_VARIANTS doc block for the full derivation.
const EFFECTIVE_URL_CEILING_BYTES = 14_062;

test("default caps are well under the effective ~14,062-byte URL ceiling", () => {
  // The predicate budget is under HALF the ceiling, so the select list, the
  // published_at filter, the order clause, the limit and the host prefix have
  // at least as many bytes again to spend. Holds against the re-derived 14,040
  // too, which is the point of leaving this much margin.
  assert.ok(MAX_PREDICATE_BYTES * 2 < EFFECTIVE_URL_CEILING_BYTES);
  assert.ok(MAX_CLUSTER_VARIANTS <= 64);
  const head = "Bank of America Holdings Group";
  const r = buildClusterVariants(head, [cand(head, 999, "head"), ...suffixForms(head)]);
  assert.ok(r.variants.length <= MAX_CLUSTER_VARIANTS, `variants=${r.variants.length}`);
  assert.ok(r.predicateBytes <= MAX_PREDICATE_BYTES);
  assert.equal(r.truncated, true, "22 suffix forms x 4 casings must exceed the 64-variant cap");
  assert.ok(
    encodeURIComponent(buildCompanyContainsOr(r.variants)).length < EFFECTIVE_URL_CEILING_BYTES,
  );
});

// ---------------------------------------------------------------------------
// Contaminated-ticker exclusion. These are the real live clusters.
// ---------------------------------------------------------------------------

const CONTAMINATED: Array<[string, string, string]> = [
  ["RGTI", "Rigetti", "Gett"],
  ["ASTH", "Astrana Health", "Stran"],
  ["CVLT", "Commvault Systems", "MMV"],
  ["GBTC", "Bitcoin", "SCA"],
  ["CHX", "ChampionX", "CHAMP"],
  ["DJT", "Trump Media", "Trump"],
  ["BCG", "BCG", "Kingswood"],
];

test("contaminated tickers: the off-entity sibling never enters the predicate", () => {
  for (const [ticker, head, other] of CONTAMINATED) {
    const r = buildClusterVariants(head, [
      cand(head, 100, "head"),
      cand(other, 1, "sibling"),
    ]);
    assert.deepEqual(r.baseForms, [head], `${ticker}: ${other} leaked into baseForms`);
    assert.deepEqual(
      r.excluded.map((e) => e.name),
      [other],
      `${ticker}: expected ${other} to be excluded and counted`,
    );
    // The gate polices what THIS expansion adds. getCompanyVariants(head) is
    // passed through untouched by design (see the comment in the builder: a
    // gate on it costs 92 correct articles to remove 1 incorrect one), so the
    // assertion is scoped to the variants the expansion contributed.
    const preExisting = new Set(getCompanyVariants(head));
    const added = r.variants.filter((v) => !preExisting.has(v));
    for (const v of added) {
      assert.notEqual(
        normalizeCompanyKey(v),
        normalizeCompanyKey(other),
        `${ticker}: expansion added "${v}", which folds onto the off-entity ${other}`,
      );
    }
  }
});

test("DJT: the bare 'Trump' variant is pre-existing head expansion, not something the cluster expansion adds", () => {
  // Documented so a future reader does not mistake it for a new leak. It comes
  // from getCompanyVariants' first-token rule and costs exactly 1 article in
  // the live 14-day window; gating it would also cost 64 TSMC articles on
  // Taiwan Semiconductor and 26 Peloton articles on Peloton Interactive.
  assert.ok(getCompanyVariants("Trump Media").includes("Trump"));
  const r = buildClusterVariants("Trump Media", [
    cand("Trump Media", 67, "head"),
    cand("Trump", 5, "sibling"),
  ]);
  assert.deepEqual(r.excluded.map((e) => e.name), ["Trump"]);
  assert.deepEqual(r.baseForms, ["Trump Media"]);
  const added = r.variants.filter((v) => !new Set(getCompanyVariants("Trump Media")).has(v));
  assert.ok(!added.includes("Trump"));
});

test("contaminated tickers: exclusion is symmetric (Gett excluded from Rigetti AND Rigetti from Gett)", () => {
  const rigetti = buildClusterVariants("Rigetti", [
    cand("Rigetti", 100, "head"),
    cand("Gett", 1, "sibling"),
  ]);
  assert.deepEqual(rigetti.baseForms, ["Rigetti"]);
  assert.deepEqual(rigetti.excluded.map((e) => e.name), ["Gett"]);
  assert.ok(!rigetti.variants.includes("Gett"));

  // rankCluster puts the CIK-bearing row first, so RGTI's live head is "Gett".
  // The gate has to work in that direction too.
  const gett = buildClusterVariants("Gett", [
    cand("Gett", 1, "head"),
    cand("Rigetti", 100, "sibling"),
  ]);
  assert.deepEqual(gett.baseForms, ["Gett"]);
  assert.deepEqual(gett.excluded.map((e) => e.name), ["Rigetti"]);
  assert.ok(!gett.variants.includes("Rigetti"));
  assert.ok(!gett.variants.some((v) => normalizeCompanyKey(v) === "rigetti"));
});

test("contaminated tickers: a loose prefix hit is dropped by the key gate, not by luck", () => {
  // The widened alias lookup uses prefix "trump", which really does return
  // "Trump Media" rows when the head is "Trump". The gate is what stops them.
  const r = buildClusterVariants("Trump", [
    cand("Trump", 5, "head"),
    cand("Trump Media", 67),
    cand("Trump Media & Technology Group", 12),
  ]);
  assert.deepEqual(r.baseForms, ["Trump"]);
  assert.equal(r.excluded.length, 2);
  assert.deepEqual(r.excluded.map((e) => e.source), ["widened", "widened"]);
});

test("gate keeps genuine suffix and casing kin while dropping the impostor", () => {
  const r = buildClusterVariants("Commvault Systems", [
    cand("Commvault Systems", 42, "head"),
    cand("CommVault Systems, Inc.", 20),
    cand("CommVault Systems Inc", 8),
    cand("MMV", 1, "sibling"),
  ]);
  assert.deepEqual(r.baseForms, [
    "Commvault Systems",
    "CommVault Systems, Inc.",
    "CommVault Systems Inc",
  ]);
  assert.deepEqual(r.excluded.map((e) => e.name), ["MMV"]);
});
