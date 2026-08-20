import type { SupabaseClient } from "@supabase/supabase-js";
import { CANONICAL, canonicalize } from "@/lib/company-intel";
import { compareCikFirst } from "@/lib/company-cik-preference";
import { normalizeCompanyKey } from "@/lib/company-cluster-key";
import { normalizeLookupKey } from "@/lib/normalize-lookup-key";

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
  /** Needed to rank: without it this resolver cannot see which row is the
   * filer, which is how it drifted from resolveCompanyCik in the first place. */
  sec_cik: number | null;
};

export type ResolverAliasMention = { name: string; n: number };

export type ResolveAliasResult = {
  canonical: ResolverRow;
  siblings: ResolverRow[];
  aliasMentions: ResolverAliasMention[];
  /**
   * Every alias surface form anywhere in `aliases` that folds onto the SAME
   * normalized company key as `canonical.name`, mention_count desc.
   *
   * Why this exists: the duplicate rows for a company are NOT reachable
   * through the ticker cluster. Live example (2026-08-18) - ticker BAC has
   * exactly one `companies` row, "Bank of America", so `siblings` is empty,
   * while `companies` separately holds "Bank of America Corp" (155 mentions),
   * "Bank of America Corporation" (55) and "Bank of America Corp." (3), all
   * with ticker NULL, each with its own alias row. Those are the surface forms
   * ingest actually writes into `articles.companies`, and the article filter
   * could not see any of them.
   *
   * Read-only, additive: `aliasMentions` is byte-identical to what it was
   * before this field existed.
   */
  clusterForms: ResolverAliasMention[];
};

const RESOLVER_COLS =
  "id, name, ticker, sector, mention_count, key_themes, first_seen, last_updated, sec_cik";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z]{1,5}$/;
/** Row cap on the widened alias prefix lookup. The widest observed real
 *  prefix ("bank of america") returns 4 rows; 400 is pure headroom and
 *  keeps a pathological short prefix from paging the whole 6k table. */
const ALIAS_WIDEN_LIMIT = 400;

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

/**
 * Order a ticker cluster, canonical first.
 *
 * A CIK-bearing row now outranks a CIK-less one regardless of mention count,
 * matching resolveCompanyCik / pickPreferCik. Before this, ranking started at
 * mention_count and never read sec_cik, so /company/TSM picked "TSMC" (439
 * mentions, no CIK) over "Taiwan Semiconductor" (201 mentions, cik 1046179) and
 * rendered the no-fundamentals empty state while the financials API answered
 * off the filer row. Same split on PTON, RGTI, GEMI.
 *
 * When NO row in the cluster carries a CIK, compareCikFirst returns 0 for every
 * pair and the original mention_count -> last_updated -> first_seen -> id
 * hierarchy decides exactly as it did before. Foreign filers with no CIK
 * anywhere (Samsung, four rows, all null) are unaffected.
 */
