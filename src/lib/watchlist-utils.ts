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
    let stripped = full
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

/**
 * Builds a Supabase PostgREST `.or()` filter string that matches articles
 * for the given watchlist entry across primary_company, companies, and title.
 *
 * Returns null if no valid conditions could be produced.
 */
export function buildArticleOrFilter(
  identifier: string,
  displayName: string | null | undefined,
  type: string,
): string | null {
  const terms = getCompanySearchTerms(identifier, displayName);
  if (terms.length === 0) return null;

  const conditions: string[] = [];

  for (const term of terms) {
    // Escape PostgREST special characters in the term value.
    // The main risk is a literal comma breaking the OR string.
    const safe = term.replace(/,/g, ""); // strip commas to be safe
    if (!safe) continue;

    conditions.push(`primary_company.ilike.%${safe}%`);
    conditions.push(`companies.ilike.%${safe}%`);
    conditions.push(`title.ilike.%${safe}%`);
  }

  // For tickers with 3+ alphanumeric chars, also match the raw ticker symbol
  // in the title (e.g. "$NVDA" or "NVDA " at a word boundary).
  const rawIdent = identifier.replace(/[^A-Z0-9]/gi, "");
  if (type === "ticker" && rawIdent.length >= 3) {
    // The identifier itself is already included in `terms` above, but the
    // title-only match ensures short names like "AMD" are caught even when
    // not in primary_company.
    const safeIdent = rawIdent.replace(/,/g, "");
    // Word-boundary-ish match: preceded by space or start, followed by space/punct
    // PostgREST doesn't support regex in .or(), so use simple space-bounded patterns.
    conditions.push(`title.ilike. ${safeIdent} %`);
    conditions.push(`title.ilike.${safeIdent} %`);
    conditions.push(`title.ilike.% ${safeIdent}:%`);
    conditions.push(`title.ilike.% ${safeIdent},%`);
  }

  if (conditions.length === 0) return null;
  return conditions.join(",");
}
