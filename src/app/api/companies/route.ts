import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { normalizeLookupKey } from "@/lib/normalize";
import { isNoiseName } from "@/lib/company-noise";
import { buildHrefProver } from "@/lib/ask-companies-data";

export const dynamic = "force-dynamic";

export interface Company {
  id: string;
  name: string;
  ticker: string | null;
  sector: string | null;
  mention_count: number;
  last_updated: string | null;
  key_themes: string[] | null;
  alias_count: number;
  /**
   * `/company/<slug>` for this row, PROVED to land, or null when no slug for it
   * could be proved.
   *
   * WHY THE ROUTE CARRIES IT AT ALL. `/ask`'s field searches through this
   * route, and the Ask screen is a `"use client"` module. Reproducing the proof
   * in the browser would mean shipping `canonicalize`, `CANONICAL` and
   * `slugToCompanyName` into the client bundle, or writing a second copy of the
   * reconstruction that would drift from the route it is proving against. The
   * proof runs where the data already is, once, and the answer travels as a
   * field.
   *
   * NULL IS A REAL ANSWER AND NOT AN ERROR. Measured against the corpus, 9.5%
   * of rows do not resolve from their own slug, because `canonicalize` strips a
   * trailing legal token ("Electronic Arts Inc." -> "Electronic Arts") and the
   * stripped string is not itself a row. Almost none of those carry a ticker,
   * so they have no second path. A caller must render such a row WITHOUT a
   * link; it must never invent one.
   *
   * The proof runs over the rows in THIS response. It is monotone in the
   * window, so a true answer here is true against the table; see
   * `buildHrefProver`.
   */
  href: string | null;
}

/**
 * Re-exported so nothing that imported `isNoiseName` from this route has to
 * move. The predicate itself lives in `@/lib/company-noise` now, because this
 * route imports `ask-companies-data` and that module imports the predicate; had
 * it stayed here the two would import each other.
 */
export { isNoiseName };

