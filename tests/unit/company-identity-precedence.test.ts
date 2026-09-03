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
 * the page, is enforced by the type system rather than by a test, and `npx tsc
 * --noEmit` is that assertion. The negative cases are listed at the bottom of
 * this file as commented code with the exact error each one produces.
 *
 * WHAT THE BRAND DID NOT COVER UNTIL THIS COMMIT, measured with `tsc --noEmit`
 * against probe files rather than reasoned about. A brand stops a shortened
 * string being assigned BACK INTO a verbatim slot. Four things it does not stop
 * on its own, all of which compiled clean, three of which needed no cast:
 *
 *   1. Consumption. `VerbatimText` is a SUBTYPE of `string`, so every
 *      `(text: string) => string` helper takes one. `trimSummary` in PrimerTab
 *      accepted a wikipedia paragraph four lines under a comment saying that
 *      was a compile error. Fixed with `PlainText`, a type a branded string
 *      cannot satisfy.
 *   2. Re-minting. `asVerbatim` was exported and would brand any string that
 *      did not happen to end in an ellipsis. It is module-private now, and
 *      `wikipediaArtifact()` is the only way in.
 *   3. Widening at a mapper boundary. `buildPrimer` assigned the paragraph into
 *      a `string`-typed field on the mobile shape, and the brand was gone from
 *      the next line on. That field carries `IdentityArtifact` now.
 *   4. Rendering. A JSX child is `ReactNode`, which accepts plain `string`, so
 *      `{identity.text.slice(0, 200)}` type-checked at both render sites. Both
 *      now go through `VerbatimParagraph`, whose prop is `VerbatimText`.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  isLicensedSource,
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

test("a row missing attribution renders nothing at all, not an unattributed excerpt", () => {
  // THE LAUNDERING PATH, AND THE OLD ASSERTION HERE PASSED WHILE IT WAS OPEN.
  // It checked only that the result was not the `wikipedia` branch. It was not:
  // it was the `stored` branch, carrying the same licensed prose with
  // `normalizable: true` and no attribution object, which PrimerTab then POSTs
  // to gemini-2.5-flash. A model rewrite of CC BY-SA 4.0 text, published
  // unattributed, is the exact hazard the brand exists to prevent, reached by
  // walking around the brand rather than through it.
  //
  // Licence provenance is one-way: a row that says the text came from Wikipedia
  // cannot stop having come from Wikipedia because a sibling column is null.
  for (const broken of [
    wikiRow({ description_source_url: null }),
    wikiRow({ description_source_url: "   " }),
    wikiRow({ description_source_title: null }),
    wikiRow({ description: WIKI_PARA + "\u2026" }),
    wikiRow({ description: "  " + WIKI_PARA }),
    wikiRow({ description_source: "wikipedia_repaired", description_source_url: null }),
  ]) {
    assert.equal(resolveIdentityArtifact({ row: broken }), null);
  }
});

test("a broken Wikipedia row is still outranked, not resurrected", () => {
  // Hiding the block is the LAST resort, not the first. A real Yahoo summary or
  // a curated brief still fills the slot.
  const broken = wikiRow({ description_source_url: null });
  assert.equal(
    resolveIdentityArtifact({ yahooSummary: "Yahoo prose.", row: broken })?.source,
    "yahoo",
  );
  assert.equal(
    resolveIdentityArtifact({ curatedBrief: "Curated brief.", row: broken })?.source,
    "curated",
  );
});

test("isLicensedSource is the one list both the minter and the guard read", () => {
  assert.equal(isLicensedSource("wikipedia"), true);
  assert.equal(isLicensedSource("wikipedia_repaired"), true);
  for (const source of ["curated", "yahoo", "manual", null, undefined] as const) {
    assert.equal(isLicensedSource(source), false);
  }
});

test("wikipedia_repaired is recognised as a licensed source", () => {
  const artifact = wikipediaArtifact(wikiRow({ description_source: "wikipedia_repaired" }));
  assert.equal(artifact?.source, "wikipedia");
  assert.equal(artifact?.attribution.articleUrl, "https://en.wikipedia.org/wiki/Cinven");
});

