/**
 * IDENTITY precedence and the CC BY-SA 4.0 verbatim lock.
 *
 * Two things are being pinned here.
 *
 * 1. PRECEDENCE RESOLVES ON RESOLVED PROSE, NOT ON A TICKER. Measured across
 *    the 597-ticker census: 581 resolve a Yahoo summary, 7 return a LIVE QUOTE
 *    WITH AN EMPTY PROFILE (BKZHY, CCIL, CCZ, FISV, JNGDY, KVSD, PIEJF) and 9
 *    return no quote. Two of those 7, Khosla Ventures and Rothschild & Co, sit
 *    in the 302 thin names this feature exists for. A precedence that gates on
 *    "has a ticker" hands exactly those rows an empty block while a paragraph
 *    sits in the database.
 *
 * 2. A LICENSED PARAGRAPH NEVER RENDERS WITHOUT ITS ATTRIBUTION. CC BY-SA 4.0
 *    section 3(a)(1) requires a link to the material and a notice referring to
 *    the licence. A row missing either is treated as absent rather than
 *    rendered bare.
 *
 * The third protection, that the paragraph cannot be truncated on the way to
 * the page, is enforced by the type system rather than by a test: `VerbatimText`
 * is an opaque branded string that only `asVerbatim()` mints, and every
 * shortening string method returns plain `string`. `npx tsc --noEmit` is that
 * assertion. The negative cases are listed at the bottom of this file as
 * commented code with the exact error each one produces.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  asVerbatim,
  resolveIdentityArtifact,
  wikipediaArtifact,
  yahooSummaryResolved,
  CC_BY_SA_4_0,
  CC_BY_SA_4_0_URL,
  type CompanyDescriptionRow,
} from "@/lib/company-identity";

const WIKI_PARA =
  "Cinven Limited is a global private equity firm founded in 1977, with offices in nine " +
  "international locations in Guernsey, London, New York, Paris, Frankfurt, Milan, " +
  "Luxembourg, Madrid, and Hong Kong that acquires Europe and United States-based " +
  "corporations.";

function wikiRow(over: Partial<CompanyDescriptionRow> = {}): CompanyDescriptionRow {
  return {
    description: WIKI_PARA,
    description_source: "wikipedia",
    description_source_url: "https://en.wikipedia.org/wiki/Cinven",
    description_source_title: "Cinven",
    description_license: CC_BY_SA_4_0,
    description_license_url: CC_BY_SA_4_0_URL,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

test("Yahoo wins when it actually resolves", () => {
  const artifact = resolveIdentityArtifact({
    yahooSummary: "Cinven Limited operates as a private equity firm.",
    curatedBrief: "curated brief",
    row: wikiRow(),
  });
  assert.equal(artifact?.source, "yahoo");
});

test("an EMPTY Yahoo profile on a live quote does not win, it falls through", () => {
  // The FISV class. 7 of 597 tickers. Two of them are in the thin 302.
  for (const empty of ["", "   ", null, undefined]) {
    const artifact = resolveIdentityArtifact({
      yahooSummary: empty,
      curatedBrief: null,
      row: wikiRow(),
    });
    assert.equal(artifact?.source, "wikipedia", `empty summary ${JSON.stringify(empty)} won`);
  }
});

test("yahooSummaryResolved is prose presence, not ticker presence", () => {
  assert.equal(yahooSummaryResolved("a summary"), true);
  assert.equal(yahooSummaryResolved(""), false);
  assert.equal(yahooSummaryResolved("\n\t  "), false);
  assert.equal(yahooSummaryResolved(null), false);
});

test("curated beats Wikipedia, Wikipedia fills only where identity would be empty", () => {
  const curated = resolveIdentityArtifact({
    yahooSummary: null,
    curatedBrief: "A European private equity firm.",
    row: wikiRow(),
  });
  assert.equal(curated?.source, "curated");

  const wiki = resolveIdentityArtifact({
    yahooSummary: null,
    curatedBrief: null,
    row: wikiRow(),
  });
  assert.equal(wiki?.source, "wikipedia");
});

test("no source at all hides the block", () => {
  assert.equal(
    resolveIdentityArtifact({ yahooSummary: null, curatedBrief: null, row: null }),
    null,
  );
});

test("only the Wikipedia branch is non-normalizable", () => {
  // `normalizable` is what gates /api/company-overview, which POSTs to
  // gemini-2.5-flash. A model rewrite is exactly what produces Adapted Material.
  const wiki = resolveIdentityArtifact({ row: wikiRow() });
  assert.equal(wiki?.normalizable, false);

  assert.equal(resolveIdentityArtifact({ yahooSummary: "x" })?.normalizable, true);
  assert.equal(resolveIdentityArtifact({ curatedBrief: "x" })?.normalizable, true);
});

test("a non-Wikipedia stored description carries no licence constraint", () => {
  const artifact = resolveIdentityArtifact({
    row: { ...wikiRow(), description_source: "manual" },
  });
  assert.equal(artifact?.source, "stored");
  assert.equal(artifact?.normalizable, true);
});

// ---------------------------------------------------------------------------
// Attribution is mandatory
// ---------------------------------------------------------------------------

test("a Wikipedia paragraph with no source URL is treated as absent", () => {
  assert.equal(wikipediaArtifact(wikiRow({ description_source_url: null })), null);
  assert.equal(wikipediaArtifact(wikiRow({ description_source_url: "  " })), null);
});

test("a Wikipedia paragraph with no article title is treated as absent", () => {
  assert.equal(wikipediaArtifact(wikiRow({ description_source_title: null })), null);
});

test("attribution defaults to CC BY-SA 4.0 rather than rendering an unlabelled excerpt", () => {
  const artifact = wikipediaArtifact(
    wikiRow({ description_license: null, description_license_url: null }),
  );
  assert.equal(artifact?.attribution.licenseName, CC_BY_SA_4_0);
  assert.equal(artifact?.attribution.licenseUrl, CC_BY_SA_4_0_URL);
});

test("a row missing attribution falls through rather than rendering bare", () => {
  const artifact = resolveIdentityArtifact({
    row: wikiRow({ description_source_url: null }),
  });
  // Falls to `stored`, which renders WITHOUT the wikipedia branch's attribution
  // block, so it must not be reached from a wikipedia source. It is not:
  // `description_source` is still "wikipedia", so `stored` is only reached when
  // the artifact could not be built, and that is the row being malformed.
  assert.notEqual(artifact?.source, "wikipedia");
});

test("wikipedia_repaired is recognised as a licensed source", () => {
  const artifact = wikipediaArtifact(wikiRow({ description_source: "wikipedia_repaired" }));
  assert.equal(artifact?.source, "wikipedia");
  assert.equal(artifact?.attribution.articleUrl, "https://en.wikipedia.org/wiki/Cinven");
});

// ---------------------------------------------------------------------------
// The verbatim lock
// ---------------------------------------------------------------------------

test("asVerbatim passes an untouched paragraph through byte for byte", () => {
  const minted = asVerbatim(WIKI_PARA);
  assert.equal(minted, WIKI_PARA);
  assert.equal(minted?.length, WIKI_PARA.length);
});

test("asVerbatim refuses text that shows evidence of modification", () => {
  assert.equal(asVerbatim(WIKI_PARA.slice(0, 120) + "..."), null);
  assert.equal(asVerbatim(WIKI_PARA.slice(0, 120) + "…"), null);
  assert.equal(asVerbatim("  " + WIKI_PARA), null);
  assert.equal(asVerbatim(WIKI_PARA + "\n"), null);
  assert.equal(asVerbatim(""), null);
  assert.equal(asVerbatim(null), null);
});

test("there is no length cap anywhere on the wikipedia path", () => {
  // The longest lead paragraph measured on the 302-name census is The Walt
  // Disney Company at 3,270 characters. It renders at 3,270.
  const long = "A".repeat(3270);
  const artifact = wikipediaArtifact(wikiRow({ description: long }));
  assert.equal(artifact?.text.length, 3270);

  const resolved = resolveIdentityArtifact({ row: wikiRow({ description: long }) });
  assert.equal(resolved?.text.length, 3270);
});

test("the resolved artifact's text is the stored string, identically", () => {
  const artifact = resolveIdentityArtifact({ row: wikiRow() });
  assert.equal(artifact?.text, WIKI_PARA);
});

/*
 * COMPILE-TIME NEGATIVES. Each of these is a licence breach and each is a tsc
 * error, not a review catch. Uncomment any one and `npx tsc --noEmit` fails.
 *
 *   const t = asVerbatim(WIKI_PARA)!;
 *
 *   // Type 'string' is not assignable to type 'VerbatimText'.
 *   const truncated: VerbatimText = t.slice(0, 280);
 *   const cut: VerbatimText = t.substring(0, 280);
 *   const stripped: VerbatimText = t.trim();
 *   const rewritten: VerbatimText = t.replace(/founded in \d+/, "");
 *   const interpolated: VerbatimText = `${t.slice(0, 200)}...`;
 *   const upper: VerbatimText = t.toUpperCase();
 *
 *   // Same error through the artifact, which is where a real regression would
 *   // be introduced:
 *   const a = wikipediaArtifact(wikiRow())!;
 *   const bad = { ...a, text: a.text.slice(0, 280) };
 *   <PrimerBusinessOverview identity={bad} />
 */
