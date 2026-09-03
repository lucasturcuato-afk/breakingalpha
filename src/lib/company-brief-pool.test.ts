/**
 * Unit tests for the Company Brief article pool: matchesCanonical, the pool
 * filter that consumes it, and the empty-pool copy. Pure, deterministic, no
 * network.
 * Run: npx tsx --test src/lib/company-brief-pool.test.ts
 *
 * WHAT THESE PIN, and why the fixtures are the shapes they are.
 *
 * The page resolves a slug to `companies.name` off the ranked cluster head
 * (getCompanyDetail returns `canonical: head.name`) and keys the brief on that
 * string. That string is REGULARLY AN ALIAS SURFACE FORM rather than a
 * canonical one: the SOFI row is stored "SoFi Technologies" and CANONICAL maps
 * "sofi technologies" -> "SoFi". matchesCanonical put the article side through
 * canonicalize() and left the target side raw, so the tag collapsed to "sofi",
 * the target stayed "sofi technologies", and the predicate answered FALSE for a
 * tag against ITSELF. Both article reads select rows with
 * `companies @> {getCompanyVariants(name)[0]}`, which is that same name, so
 * every row the database had just returned was discarded in memory.
 *
 * The article fixtures below are the real prod tag distribution for the SOFI
 * row, read-only, over the brief's 30-day window.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesCanonical,
  filterAndClassifyArticles,
  buildMemoContent,
  noCoverageBriefLine,
  getCompanyVariants,
  parseCompanies,
  type RawArticleRow,
} from "./company-intel";

// ---------------------------------------------------------------------------
// 1. The mechanism: a name must match its own article tags.
// ---------------------------------------------------------------------------

test("a resolved row name matches itself", () => {
  // The failing case had matchesCanonical(x, x) === false. Any name for which
  // that holds sends its whole article pool to zero.
  for (const name of [
    "SoFi Technologies",
    "Visa Inc.",
    "Coty Inc.",
    "News Corp",
    "Unum Group",
    "GATX Corporation",
    "Meta Platforms Inc",
    "International Business Machines",
    "Google",
    "COIN",
    "ORCL",
    "ASTS",
    "NVIDIA",
    "Apple",
    "Sofinnova Investments",
  ]) {
    assert.equal(matchesCanonical(name, name), true, `${name} must match itself`);
  }
});

test("every variant the DB filter selects on survives the in-memory matcher", () => {
  // getCompanyVariants builds the `companies.cs.{...}` OR that both
  // getCompanyDetail and fetchCompanyArticles issue. Its first element is the
  // name itself. A variant the query selects on and the matcher then rejects is
  // the defect, so pin the round trip rather than the predicate alone.
  for (const name of ["SoFi Technologies", "Visa Inc.", "Meta Platforms Inc", "NVIDIA"]) {
    const first = getCompanyVariants(name)[0];
    assert.equal(first, name);
    assert.equal(matchesCanonical(first, name), true, `${name}: variant[0] rejected`);
  }
});

test("every real SoFi surface form resolves to the SOFI row name", () => {
  // Prod tag distribution on the SOFI row. "SoFi" and "SOFI" are the two most
  // common and are exactly the two the pre-fix predicate could never reach.
  for (const tag of [
    "SoFi",
    "SOFI",
    "Sofi",
    "SoFi Technologies",
    "SoFi Technologies, Inc.",
    "SoFi Technologies Inc",
    "SoFi Technologies Inc.",
  ]) {
    assert.equal(matchesCanonical(tag, "SoFi Technologies"), true, `${tag} rejected`);
  }
});

// ---------------------------------------------------------------------------
// 2. The guard: the fix must not admit a wrong company.
// ---------------------------------------------------------------------------

test("the fix does not admit a wrong company", () => {
  // Sofinnova Investments is a real companies row and is the collision this
  // fix had to avoid: lowering the 5-character prefix floor to 4 would have
  // made "SoFi" a prefix of "Sofinnova Investments". The floor is untouched and
  // the new branch is equality-only, so neither direction matches.
  const mustNotMatch: Array<[string, string]> = [
    ["Block", "Blackstone"],
    ["Block Inc", "Blackstone"],
    ["SoFi", "Sofinnova Investments"],
    ["SOFI", "Sofinnova Investments"],
    ["SoFi Technologies", "Sofinnova Investments"],
    ["Sofinnova Investments", "SoFi Technologies"],
    // A bare ticker must not reach a different company that carries the string.
    ["META", "MetLife"],
    ["COIN", "Coinstar"],
    ["V", "Visa Inc."],
    // Shared first token, different entity.
    ["Fidelity National Financial Inc.", "Fidelity International"],
    ["Bayerische Motoren Werke Aktiengesellschaft", "Bayer AG"],
    ["Mitsubishi Heavy Industries", "Mitsubishi Corp."],
    ["Uber Freight", "Uber Technologies, Inc."],
    ["Lyft", "Uber Technologies, Inc."],
  ];
  for (const [raw, target] of mustNotMatch) {
    assert.equal(matchesCanonical(raw, target), false, `${raw} must not match ${target}`);
  }
});

// ---------------------------------------------------------------------------
// 3. The pool: the real function over the real tag shapes.
// ---------------------------------------------------------------------------

function art(over: Partial<RawArticleRow> & { id: string }): RawArticleRow {
  return {
    id: over.id,
    title: over.title ?? "Untitled",
    source: over.source ?? "Benzinga",
    sector: over.sector ?? null,
    sentiment: over.sentiment ?? null,
    summary: over.summary ?? null,
    content: over.content ?? null,
    published_at: over.published_at ?? "2026-09-01T00:00:00Z",
    ingested_at: over.ingested_at ?? "2026-09-01T00:00:00Z",
    url: over.url ?? null,
    companies: over.companies ?? null,
    primary_company: over.primary_company ?? null,
    relevance_score: over.relevance_score ?? 7,
    deal_type: over.deal_type ?? "Other",
  } as RawArticleRow;
}

const SOFI_POOL: RawArticleRow[] = [
  art({ id: "a1", companies: ["SoFi Technologies"], primary_company: "SoFi", deal_type: "Earnings",
        title: "SOFI Stock Holds Momentum As Earnings Beat" }),
  art({ id: "a2", companies: ["SoFi Technologies"], primary_company: "SoFi Technologies", deal_type: "Funding",
        title: "SoFi Technologies Rolls Out Three New Private Market Funds" }),
  art({ id: "a3", companies: ["Morgan Stanley", "SoFi Technologies"], primary_company: "SOFI",
        title: "SOFI Stock Slips As Morgan Stanley Trims Price Target" }),
  art({ id: "a4", companies: ["SoFi Technologies", "SoFi Technologies, Inc."], primary_company: null,
        title: "Scotiabank initiates coverage of eight fintechs" }),
];

test("the SoFi pool survives the filter and classifies", () => {
  const classified = filterAndClassifyArticles(SOFI_POOL, "SoFi Technologies");
  assert.equal(classified.length, 4);
  const dev = classified.filter((a) => a._isDevelopment);
  assert.equal(dev.length, 2, "the Earnings and Funding rows are direct developments");
});

test("an unrelated company's rows are not pulled into the pool", () => {
  const classified = filterAndClassifyArticles(SOFI_POOL, "Sofinnova Investments");
  assert.equal(classified.length, 0);
});

test("the pool filter agrees with matchesCanonical row for row", () => {
  // The filter used to carry its own hand-inlined copy of the predicate. Pin
  // the two together so a future edit to one cannot silently diverge again.
  const name = "SoFi Technologies";
  const viaFilter = new Set(filterAndClassifyArticles(SOFI_POOL, name).map((a) => a.id));
  for (const a of SOFI_POOL) {
    const viaPredicate = parseCompanies(a.companies).some((c) => matchesCanonical(c, name));
    assert.equal(viaFilter.has(a.id), viaPredicate, `${a.id} disagrees`);
  }
});

// ---------------------------------------------------------------------------
// 4. The copy: an empty pool gets one line, not five hedged sections.
// ---------------------------------------------------------------------------

test("an empty pool produces the no-coverage mode, not context-led", () => {
  const content = buildMemoContent("SoFi Technologies", [], []);
  assert.match(content, /^MEMO_MODE: no-coverage$/m);
  assert.doesNotMatch(content, /context-led/);
});

test("a non-empty pool is unaffected by the no-coverage branch", () => {
  const classified = filterAndClassifyArticles(SOFI_POOL, "SoFi Technologies");
  const content = buildMemoContent(
    "SoFi Technologies",
    classified.filter((a) => a._isDevelopment),
    classified.filter((a) => !a._isDevelopment),
  );
  assert.doesNotMatch(content, /no-coverage/);
  assert.match(content, /^MEMO_MODE: developments-led$/m);
});

test("the no-coverage line obeys the brief copy rules", () => {
  const line = noCoverageBriefLine("SoFi Technologies");
  assert.equal(line, "Awaiting coverage. No article in the current pool names SoFi Technologies.");
  // Banned vocabulary anywhere in brief copy.
  for (const banned of ["buy", "sell", "hold", "allocation", "returns", "performance"]) {
    assert.doesNotMatch(line.toLowerCase(), new RegExp(`\\b${banned}\\b`), `banned word: ${banned}`);
  }
  // Outcome states are exactly supported, challenged, developing, awaiting.
  const states = line.toLowerCase().match(/\b(supported|challenged|developing|awaiting)\b/g) ?? [];
  assert.deepEqual(states, ["awaiting"]);
  // No em-dash, anywhere, ever. Written as the escape so the source file
  // itself stays free of the character it is banning.
  assert.equal(line.includes("\u2014"), false);
  // The filler sentence this replaced must not be reachable from the line.
  assert.doesNotMatch(line, /unassessable/i);
  // One line.
  assert.equal(line.includes("\n"), false);
});
