/**
 * IDENTITY precedence, and the verbatim lock on Wikipedia prose.
 *
 * WHAT THIS DECIDES
 * -----------------
 * Which of three sources supplies the Business overview block, in what order,
 * and which of them may be transformed on the way to the page.
 *
 *   1. Yahoo `assetProfile.longBusinessSummary`, when it ACTUALLY RESOLVED.
 *   2. The curated COMPANY_IDENTITY brief (34 names).
 *   3. `companies.description`, filled from an English Wikipedia lead paragraph.
 *
 * "ACTUALLY RESOLVED" IS THE LOAD-BEARING WORD IN RULE 1. A non-empty ticker is
 * not identity. Measured across the 597-ticker census: 581 resolve a summary,
 * 7 return a LIVE QUOTE WITH AN EMPTY PROFILE (BKZHY, CCIL, CCZ, FISV, JNGDY,
 * KVSD, PIEJF) and 9 return no quote at all. Two of those 7, Khosla Ventures
 * and Rothschild & Co, are in the 302 thin names this feature exists for, so
 * gating on ticker presence rather than on resolved prose would hand exactly
 * those rows an empty block while a paragraph sat in the database.
 *
 * On the population that matters the precedence conflict is empty: 0 of the 302
 * thin names lacking IDENTITY resolve a Yahoo summary. Yahoo-first costs
 * nothing here. It is a universe-wide policy, not a trade against this feature.
 *
 * THE VERBATIM LOCK
 * -----------------
 * A Wikipedia lead paragraph is reproduced under CC BY-SA 4.0 section
 * 2(a)(1)(A). Section 3(b), ShareAlike, is conditioned on the single clause "if
 * You Share Adapted Material You produce", and section 1(a) defines Adapted
 * Material as material that is "translated, altered, arranged, transformed, or
 * otherwise modified". So a verbatim excerpt never fires ShareAlike, and any
 * trim, summary, truncation or model rewrite does: it would oblige Signalera to
 * publish its own generated identity prose under CC BY-SA 4.0 for competitors
 * to take.
 *
 * THAT IS ENFORCED HERE BY THE TYPE SYSTEM, NOT BY A COMMENT, AND IT TAKES FOUR
 * MECHANISMS RATHER THAN ONE. A brand alone covers exactly one direction and
 * the first version of this module shipped believing it covered all four.
 * Every gap below was found by running `tsc --noEmit` against a probe file, and
 * three of the four needed no cast to walk through.
 *
 *   1. RE-ENTRY, which the brand does cover. `slice`, `substring`, `trim`,
 *      `replace`, `toUpperCase` and template interpolation all return plain
 *      `string`, which does not satisfy `VerbatimText`, so assigning a
 *      shortened value back into a verbatim slot is TS2322.
 *   2. CONSUMPTION, which it does not. `VerbatimText` is `string` intersected
 *      with a brand, so it is a SUBTYPE of `string` and every
 *      `(text: string) => string` helper accepts one silently. `PlainText`
 *      below is the fix: a type a branded string cannot satisfy. Anything that
 *      may shorten text takes `PlainText`, and passing a paragraph is TS2345.
 *   3. RE-MINTING. `asVerbatim` is module-private. An exported constructor that
 *      brands any string is a laundry, whatever its internal checks are.
 *      `wikipediaArtifact()` is the only public way in, and it mints only from
 *      a row that also carries the provenance the licence requires.
 *   4. RENDERING. A JSX child is `ReactNode`, which accepts plain `string`, so
 *      `{artifact.text.slice(0, 200)}` type-checks. Both render sites hand the
 *      paragraph to `VerbatimParagraph`, whose prop is `VerbatimText`, so the
 *      last inch is a typed slot rather than an untyped one.
 *
 * The mapper boundary is the same problem as 2 seen from the other side:
 * assigning a `VerbatimText` into a `string`-typed field drops the brand
 * silently, so `CompanyIntelData["primer"].overview` carries `IdentityArtifact`
 * rather than `string`.
 *
 * The `normalizable` discriminant is the second half of the lock. The Coverage
 * Primer POSTs its overview to /api/company-overview, which calls
 * gemini-2.5-flash. That path is a model rewrite, which is exactly what
 * produces Adapted Material. `normalizable` is false for wikipedia and the
 * caller must not send it. `resolveIdentityArtifact` will not fall back to an
 * unbranded `stored` artifact for a row whose source says wikipedia, which is
 * how that discriminant was being bypassed.
 *
 * A CSS line-clamp on the rendered element is fine and is what the design uses:
 * the full text is still shipped to the client and still copyable. A JS
 * truncation is not.
 */

/** Opaque brand. Nothing outside this module can construct one. */
declare const VERBATIM_BRAND: unique symbol;

