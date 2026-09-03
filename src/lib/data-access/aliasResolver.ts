import type { SupabaseClient } from "@supabase/supabase-js";
import { CANONICAL, canonicalize, getCompanyVariants } from "@/lib/company-intel";
import { compareCikFirst } from "@/lib/company-cik-preference";

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
};

const RESOLVER_COLS =
  "id, name, ticker, sector, mention_count, key_themes, first_seen, last_updated, sec_cik";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The ticker branch's own gate, exported so a caller can decide in advance
 * whether a slug will take that branch instead of guessing at it. A ticker
 * outside this shape (BRK.B) falls through to the name match, where it matches
 * nothing, so a link built from one lands on the empty state.
 */
export const TICKER_RE = /^[A-Z]{1,5}$/;

/**
 * Exported for the same reason. `src/lib/ask-companies-data.ts` builds links
 * into this route and proves each one lands by running the route's own
 * reconstruction rather than a second version of it.
 */
export function slugToCompanyName(slug: string): string {
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
 * THE COMPARISON KEY BOTH SIDES OF THE NAME MATCH GO THROUGH.
 *
 * The exact-match branch above compares a CANONICALIZED needle against the RAW
 * `companies.name` column. Those two strings are written by different things:
 * the needle by `canonicalize()`, which is a read-side display map living in
 * `company-intel.ts`, and the column by the Python ingest pipeline, which has
 * never heard of it. Wherever `canonicalize(name) !== name` the comparison
 * cannot succeed no matter what is in the table, because one side is normalized
 * and the other is not. That is the same shape #816 fixed one layer down in
 * `matchesCanonical`, and it is why a name that IS in the corpus renders "not
 * on Signalera".
 *
 * Measured read-only against the corpus before this change: 13.0% of rows could
 * not be reached from the slug the Company Intel index builds for them. Every
 * one of those was this asymmetry or the slug round-trip below.
 *
 * WHAT THE KEY ABSORBS, and nothing else:
 *   - case, which `ilike` already handled
 *   - the slug round-trip's hyphen loss. `slugify` writes a space as "-" and
 *     `slugToCompanyName` reads EVERY "-" back as a space, so a stored native
 *     hyphen ("Parker-Hannifin") cannot survive the trip. Collapsing runs of
 *     hyphen-or-space to a single space on BOTH sides makes the trip lossless
 *     for matching purposes. The Unicode range covers the dash characters that
 *     appear in ingested names, not just ASCII "-".
 *   - a trailing "." or "," that `canonicalize` strips from the needle and the
 *     column keeps ("Sei Investments Co." vs "Sei Investments Co").
 *
 * WHAT IT DOES NOT DO. It is not a fuzzy match. It is an EQUALITY after a
 * normalization applied identically to both operands, so it can only ever join
 * two strings that differ by separator or trailing punctuation. Audited over
 * the whole corpus: it merges three keys that the plain lowercase key kept
 * apart, and all three are the SAME company under two spellings
 * ("Coherent"/"COHERENT", "BYD Company"/"BYD COMPANY", "Mitsui & Co."/"Mitsui
 * & Co"). It invents no company.
 */
export function nameMatchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-\s\u2010-\u2015]+/g, " ")
    .replace(/[.,]+$/g, "")
    .trim();
}

/**
 * A LIKE pattern that finds candidate rows for `value` without assuming the
 * stored separator. Each space becomes "_", which LIKE reads as exactly one
 * character, so "Parker Hannifin" reaches the stored "Parker-Hannifin". The
 * trailing "%" lets a stored legal suffix the needle no longer carries survive
 * ("Visa" reaching "Visa Inc.").
 *
 * This is a CANDIDATE filter, not the decision. Everything it returns is then
 * held to `nameMatchKey` equality, so a loose pattern costs rows read and can
 * never widen what matches.
 */
function candidatePattern(value: string): string {
  return `${escapeLikePattern(value).replace(/ /g, "_")}%`;
}

