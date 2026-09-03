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
 * THAT IS ENFORCED HERE BY THE TYPE SYSTEM, NOT BY A COMMENT. Wikipedia text is
 * carried as `VerbatimText`, an opaque branded string that only `asVerbatim()`
 * can mint. `String.prototype.slice`, `substring`, `trim`, `replace` and
 * template interpolation all return plain `string`, which does not satisfy
 * `VerbatimText`, so a truncation anywhere between this module and the rendered
 * element is a compile error rather than a licence breach. `PrimerBusinessOverview`
 * requires the branded type on the wikipedia branch.
 *
 * The `normalizable` discriminant is the second half of the lock. The Coverage
 * Primer POSTs its overview to /api/company-overview, which calls
 * gemini-2.5-flash. That path is a model rewrite, which is exactly what
 * produces Adapted Material. `normalizable` is false for wikipedia and the
 * caller must not send it.
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
  | { source: "yahoo"; normalizable: true; text: string }
  | { source: "curated"; normalizable: true; text: string }
  | { source: "stored"; normalizable: true; text: string }
  | {
      source: "wikipedia";
      normalizable: false;
      text: VerbatimText;
      attribution: WikipediaAttribution;
    };

/**
 * Mint a `VerbatimText`. THE ONLY CONSTRUCTOR.
 *
 * Returns null rather than throwing when the input already shows evidence of
 * having been modified, so a bad row degrades to an empty block instead of a
 * licence breach. Edge whitespace is treated as damage rather than trimmed
 * here: trimming is exactly the operation this type exists to prevent, and the
 * backfill already stores a stripped paragraph, so a row arriving with padding
 * did not come from the backfill.
 */
export function asVerbatim(text: string | null | undefined): VerbatimText | null {
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
  const source = row.description_source;
  if (source !== "wikipedia" && source !== "wikipedia_repaired") return null;

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