/**
 * A string that is byte-identical to what the licensor published.
 *
 * Every string method that could shorten it returns plain `string`, so the
 * brand is lost and the value stops type-checking wherever verbatim text is
 * required. That is the point.
 */
export type VerbatimText = string & { readonly [VERBATIM_BRAND]: "cc-by-sa-verbatim" };

/**
 * A string that is PROVABLY NOT licensed verbatim text, and the other half of
 * the lock.
 *
 * A brand alone only stops a `VerbatimText` from being REBUILT out of a
 * shortened string. It does nothing to stop one being CONSUMED by something
 * that shortens, because `VerbatimText` is a subtype of `string` and every
 * `(text: string) => string` helper in the codebase accepts it silently.
 * `trimSummary(text: string)` in PrimerTab sat under a comment claiming a
 * wikipedia paragraph could not reach it; measured with `tsc --noEmit`, it
 * compiled clean.
 *
 * The optional-never brand member is what fixes that. A plain `string`, a
 * literal and a template literal all satisfy it. A `VerbatimText` does not:
 * `"cc-by-sa-verbatim"` is not assignable to `undefined`, so passing one to a
 * `PlainText` parameter is TS2345 and assigning one to a `PlainText` slot is
 * TS2322. Every function that may shorten text takes `PlainText`.
 */
export type PlainText = string & { readonly [VERBATIM_BRAND]?: undefined };

/** Licence identity, rendered on every page that shows a Wikipedia paragraph. */
export const CC_BY_SA_4_0 = "CC BY-SA 4.0";
export const CC_BY_SA_4_0_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

/** Source values `companies.description_source` may hold. */
export type DescriptionSource =
  | "wikipedia"
  | "wikipedia_repaired"
  | "curated"
  | "yahoo"
  | "manual";

/** The provenance columns that travel with a licensed paragraph. */
export interface CompanyDescriptionRow {
  description: string | null;
  description_source: DescriptionSource | null;
  description_source_url: string | null;
  description_source_title: string | null;
  description_license: string | null;
  description_license_url: string | null;
}

export interface WikipediaAttribution {
  /** Deep link to the exact article, for CC BY-SA 4.0 section 3(a)(1)(A)(v). */
  articleUrl: string;
  articleTitle: string;
  licenseName: string;
  licenseUrl: string;
}

/**
 * The resolved Business overview, tagged with what may be done to it.
 *
 * `normalizable: true` means the text may be trimmed for layout and may be sent
 * to /api/company-overview. `normalizable: false` means it may not be touched.
 */
export type IdentityArtifact =
  | { source: "yahoo"; normalizable: true; text: PlainText }
  | { source: "curated"; normalizable: true; text: PlainText }
  | { source: "stored"; normalizable: true; text: PlainText }
  | {
      source: "wikipedia";
      normalizable: false;
      text: VerbatimText;
      attribution: WikipediaAttribution;
    };

/** The three branches that may be trimmed, sent to a model, or interpolated. */
export type NormalizableArtifact = Extract<IdentityArtifact, { normalizable: true }>;

/**
 * Mint a `VerbatimText`. THE ONLY CONSTRUCTOR, AND IT IS MODULE-PRIVATE.
 *
 * IT USED TO BE EXPORTED, AND THAT WAS THE HOLE. A constructor that accepts any
 * `string` and hands back the brand is a laundry: `asVerbatim(summary.slice(0,
 * 280))` compiled clean and produced a value the render layer would then treat
 * as untouched licensed prose. The checks below catch an ellipsis and edge
 * whitespace, which is most of what a careless trim leaves behind, and none of
 * what a careful one does.
 *
 * The only public way in is now `wikipediaArtifact()`, which mints from a
 * `companies` row that also carries the provenance the licence requires. There
 * is no path from an arbitrary in-memory string to the brand.
 *
 * Returns null rather than throwing when the input already shows evidence of
 * having been modified, so a bad row degrades to an empty block instead of a
 * licence breach. Edge whitespace is treated as damage rather than trimmed
 * here: trimming is exactly the operation this type exists to prevent, and the
 * backfill already stores a stripped paragraph, so a row arriving with padding
 * did not come from the backfill.
 */
function asVerbatim(text: string | null | undefined): VerbatimText | null {
  if (typeof text !== "string") return null;
  if (text.length === 0) return null;
  if (text !== text.trim()) return null;
  if (text.endsWith("…") || text.endsWith("...")) return null;
  return text as VerbatimText;
}

/** True when a Yahoo profile summary actually carries prose. */
export function yahooSummaryResolved(summary: string | null | undefined): boolean {
  return typeof summary === "string" && summary.trim().length > 0;
}

