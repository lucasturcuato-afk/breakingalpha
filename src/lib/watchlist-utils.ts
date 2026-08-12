/**
 * Watchlist article-matching utilities.
 *
 * The core problem: watchlist display_names often include formal corporate
 * suffixes ("Goldman Sachs Group Inc") while the articles DB stores shorter
 * names ("Goldman Sachs"). This file provides helpers that strip those
 * suffixes and build multi-term search arrays so queries match reliably.
 */

/**
 * Returns an ordered array of search terms to use when querying articles
 * for a given watchlist entry. Terms are ordered from most-specific to
 * least-specific.
 *
 * Examples:
 *   ("GS", "Goldman Sachs Group Inc") → ["Goldman Sachs Group Inc", "Goldman Sachs", "GS"]
 *   ("TSLA", "Tesla Inc")             → ["Tesla Inc", "Tesla", "TSLA"]
 *   ("Anthropic", null)               → ["Anthropic"]
 *   ("V", "Visa Inc")                 → ["Visa Inc", "Visa", "V"]
 */
export function getCompanySearchTerms(
  identifier: string,
  displayName: string | null | undefined,
): string[] {
  const terms: string[] = [];

  if (displayName && displayName.trim()) {
    const full = displayName.trim();
    terms.push(full);

    // Strip common formal corporate suffixes to produce a shorter "core" name.
    // Apply replacements in descending length order so multi-word suffixes are
    // removed before single-word ones (e.g. "Group Inc" before "Inc").
    const stripped = full
      // Multi-word suffixes
      .replace(/\s+Group\s+Inc\.?\s*$/i, "")
      .replace(/\s+Holdings\s+Inc\.?\s*$/i, "")
      .replace(/\s+Platforms\s+Inc\.?\s*$/i, "")
      .replace(/\s+Technologies\s+Inc\.?\s*$/i, "")
      .replace(/\s+Technology\s+Inc\.?\s*$/i, "")
      .replace(/\s+Financial\s+Corp\.?\s*$/i, "")
      .replace(/\s+Group\s+Corp\.?\s*$/i, "")
      .replace(/\s+Acquisition\s+Corp\.?\s*$/i, "")
      // "Class A / B / C" share-class suffix
      .replace(/\s+Class\s+[A-Z]\s*$/i, "")
      // Single-word suffixes
      .replace(/\s+Corporation\s*$/i, "")
      .replace(/\s+Corp\.?\s*$/i, "")
      .replace(/\s+Incorporated\s*$/i, "")
      .replace(/\s+Inc\.?\s*$/i, "")
      .replace(/\s+Co\.?\s*$/i, "")
      .replace(/\s+Ltd\.?\s*$/i, "")
      .replace(/\s+PLC\s*$/i, "")
      .replace(/\s+NV\s*$/i, "")
      .replace(/\s+SA\s*$/i, "")
      .replace(/\s+AG\s*$/i, "")
      .replace(/\s+LLC\s*$/i, "")
      .replace(/\s+LP\s*$/i, "")
      // Trailing words that don't change the core identity
      .replace(/\s+Holdings\s*$/i, "")
      .replace(/\s+Platforms\s*$/i, "")
      .replace(/\s+Technologies\s*$/i, "")
      .replace(/\s+Technology\s*$/i, "")
      .replace(/\s+Group\s*$/i, "")
      // Finnhub-style suffixes not covered above
      .replace(/\.com\b/gi, "")
      .replace(/\s+Inc-[A-Z]\s*$/i, "")
      .replace(/\s+-\s*Class\s+[A-Z]\s*$/i, "")
      .replace(/\s+ETF\s*$/i, "")
      .trim();

    if (stripped && stripped.toLowerCase() !== full.toLowerCase()) {
      terms.push(stripped);
    }
  }

  // Always include the raw identifier (ticker symbol or company identifier).
  const ident = identifier.trim();
  if (ident && !terms.some((t) => t.toLowerCase() === ident.toLowerCase())) {
    terms.push(ident);
  }

  // Deduplicate while preserving order.
  const seen = new Set<string>();
  return terms.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sector entries resolve to the taxonomy, not to free text
// ---------------------------------------------------------------------------
// A watchlist row is (identifier text, type enum). `type` is constrained;
// `identifier` is NOT -- there is no FK and no check constraint, so a sector
// subscription is free text. buildArticleOrFilter used to ignore `type`
// entirely and serve every entry as
//   primary_company ILIKE '%Finance%' OR title ILIKE '%Finance%'
// which matches the word "finance" in prose and has nothing to do with the
// article's sector. Same defect class as the watchlist boost's substring match.
//
// articles.industry_verticals and articles.activity_types are the right target:
// both are written through validate_tags(), so they can only ever hold
// whitelist members, and industry_verticals is populated on 95.3% of rows.
//
// The two whitelists are the dual-dimension taxonomy from CLAUDE.md, mirrored
// from backend/ingest.py INDUSTRY_VERTICALS / ACTIVITY_TYPES. They share no
// values, so an identifier resolves unambiguously to exactly one column.

const INDUSTRY_VERTICALS = [
  "Technology",
  "Healthcare & Biotech",
  "Energy & Oil/Gas",
  "Financial Services",
  "Consumer & Retail",
  "Industrials & Manufacturing",
  "Aerospace & Defense",
  "Real Estate",
  "Media & Telecom",
  "Materials & Mining",
  "Agriculture",
] as const;

const ACTIVITY_TYPES = [
  "Mergers & Acquisitions",
  "Private Equity",
  "Venture Capital",
  "IPO & Capital Markets",
  "Earnings & Results",
  "Macro & Policy",
  "Geopolitics",
  "Regulation & Legal",
  "Fundraising",
  "Crypto & Digital Assets",
  "Leadership & Operations",
] as const;

// Shorthand forms already stored in the live watchlist, from the free-text
// fallthrough in WatchlistAddInput. Each maps to exactly one canonical value.
// Kept deliberately small: only unambiguous synonyms belong here.
//
// NOT mapped, on purpose:
//   "Public Markets"     -- no defensible target in either whitelist.
//   "Geopolitics & Macro" -- straddles TWO activity types (Geopolitics and
//                            Macro & Policy). Mapping it would silently pick
//                            one. It reaches user_preferences, not watchlist.
// Both resolve to null, and a null sector filter returns no articles rather
// than the wrong ones.
const SECTOR_ALIASES: Record<string, string> = {
  finance: "Financial Services",
  financial: "Financial Services",
  financials: "Financial Services",
  energy: "Energy & Oil/Gas",
  consumer: "Consumer & Retail",
  retail: "Consumer & Retail",
  healthcare: "Healthcare & Biotech",
  health: "Healthcare & Biotech",
  biotech: "Healthcare & Biotech",
  tech: "Technology",
  industrials: "Industrials & Manufacturing",
  manufacturing: "Industrials & Manufacturing",
  aerospace: "Aerospace & Defense",
  defense: "Aerospace & Defense",
  media: "Media & Telecom",
  telecom: "Media & Telecom",
  materials: "Materials & Mining",
  mining: "Materials & Mining",
  crypto: "Crypto & Digital Assets",
};

export type SectorMatch = {
  column: "industry_verticals" | "activity_types";
  value: string;
};

/**
 * Resolve a sector-type watchlist identifier to the taxonomy column and
 * canonical value it should match on, or null when it maps to nothing.
 *
 * Exact whitelist membership wins, then the alias table. Both are
 * case-insensitive; the returned `value` is always the canonical casing,
 * because the stored taxonomy values are case-sensitive.
 */
export function resolveSectorEntry(identifier: string): SectorMatch | null {
  const key = (identifier || "").trim().toLowerCase();
  if (!key) return null;

  const vertical = INDUSTRY_VERTICALS.find((v) => v.toLowerCase() === key);
  if (vertical) return { column: "industry_verticals", value: vertical };

  const activity = ACTIVITY_TYPES.find((a) => a.toLowerCase() === key);
  if (activity) return { column: "activity_types", value: activity };

  const aliased = SECTOR_ALIASES[key];
  if (!aliased) return null;

  return (INDUSTRY_VERTICALS as readonly string[]).includes(aliased)
    ? { column: "industry_verticals", value: aliased }
    : { column: "activity_types", value: aliased };
}

/**
 * Builds a Supabase PostgREST `.or()` filter string that matches articles
 * for the given watchlist entry.
 *
 * sector entries match the taxonomy arrays by containment. ticker and company
 * entries keep the existing fuzzy multi-term behaviour across primary_company
 * and title.
 *
 * Note: the `companies` column is a PostgreSQL text[] array; PostgREST does
 * not support .ilike on array columns, so it is intentionally excluded.
 *
 * Returns null if no valid conditions could be produced. Callers treat null as
 * "no articles" rather than "unfiltered".
 */
export function buildArticleOrFilter(
  identifier: string,
  displayName: string | null | undefined,
  type: string,
): string | null {
  if (type === "sector") {
    const match = resolveSectorEntry(identifier);
    if (!match) return null;
    // industry_verticals / activity_types are JSONB, not text[]. A jsonb
    // containment filter needs a JSON array literal (cs.["Technology"]);
    // the postgres array literal cs.{Technology} is rejected outright with
    // 400 22P02 invalid input syntax for type json. Same trap documented in
    // src/lib/radar-following.ts matchTaxonomy, where it silently made every
    // industry follow match nothing.
    //
    // A comma or paren in the value would break the or-grammar. No canonical
    // taxonomy value contains either, so this is a guard, not a live path.
    if (/[,()]/.test(match.value)) return null;
    return `${match.column}.cs.${JSON.stringify([match.value])}`;
  }

  const terms = getCompanySearchTerms(identifier, displayName);
  if (terms.length === 0) return null;

  const conditions: string[] = [];

  for (const term of terms) {
    // Escape PostgREST special characters in the term value.
    // The main risk is a literal comma breaking the OR string.
    const safe = term.replace(/,/g, ""); // strip commas to be safe
    if (!safe) continue;

    conditions.push(`primary_company.ilike.%${safe}%`);
    if (safe.length >= 6) {
      conditions.push(`title.ilike.%${safe}%`);
    }
  }


  if (conditions.length === 0) return null;
  return conditions.join(",");
}
