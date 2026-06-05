import type { SupabaseClient } from "@supabase/supabase-js";
import { CANONICAL, canonicalize } from "@/lib/company-intel";

/**
 * Query-time alias canonical-rollup synthesizer (PR-B0, resolves Critical Finding C4).
 *
 * Collapses multiple `companies` rows that share a ticker into a single canonical
 * winner plus its sibling rows, without any schema mutation. See
 * docs/w2-c-phase-1-recon-synthesis.md Section 6 Locked Decision 1.
 *
 * Tiebreaker hierarchy (mention_count -> last_updated -> first_seen -> id):
 *   `is_canonical` and `created_at` columns referenced in the original spec do
 *   not exist in the live schema. We use the available ranking columns so the
 *   highest-mention NVDA row ("Nvidia", 94 mentions) wins deterministically.
 *
 * @example
 *   // 6 NVDA rows in `companies` collapse to 1 canonical + 5 siblings.
 *   const result = await resolveAlias(supabase, "NVDA");
 *   result.canonical.name === "Nvidia";
 *   result.siblings.length === 5;
 */

export type ResolverRow = {
  id: string;
  name: string;
  ticker: string | null;
  sector: string | null;
  mention_count: number | null;
  key_themes: string[] | null;
  first_seen: string | null;
  last_updated: string | null;
};

export type ResolverAliasMention = { name: string; n: number };

export type ResolveAliasResult = {
  canonical: ResolverRow;
  siblings: ResolverRow[];
  aliasMentions: ResolverAliasMention[];
};

const RESOLVER_COLS =
  "id, name, ticker, sector, mention_count, key_themes, first_seen, last_updated";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z]{1,5}$/;

function slugToCompanyName(slug: string): string {
  const decoded = decodeURIComponent(slug).replace(/-/g, " ");
  const lower = decoded.toLowerCase();
  if (CANONICAL[lower]) return CANONICAL[lower];
  return decoded.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Escape LIKE metacharacters so `ilike` performs a case-insensitive EXACT
// match: backslash first (the default LIKE escape char), then % and _.
// Without this, a name containing % or _ would wildcard-match other rows.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function rankCluster(rows: ResolverRow[]): ResolverRow[] {
  return [...rows].sort((a, b) => {
    const am = a.mention_count ?? -1;
    const bm = b.mention_count ?? -1;
    if (bm !== am) return bm - am;
    const al = a.last_updated ? Date.parse(a.last_updated) : 0;
    const bl = b.last_updated ? Date.parse(b.last_updated) : 0;
    if (bl !== al) return bl - al;
    const af = a.first_seen ? Date.parse(a.first_seen) : Number.MAX_SAFE_INTEGER;
    const bf = b.first_seen ? Date.parse(b.first_seen) : Number.MAX_SAFE_INTEGER;
    if (af !== bf) return af - bf;
    return a.id.localeCompare(b.id);
  });
}

export async function resolveAlias(
  supabase: SupabaseClient,
  idOrTickerOrSlug: string,
): Promise<ResolveAliasResult | null> {
  const input = idOrTickerOrSlug.trim();
  if (!input) return null;

  let anchor: ResolverRow | null = null;

  if (UUID_RE.test(input)) {
    const { data } = await supabase
      .from("companies")
      .select(RESOLVER_COLS)
      .eq("id", input)
      .maybeSingle();
    anchor = (data as ResolverRow | null) ?? null;
  } else if (TICKER_RE.test(input.toUpperCase())) {
    const { data } = await supabase
      .from("companies")
      .select(RESOLVER_COLS)
      .eq("ticker", input.toUpperCase())
      .limit(1)
      .maybeSingle();
    anchor = (data as ResolverRow | null) ?? null;
  }
  if (!anchor) {
    const canonicalName = canonicalize(slugToCompanyName(input));
    // Case-insensitive exact match. The slug round-trip title-cases function
    // words ("bank-of-america" -> "Bank Of America") while rows are stored
    // with natural casing ("Bank of America"), so a case-sensitive .eq()
    // missed ~26% of companies (916 of 3,516 are case-only misses). The
    // escaped pattern contains no wildcards, so ilike stays an exact match.
    // A CI match can return several rows (e.g. "eBay" / "EBay"); take the
    // highest-mention row, tie-broken by id for determinism, mirroring
    // rankCluster's primary ordering.
    const { data } = await supabase
      .from("companies")
      .select(RESOLVER_COLS)
      .ilike("name", escapeLikePattern(canonicalName))
      .order("mention_count", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(1);
    anchor = ((data as ResolverRow[] | null)?.[0] as ResolverRow | undefined) ?? null;
  }
  if (!anchor) return null;

  let cluster: ResolverRow[] = [anchor];
  const ticker =
    typeof anchor.ticker === "string" && anchor.ticker.trim()
      ? anchor.ticker.trim().toUpperCase()
      : null;
  if (ticker) {
    const { data: rows } = await supabase
      .from("companies")
      .select(RESOLVER_COLS)
      .eq("ticker", ticker);
    if (rows && rows.length > 0) cluster = rows as ResolverRow[];
  }

  const ranked = rankCluster(cluster);
  const canonical = ranked[0];
  const siblings = ranked.slice(1);

  const ids = ranked.map((r) => r.id);
  const { data: aliasRows } = await supabase
    .from("aliases")
    .select("surface_form, mention_count")
    .in("canonical_id", ids);
  const rawAliases = (aliasRows ?? []) as Array<{
    surface_form: string | null;
    mention_count: number | null;
  }>;
  const aliasMentions: ResolverAliasMention[] = rawAliases
    .filter((r): r is { surface_form: string; mention_count: number | null } => !!r.surface_form)
    .map((r) => ({ name: r.surface_form, n: r.mention_count ?? 0 }))
    .sort((a, b) => b.n - a.n);

  return { canonical, siblings, aliasMentions };
}