/**
 * The `description_source` values that carry a CC BY-SA 4.0 obligation.
 *
 * ONE LIST, READ BY BOTH THE MINTER AND THE FALLTHROUGH GUARD. Two copies of
 * this predicate is how a row ends up licensed for one of them and unlicensed
 * for the other, which is the shape of the laundering path in
 * `resolveIdentityArtifact` below.
 */
export function isLicensedSource(
  source: DescriptionSource | null | undefined,
): source is "wikipedia" | "wikipedia_repaired" {
  return source === "wikipedia" || source === "wikipedia_repaired";
}

/**
 * Build the Wikipedia artifact from a `companies` row, or null.
 *
 * Every attribution field is required. A paragraph without its source link
 * cannot be rendered compliantly, so a row missing one is treated as absent.
 * The database carries the same rule as a CHECK constraint; this is the second
 * belt, because the constraint only binds rows written after the migration.
 */
export function wikipediaArtifact(
  row: CompanyDescriptionRow | null | undefined,
): Extract<IdentityArtifact, { source: "wikipedia" }> | null {
  if (!row) return null;
  if (!isLicensedSource(row.description_source)) return null;

  const text = asVerbatim(row.description);
  const articleUrl = row.description_source_url?.trim();
  const articleTitle = row.description_source_title?.trim();
  const licenseName = row.description_license?.trim() || CC_BY_SA_4_0;
  const licenseUrl = row.description_license_url?.trim() || CC_BY_SA_4_0_URL;
  if (!text || !articleUrl || !articleTitle) return null;

  return {
    source: "wikipedia",
    normalizable: false,
    text,
    attribution: { articleUrl, articleTitle, licenseName, licenseUrl },
  };
}

/**
 * PRECEDENCE. Yahoo, then curated, then the stored paragraph.
 *
 * Wikipedia fills the slot only where identity would otherwise be empty, which
 * is the instruction and also the honest read of the licence surface: a row
 * with no licensed text on it carries no attribution obligation.
 *
 * WORTH REVISITING, and stated rather than buried: on artifact size the order
 * is backwards in the middle. The Wikipedia first-paragraph median is 342
 * characters against a 140-character median for the 34 curated briefs, and on
 * private equity and elite boutique names the Wikipedia lead reads better than
 * Yahoo's as well (Yahoo returns a Capital-IQ style strategy taxonomy for those
 * segments, not prose). Changing the order is a product call, not a licence
 * one, so it is not made here.
 */
export function resolveIdentityArtifact(input: {
  yahooSummary?: string | null;
  curatedBrief?: string | null;
  row?: CompanyDescriptionRow | null;
}): IdentityArtifact | null {
  if (yahooSummaryResolved(input.yahooSummary)) {
    return { source: "yahoo", normalizable: true, text: input.yahooSummary!.trim() };
  }
  const curated = input.curatedBrief?.trim();
  if (curated) {
    return { source: "curated", normalizable: true, text: curated };
  }
  const wiki = wikipediaArtifact(input.row);
  if (wiki) return wiki;

  // THE LAUNDERING PATH, CLOSED. A row whose `description_source` names a
  // Wikipedia source but which `wikipediaArtifact()` refused is a LICENSED row
  // with broken provenance, not an unlicensed one. It used to fall through to
  // the `stored` branch below, where the same text came back `normalizable:
  // true` and stripped of its attribution: trimmed for layout, POSTed to
  // gemini-2.5-flash by `PrimerTab`, and rendered with no link to the article
  // or the licence. That is a model rewrite of CC BY-SA 4.0 material published
  // unattributed, which is the exact hazard the branded type exists to stop,
  // reached by walking around it rather than through it.
  //
  // Licence provenance is one-way. Once a row says the text came from
  // Wikipedia, no later failure can make it not have come from Wikipedia. So
  // the block is hidden and the row is held for repair.
  if (isLicensedSource(input.row?.description_source)) return null;

  // A stored description from a non-Wikipedia source carries no licence
  // obligation and no verbatim constraint.
  const stored = input.row?.description?.trim();
  if (stored) return { source: "stored", normalizable: true, text: stored };

  return null;
}

/**
 * The rendered attribution line, as one sentence with two links.
 *
 * This is the complete CC BY-SA 4.0 section 3(a) obligation for a verbatim
 * excerpt, in the form Wikimedia's Terms of Use section 7 names: attribution
 * "through hyperlink or URL to the page or pages that you are reusing", plus a
 * licensing notice with a hyperlink to the licence text. The article's history
 * page enumerates the authors, which is how the hyperlink discharges
 * 3(a)(1)(A)(i).
 */
export function attributionParts(attribution: WikipediaAttribution): {
  lead: string;
  sourceLabel: string;
  middle: string;
  licenseLabel: string;
  tail: string;
} {
  return {
    lead: "Company description from ",
    sourceLabel: "Wikipedia",
    middle: ", licensed ",
    licenseLabel: attribution.licenseName,
    tail: ".",
  };
}
