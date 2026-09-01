/**
 * Data access for GET /api/export/company-pdf.
 *
 * Lifted out of the route so the ownership gate is exercisable against a fake
 * client. There is no non-prod database, so the alternative would be reasoning
 * about the gate instead of running it. Same reason
 * tests/unit/require-admin.test.ts tests the decision rather than the wrapper.
 *
 * The route is now a thin wrapper: authenticate, call this, serialize.
 */

import { isBriefFresh } from "./watchlist-brief-ttl";

export type ExportArticle = {
  article_id: string;
  title: string;
  url: string | null;
  source: string | null;
  published_at: string | null;
  relevance_score: number | null;
  summary: string | null;
};

export type ExportEntry = {
  identifier: string;
  type: string;
  display_name: string | null;
};

export type ExportBrief = {
  brief_text: string;
  generated_at: string;
};

export type CompanyExport = {
  entry: ExportEntry | null;
  articles: ExportArticle[];
  brief: ExportBrief | null;
};

export const EMPTY_EXPORT: CompanyExport = {
  entry: null,
  articles: [],
  brief: null,
};

/**
 * Minimal structural type for the PostgREST client surface used here. Keeps
 * the fake client in the tests honest without dragging in the full
 * SupabaseClient generic.
 */
type QueryLike = {
  select: (cols: string) => QueryLike;
  eq: (col: string, val: unknown) => QueryLike;
  ilike: (col: string, val: string) => QueryLike;
  order: (col: string, opts: { ascending: boolean }) => QueryLike;
  limit: (n: number) => PromiseLike<{ data: unknown }>;
  maybeSingle: () => PromiseLike<{ data: unknown }>;
};

export type ExportClient = { from: (table: string) => QueryLike };

/**
 * True when `entry` is genuinely the caller's row for `requested`.
 *
 * The lookup that produces `entry` uses ILIKE, because watchlist identifiers
 * are stored with inconsistent casing. ILIKE also treats % and _ as
 * wildcards, and `requested` is caller supplied, so a value like "%" would
 * match an arbitrary row of the caller's own. Re-checking real equality here
 * makes the gate depend on the identifier the caller actually named rather
 * than on whatever the pattern happened to hit.
 */
export function ownsIdentifier(
  entry: { identifier?: unknown } | null | undefined,
  requested: string,
): boolean {
  if (!entry || typeof entry.identifier !== "string") return false;
  return entry.identifier.toLowerCase() === requested.toLowerCase();
}

/**
 * The caller's watchlist entry for `identifier`, plus the cached articles and
 * brief behind it.
 *
 * Returns EMPTY_EXPORT when the identifier is not on the caller's watchlist.
 * The cache tables are not read at all in that case: the gate runs before the
 * reads, not after them.
 */
export async function loadCompanyExport(
  supabase: ExportClient,
  userId: string,
  identifier: string,
): Promise<CompanyExport> {
  const { data: entryRow } = await supabase
    .from("watchlist")
    .select("identifier, type, display_name")
    .eq("user_id", userId)
    .ilike("identifier", identifier)
    .maybeSingle();

  if (!ownsIdentifier(entryRow as { identifier?: unknown } | null, identifier)) {
    return EMPTY_EXPORT;
  }

  const entry = entryRow as ExportEntry;

  // Read the cache under the STORED identifier, not the caller's spelling, so
  // a case variant cannot miss the rows the entry actually points at.
  const owned = entry.identifier;

  const [articlesRes, briefRes] = await Promise.all([
    supabase
      .from("watchlist_articles")
      .select("article_id, title, url, source, published_at, relevance_score, summary")
      .eq("identifier", owned)
      .order("relevance_score", { ascending: false })
      .limit(15),
    supabase
      .from("watchlist_briefs")
      .select("brief_text, generated_at")
      .eq("identifier", owned)
      .maybeSingle(),
  ]);

  const briefRow = briefRes.data as ExportBrief | null;

  return {
    entry,
    articles: (articlesRes.data as ExportArticle[] | null) ?? [],
    // A brief past the TTL is not exported. Same window the watchlist page
    // applies before it will render one.
    brief: briefRow && isBriefFresh(briefRow.generated_at) ? briefRow : null,
  };
}