/** Candidate reads are capped per pattern; the equality filter does the work. */
const CANDIDATE_LIMIT = 200;
/** Patterns tried per miss. Measured over every miss in the corpus: p50 1, max 5. */
const MAX_PATTERNS = 8;

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

/**
 * Find the row whose CANONICALIZED name matches `target` under `nameMatchKey`.
 *
 * TWO CANDIDATE SOURCES, because the needle can miss the column in two
 * different directions and one query cannot cover both.
 *
 *   1. `target` itself, as a separator-agnostic prefix. Covers the cases where
 *      the STORED name is LONGER than the needle: `canonicalize` stripped a
 *      legal suffix ("Visa Inc." -> "Visa") or a trailing period ("Sei
 *      Investments Co." -> "Sei Investments Co"), and it covers the hyphen
 *      round-trip ("Parker-Hannifin").
 *   2. `getCompanyVariants(target)`, which INVERTS the CANONICAL map. Covers
 *      the opposite direction, where `canonicalize` REWROTE the stored name to
 *      a different string entirely: the row is "JPMorgan" and the map turns it
 *      into "JPMorgan Chase", so no prefix of the target can ever reach it. The
 *      inverse hands back "JPMorgan" and the prefix finds the row. Same for
 *      "Google" under "Alphabet" and "COIN" under "Coinbase".
 *
 * Both sources feed the SAME equality filter, so a candidate that arrives by
 * either route still has to canonicalize to the target. Measured over every
 * miss in the corpus, this costs a median of one extra query and never more
 * than five, and it costs nothing at all on the hit path.
 *
 * DETERMINISTIC WHEN SEVERAL ROWS QUALIFY. `rankCluster` picks, which is the
 * same CIK-first ordering the ticker cluster below already uses, so two rows
 * that canonicalize to one entity resolve to the filer rather than to whichever
 * page happened to sort first.
 */
async function resolveByMatchKey(
  supabase: SupabaseClient,
  target: string,
): Promise<ResolverRow | null> {
  const targetKey = nameMatchKey(target);
  if (!targetKey) return null;

  // `ilike` is case-insensitive, so casing variants collapse to one query.
  const patterns = new Map<string, string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || patterns.size >= MAX_PATTERNS) return;
    const key = trimmed.toLowerCase();
    if (!patterns.has(key)) patterns.set(key, trimmed);
  };
  add(target);
  for (const variant of getCompanyVariants(target)) add(variant);

  const reads = await Promise.all(
    [...patterns.values()].map((pattern) =>
      supabase
        .from("companies")
        .select(RESOLVER_COLS)
        .ilike("name", candidatePattern(pattern))
        .order("mention_count", { ascending: false, nullsFirst: false })
        .limit(CANDIDATE_LIMIT),
    ),
  );

  const seen = new Set<string>();
  const hits: ResolverRow[] = [];
  for (const read of reads) {
    for (const row of ((read.data ?? []) as ResolverRow[])) {
      if (!row?.name || seen.has(row.id)) continue;
      seen.add(row.id);
      if (nameMatchKey(canonicalize(row.name)) === targetKey) hits.push(row);
    }
  }
  return hits.length > 0 ? rankCluster(hits)[0] : null;
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

    /* THE SYMMETRIC PASS, and it runs ONLY when the exact match above found
       nothing. That guard is the whole non-regression argument: a slug that
       resolves today takes the `.ilike` hit and never reaches this line, so
       nothing that works can be repointed here. Verified rather than asserted:
       replayed over every currently-resolving row in the corpus, all of them
       land on the same `companies.id` after this change, none move and none
       are lost.

       WHAT THE EXACT MATCH GETS WRONG. It compares `canonicalize(needle)` to
       the raw `name` column. `canonicalize` is a read-side map and the column
       is written by ingest, so for every row where the two disagree the
       comparison is unsatisfiable. `nameMatchKey` puts BOTH sides through the
       same normalization, which is the only version of this check that can
       succeed on a corpus the read side does not write. */
    if (!anchor) {
      anchor = await resolveByMatchKey(supabase, canonicalName);
    }
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