export async function GET(request: NextRequest) {
  const { supabase } = await getSupabaseWithUser();
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitRaw = parseInt(searchParams.get("limit") ?? "500", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 500;

  try {
    let query = supabase
      .from("companies")
      .select("id, name, ticker, sector, mention_count, last_updated, key_themes, aliases(count)")
      .not("name", "is", null)
      // Loosened from `> 0` to `IS NOT NULL` after Vercel preview showed too few rows
      // (~25-30 vs. pre-rewrite hundreds). Singletons are still real companies a user
      // might search for. SQL noise protection moved to the JS post-fetch filter below.
      .not("mention_count", "is", null)
      .order("mention_count", { ascending: false, nullsFirst: false })
      .order("last_updated", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true })
      .limit(limit);

    if (q.length >= 2) {
      // Search both name and ticker columns. PostgREST `.or()` strings use commas
      // and parens as syntactic separators, so we strip those from the user input
      // before interpolation. Percent and underscore are valid ilike wildcards we
      // intentionally let through; the filter just becomes more permissive, not
      // less safe (PostgREST parameterizes the resulting filter into a parsed AST,
      // so this is not a SQL-injection vector).
      const safeQ = q.replace(/[,()]/g, "");
      if (safeQ.length >= 2) {
        query = query.or(`name.ilike.%${safeQ}%,ticker.ilike.%${safeQ}%`);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error("[api/companies] query error:", error.message);
      return NextResponse.json({ companies: [], total: 0, error: error.message });
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    const filtered = rows.filter((c) => {
      const name = (typeof c.name === "string" ? c.name : "").trim();
      if (name.length < 2) return false;
      if (isNoiseName(name)) return false;
      return true;
    });

    // Diagnostic: warn when the JS noise filter drops > 30% of rows. Percentage-based
    // so the threshold scales with the larger default limit (500 -> could be 1000).
    if (rows.length > 0 && (rows.length - filtered.length) / rows.length > 0.30) {
      const dropped = rows
        .filter((c) => !filtered.includes(c))
        .slice(0, 5)
        .map((c) => c.name);
      console.warn(
        `[api/companies] post-fetch quality filter reduced ${rows.length} -> ${filtered.length} rows (>30% dropped). First 5 filtered names:`,
        dropped,
      );
    }

    // Flatten the PostgREST `aliases(count)` relationship subquery to a scalar
    // `alias_count` field. The relationship returns an array of length 1 shaped
    // `[{ count: <N> }]`; renderers should not need to know about that nesting.
    /* One prover over the rows this response is about to carry, built before
       the map so the two branches of the proof see the whole window. */
    const proveHref = buildHrefProver(
      filtered.map((c) => ({
        id: c.id as string,
        name: (c.name ?? null) as string | null,
        ticker: (c.ticker ?? null) as string | null,
        sector: (c.sector ?? null) as string | null,
      })),
    );

    const withAliasCount: Company[] = filtered.map((c) => {
      const aliases = c.aliases;
      const aliasCount =
        Array.isArray(aliases) &&
        aliases[0] &&
        typeof (aliases[0] as { count?: unknown }).count === "number"
          ? ((aliases[0] as { count: number }).count)
          : 0;
      return {
        id: c.id as string,
        name: c.name as string,
        ticker: (c.ticker ?? null) as string | null,
        sector: (c.sector ?? null) as string | null,
        mention_count: (c.mention_count ?? 0) as number,
        last_updated: (c.last_updated ?? null) as string | null,
        key_themes: (c.key_themes ?? null) as string[] | null,
        alias_count: aliasCount,
        href: proveHref({
          id: c.id as string,
          name: (c.name ?? null) as string | null,
          ticker: (c.ticker ?? null) as string | null,
          sector: (c.sector ?? null) as string | null,
        }),
      };
    });

    // Typo-redirect: when the user typed a search term but the ilike returned no
    // matches, attempt an alias lookup. On hit, return the canonical company row
    // with `alias_resolved` metadata so the directory can render a "Did you mean..."
    // banner and skip web-fallback.
    if (q.length >= 2 && withAliasCount.length === 0) {
      const lookupKey = normalizeLookupKey(q);
      const { data: aliasHit } = await supabase
        .from("aliases")
        .select("canonical_id")
        .eq("lookup_key", lookupKey)
        .limit(1)
        .maybeSingle();

      if (aliasHit?.canonical_id) {
        const { data: canonical } = await supabase
          .from("companies")
          .select(
            "id, name, ticker, sector, mention_count, last_updated, key_themes, aliases(count)",
          )
          .eq("id", aliasHit.canonical_id)
          .maybeSingle();

        if (canonical) {
          const canonicalRow = canonical as Record<string, unknown>;
          const canonicalAliases = canonicalRow.aliases;
          const aliasCount =
            Array.isArray(canonicalAliases) &&
            canonicalAliases[0] &&
            typeof (canonicalAliases[0] as { count?: unknown }).count === "number"
              ? ((canonicalAliases[0] as { count: number }).count)
              : 0;
          const company: Company = {
            id: canonicalRow.id as string,
            name: canonicalRow.name as string,
            ticker: (canonicalRow.ticker ?? null) as string | null,
            sector: (canonicalRow.sector ?? null) as string | null,
            mention_count: (canonicalRow.mention_count ?? 0) as number,
            last_updated: (canonicalRow.last_updated ?? null) as string | null,
            key_themes: (canonicalRow.key_themes ?? null) as string[] | null,
            alias_count: aliasCount,
            /* A window of one. The canonical row proves against itself, which
               is the whole of what the redirect can offer: the ticker branch
               sees its own ticker and the name branch its own name, and both
               are existence checks the table will answer the same way. */
            href: buildHrefProver([
              {
                id: canonicalRow.id as string,
                name: (canonicalRow.name ?? null) as string | null,
                ticker: (canonicalRow.ticker ?? null) as string | null,
                sector: (canonicalRow.sector ?? null) as string | null,
              },
            ])({
              id: canonicalRow.id as string,
              name: (canonicalRow.name ?? null) as string | null,
              ticker: (canonicalRow.ticker ?? null) as string | null,
              sector: (canonicalRow.sector ?? null) as string | null,
            }),
          };
          return NextResponse.json({
            companies: [company],
            total: 1,
            alias_resolved: true,
            query_typed: q,
            canonical_name: company.name,
          });
        }
      }
    }

    return NextResponse.json({ companies: withAliasCount, total: withAliasCount.length });
  } catch (e) {
    console.error("[api/companies] unexpected error:", e);
    return NextResponse.json({
      companies: [],
      total: 0,
      error: e instanceof Error ? e.message : "unknown error",
    });
  }
}