export function rankCluster(rows: ResolverRow[]): ResolverRow[] {
  return [...rows].sort((a, b) => {
    const byCik = compareCikFirst(a, b);
    if (byCik !== 0) return byCik;

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

  // Two INDEPENDENT reads, issued in parallel so the widened lookup costs no
  // extra round trip. Keeping them separate (rather than OR-ing the prefix
  // into the canonical_id query) means `aliasMentions` cannot be perturbed by
  // the widening: it is still exactly "alias rows owned by this cluster".
  const [aliasRes, widenRes] = await Promise.all([
    supabase.from("aliases").select("surface_form, mention_count").in("canonical_id", ids),
    fetchKeyMatchedAliases(supabase, canonical.name),
  ]);

  const rawAliases = (aliasRes.data ?? []) as Array<{
    surface_form: string | null;
    mention_count: number | null;
  }>;
  const aliasMentions: ResolverAliasMention[] = rawAliases
    .filter((r): r is { surface_form: string; mention_count: number | null } => !!r.surface_form)
    .map((r) => ({ name: r.surface_form, n: r.mention_count ?? 0 }))
    .sort((a, b) => b.n - a.n);

  // Gate on normalized-key equality with the head. The prefix query is
  // deliberately loose (it has to be, or "Parker Hannifin" never reaches
  // "Parker-Hannifin"); this is what keeps a loose prefix from becoming a
  // wrong-company match. "Trump" prefix-matches "Trump Media", and the key
  // check is the thing that drops it.
  const headKey = normalizeCompanyKey(canonical.name);
  const byForm = new Map<string, number>();
  for (const r of [...rawAliases, ...((widenRes.data ?? []) as typeof rawAliases)]) {
    const form = r.surface_form?.trim();
    if (!form) continue;
    if (normalizeCompanyKey(form) !== headKey) continue;
    const n = r.mention_count ?? 0;
    if (!byForm.has(form) || (byForm.get(form) ?? 0) < n) byForm.set(form, n);
  }
  const clusterForms: ResolverAliasMention[] = Array.from(byForm, ([name, n]) => ({ name, n }))
    .sort((a, b) => (b.n !== a.n ? b.n - a.n : a.name.localeCompare(b.name)));

  return { canonical, siblings, aliasMentions, clusterForms };
}

/**
 * Alias rows whose lookup_key starts with any of the head's prefix spellings.
 *
 * THREE prefixes, because lookup_key is v1-normalized (lowercase only) while
 * the comparison key folds punctuation to spaces, so the two disagree exactly
 * where a name is punctuated:
 *   1. the suffix-stripped comparison key   "parker hannifin"
 *   2. the plain lowercased name            "parker-hannifin"
 *   3. the FIRST TOKEN of (1)               "parker"
 * (3) is what makes this punctuation-proof. The live table holds BOTH
 * "Parker-Hannifin Corporation" and "Parker Hannifin Corporation" as separate
 * alias rows, and neither of (1) nor (2) reaches both. It is added only for
 * multi-token names with a >=4 character first token; measured breadth of the
 * broadest realistic first tokens on the live 6k-row table (2026-08-18):
 * united 27, american 22, first 22, general 18, bank 12, national 12. Cheap.
 *
 * Prefix-only, so it stays index-friendly (measured 142ms cold against prod).
 * Over-matching is expected and is handled by the caller's key gate: "trump"
 * pulls "Trump Media", and the key check drops it. `_` and `%` are LIKE
 * metacharacters with no escape hatch in PostgREST, so a prefix containing
 * either is dropped rather than allowed to wildcard; the comparison key can
 * never contain them (both fold to a space), so at least one prefix survives.
 */
async function fetchKeyMatchedAliases(
  supabase: SupabaseClient,
  headName: string,
): Promise<{ data: Array<{ surface_form: string | null; mention_count: number | null }> | null }> {
  const key = normalizeCompanyKey(headName);
  const firstToken = key.split(" ")[0] ?? "";
  const prefixes = Array.from(
    new Set([
      key,
      normalizeLookupKey(headName),
      ...(firstToken.length >= 4 && firstToken !== key ? [firstToken] : []),
    ]),
  ).filter((p) => p.length >= 3 && !/[%_]/.test(p));
  if (prefixes.length === 0) return { data: [] };

  const orExpr = prefixes
    .map((p) => `lookup_key.like."${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}*"`)
    .join(",");
  const { data, error } = await supabase
    .from("aliases")
    .select("surface_form, mention_count")
    .or(orExpr)
    .limit(ALIAS_WIDEN_LIMIT);
  if (error) {
    // Non-fatal: the caller still has today's head variants, so a failure here
    // degrades to the pre-expansion behavior instead of blanking the page.
    console.warn("[resolveAlias] widened alias lookup failed (non-fatal):", error.message);
    return { data: [] };
  }
  return { data };
}