// ---------------------------------------------------------------------------
// The verbatim lock
// ---------------------------------------------------------------------------

test("an untouched paragraph passes through byte for byte", () => {
  // THROUGH `wikipediaArtifact` AND NOT THROUGH THE MINTER. `asVerbatim` used
  // to be exported and this file used to call it directly, which is what made
  // it a public laundry: any string that did not end in an ellipsis came back
  // branded. The only way to a `VerbatimText` now is a `companies` row that
  // also carries the provenance the licence requires.
  const minted = wikipediaArtifact(wikiRow())?.text;
  assert.equal(minted, WIKI_PARA);
  assert.equal(minted?.length, WIKI_PARA.length);
});

test("text that shows evidence of modification is refused", () => {
  for (const description of [
    WIKI_PARA.slice(0, 120) + "...",
    WIKI_PARA.slice(0, 120) + "…",
    "  " + WIKI_PARA,
    WIKI_PARA + "\n",
    "",
    null,
  ]) {
    assert.equal(wikipediaArtifact(wikiRow({ description })), null);
  }
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
 * COMPILE-TIME NEGATIVES. Each is a licence breach and each is a tsc error, not
 * a review catch. Uncomment any one and `npx tsc --noEmit` fails with the code
 * named beside it. Every code below was produced by running tsc against a probe
 * file, not inferred from the type declarations.
 *
 *   const t = wikipediaArtifact(wikiRow())!.text;
 *
 *   // RE-ENTRY. TS2322: Type 'string' is not assignable to type 'VerbatimText'.
 *   // This half always held. It is the other four that did not.
 *   const truncated: VerbatimText = t.slice(0, 280);
 *   const cut: VerbatimText = t.substring(0, 280);
 *   const stripped: VerbatimText = t.trim();
 *   const rewritten: VerbatimText = t.replace(/founded in \d+/, "");
 *   const interpolated: VerbatimText = `${t.slice(0, 200)}...`;
 *   const upper: VerbatimText = t.toUpperCase();
 *
 *   const a = wikipediaArtifact(wikiRow())!;
 *   const bad = { ...a, text: a.text.slice(0, 280) };   // TS2322
 *
 *   // CONSUMPTION. TS2345: Argument of type 'VerbatimText' is not assignable
 *   // to parameter of type 'PlainText'. Types of property '[VERBATIM_BRAND]'
 *   // are incompatible. This is the one that compiled clean beside a comment
 *   // in PrimerTab.tsx claiming it was an error.
 *   declare function trimSummary(text: PlainText): string;
 *   trimSummary(a.text);
 *
 *   // CONSUMPTION, UN-NARROWED. TS2345: Argument of type
 *   // 'VerbatimText | PlainText' is not assignable to parameter of type
 *   // 'PlainText'. Reading `.text` off the union no longer widens to `string`.
 *   declare const u: IdentityArtifact;
 *   trimSummary(u.text);
 *
 *   // RE-MINTING. TS2459: Module '"@/lib/company-identity"' declares
 *   // 'asVerbatim' locally, but it is not exported.
 *   import { asVerbatim } from "@/lib/company-identity";
 *
 *   // WIDENING AT A MAPPER BOUNDARY. No error is possible here, which is the
 *   // point: `{ overview: a.text }` into an `overview: string` field compiled
 *   // clean and dropped the brand. The fix is the field's type, not a check.
 *   // `CompanyIntelData["primer"].overview` is `IdentityArtifact | null` now.
 *
 *   // RENDERING. TS2322: Type 'string' is not assignable to type
 *   // 'VerbatimText'. A bare `{a.text.slice(0, 200)}` in JSX has no error to
 *   // give, because a JSX child is `ReactNode` and `ReactNode` accepts
 *   // `string`. Routing both render sites through `VerbatimParagraph` is what
 *   // turns the last inch into a typed slot.
 *   <VerbatimParagraph text={a.text.slice(0, 200)} />
 */
