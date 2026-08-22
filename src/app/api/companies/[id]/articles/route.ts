import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import {
  buildCompanyContainsOr,
  canonicalize,
  getCompanyVariants,
  type RawArticleRow,
} from "@/lib/company-intel";
import { FACETS, matchesFacet } from "@/lib/facet-predicates";
// Re-export for callers that previously imported matchesFacet from this route.
export { matchesFacet } from "@/lib/facet-predicates";

export const dynamic = "force-dynamic";

export type ArticleSource = "cache" | "fallback" | "empty";

export interface CompanyArticlesResult {
  articles: RawArticleRow[];
  source: ArticleSource;
  error?: string;
}

// Selected columns for full classifiable article shape (matches RawArticleRow).
const ARTICLE_COLUMNS =
  "id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, primary_company, relevance_score, deal_type";

// ---------------------------------------------------------------------------
// WD129: facet-protected, hybrid-window memo pool selection
// ---------------------------------------------------------------------------
// Source of truth: .claude/recon/agent-a-wd129-design-brief.md
//
// Why this exists:
//   The previous selection was ORDER BY ingested_at DESC LIMIT 50, which
//   collapses to whatever the most recent news flood happened to publish in
//   the last ~24 hours. When a company has a major event (SpaceX S-1 filing),
//   the top 50 fills with same-day rehashes and the model never sees the
//   structurally-important angles - dual-class governance, bear-thesis
//   skepticism, financial-risk disclosure, or the actual valuation range.
//
// What this does:
//   Two windows over published_at:
//     - 30-day "facet candidate" window: where we look for structurally
//       important articles by facet.
//     - 14-day "filler" window: where we pull tightly-recent high-relevance
//       articles to round out the pool.
//   Both gated at relevance_score >= 6 (matches the ingestion gate).
//
//   We reserve 1 slot per facet (4 facets, so up to 4 protected slots):
//     1. governance      - dual-class, supervoting, voting power, board, etc.
//     2. bear-thesis     - sentiment='bearish' OR explicit bear-case keywords
//     3. financial-risk  - dilution, cash burn, going concern, runway, etc.
//     4. valuation-range - explicit "$X to $Y billion/trillion" patterns
//
//   The selection algorithm runs in this order:
//     a. From the 30d facet window, identify matches per facet.
//     b. For each facet, pick top-1 by relevance_score DESC, published_at DESC.
//     c. Dedupe across facets (one article can satisfy multiple facets - the
//        TechCrunch SpaceX piece 4c1f0d39 is both governance AND range, which
//        frees up a filler slot).
//     d. Fill remaining slots from the 14d filler window, ranked by
//        relevance_score DESC, published_at DESC, skipping anything already
//        in the pool.
//
//   Graceful degradation: if a facet has zero matches in the 30d window,
//   that slot reverts to filler. We never force-fill a facet - an absent
//   bear case is real signal that the corpus genuinely lacks one.
//
// Cache path (Path 1) is left as-is. SpaceX has zero watchlist_articles rows
// today so Path 2 (fallback) is always the live path. Once watchlist coverage
// grows, Path 1 will need to honor the same selection algorithm; tracked as
// follow-on. See design brief "Not in scope" section.
// ---------------------------------------------------------------------------

const POOL_SIZE = 10;
const FACET_WINDOW_DAYS = 30;
const FILLER_WINDOW_DAYS = 14;
const CANDIDATE_LIMIT = 200; // enough to give the in-memory selector room
const MIN_RELEVANCE = 6;

// Facet type, predicates, and matchesFacet now live in @/lib/facet-predicates
// so WD141's facet-aware slicing in buildMemoContent runs the identical checks.

function byRelevanceThenRecency(a: RawArticleRow, b: RawArticleRow): number {
  const ra = a.relevance_score ?? 0;
  const rb = b.relevance_score ?? 0;
  if (rb !== ra) return rb - ra;
  const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
  const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
  return tb - ta;
}

/**
 * Run the facet-protected hybrid-window selection over two pre-fetched
 * candidate windows. Returns up to `poolSize` articles, deduped by id.
 *
 * Exposed for the dry-test harness and unit reasoning. Pure function: takes
 * two candidate arrays, returns the selected pool.
 */
export function selectFacetProtectedPool(
  facetWindow: RawArticleRow[],
  fillerWindow: RawArticleRow[],
  poolSize: number = POOL_SIZE,
): RawArticleRow[] {
  const pool: RawArticleRow[] = [];
  const seen = new Set<string>();

  // Step 1: per-facet protected pick. One article can satisfy multiple
  // facets but is added only once. Earlier facets in the FACETS array win
  // the dedupe race.
  for (const facet of FACETS) {
    const matches = facetWindow.filter((a) => matchesFacet(facet, a));
    if (matches.length === 0) continue;
    matches.sort(byRelevanceThenRecency);
    for (const cand of matches) {
      if (!seen.has(cand.id)) {
        pool.push(cand);
        seen.add(cand.id);
        break; // one slot per facet
      }
    }
  }

  // Step 2: fill remaining slots from the (tight) filler window, ranked by
  // relevance then recency, skipping anything already in the pool.
  const filler = [...fillerWindow].sort(byRelevanceThenRecency);
  for (const cand of filler) {
    if (pool.length >= poolSize) break;
    if (seen.has(cand.id)) continue;
    pool.push(cand);
    seen.add(cand.id);
  }

  // Step 3: if even the filler ran short (small corpus), keep going through
  // the 30d facet window to avoid dropping below the natural ceiling.
  if (pool.length < poolSize) {
    const facetFiller = [...facetWindow].sort(byRelevanceThenRecency);
    for (const cand of facetFiller) {
      if (pool.length >= poolSize) break;
      if (seen.has(cand.id)) continue;
      pool.push(cand);
      seen.add(cand.id);
    }
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Fetcher: cache-first, with facet-protected fallback.
// ---------------------------------------------------------------------------
// Cache path (Path 1) hops watchlist_articles → articles by id. Kept identical
// to pre-WD129 behavior for now: SpaceX has zero cache rows, so this never
// fires for the canonical test case. Path 2 (the live path for unwatched
// companies) is where the WD129 selection runs.
// Reachable from the /company/[id] Promise.all. Before adding .throwOnError(),
// .abortSignal(), or an await outside this function's existing trys, read the
// reject-safety block at the top of src/lib/sec-filings.ts.
export async function fetchCompanyArticles(
  supabase: SupabaseClient,
  canonicalName: string,
): Promise<CompanyArticlesResult> {
  try {
    const { data: cacheRows, error: cacheErr } = await supabase
      .from("watchlist_articles")
      .select("article_id")
      .ilike("identifier", canonicalName)
      .order("published_at", { ascending: false })
      .limit(50);
    if (cacheErr) {
      console.error("[api/companies/articles] cache read failed:", cacheErr.message);
    } else if (cacheRows && cacheRows.length > 0) {
      const ids = cacheRows
        .map((r) => r.article_id as unknown)
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      if (ids.length > 0) {
        const { data: articles, error: artErr } = await supabase
          .from("articles")
          .select(ARTICLE_COLUMNS)
          .in("id", ids)
          .order("ingested_at", { ascending: false });
        if (artErr) {
          console.error("[api/companies/articles] cache→articles join failed:", artErr.message);
        } else if (articles && articles.length > 0) {
          return { articles: articles as RawArticleRow[], source: "cache" };
        }
      }
    }
  } catch (e) {
    console.error("[api/companies/articles] cache path threw:", e);
  }

  // Path 2: WD129 facet-protected hybrid-window selection.
  try {
    const now = Date.now();
    const facetCutoff = new Date(now - FACET_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const fillerCutoff = new Date(now - FILLER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // 30-day facet candidate set. Pull enough rows that the in-memory selector
    // has room to find facet matches even when the recent burst dominates.
    // WD136 Phase 1: variant-expansion. Match all known casing/alias surface
    // forms of `canonicalName` in `articles.companies`, not just the single
    // canonical string. See getCompanyVariants() in company-intel.ts.
    const variantFilter = buildCompanyContainsOr(getCompanyVariants(canonicalName));
    const { data: facetRows, error: facetErr } = await supabase
      .from("articles")
      .select(ARTICLE_COLUMNS)
      .or(variantFilter)
      .gte("published_at", facetCutoff)
      .gte("relevance_score", MIN_RELEVANCE)
      .order("published_at", { ascending: false })
      .limit(CANDIDATE_LIMIT);
    if (facetErr) {
      console.error("[api/companies/articles] facet window error:", facetErr.message);
      return { articles: [], source: "empty", error: facetErr.message };
    }

    const facetWindow = (facetRows ?? []) as RawArticleRow[];

    // 14-day filler set. Derived in-memory from the same fetch to avoid a
    // second round-trip; facetWindow already supersets fillerWindow since
    // 14d is a subset of 30d.
    const fillerWindow = facetWindow.filter((a) => {
      const ts = a.published_at ?? a.ingested_at ?? null;
      return ts != null && ts >= fillerCutoff;
    });

    const selected = selectFacetProtectedPool(facetWindow, fillerWindow, POOL_SIZE);

    // Final safety: if the facet path returned nothing (brand new company,
    // no published_at coverage in 30d), fall back to the legacy recency
    // query so the page never returns 0 articles.
    if (selected.length === 0) {
      // WD136 Phase 1: variant-expansion (mirror of facet-window filter above).
      const { data: legacy, error: legacyErr } = await supabase
        .from("articles")
        .select(ARTICLE_COLUMNS)
        .or(variantFilter)
        .order("ingested_at", { ascending: false })
        .limit(POOL_SIZE);
      if (legacyErr) {
        console.error("[api/companies/articles] legacy fallback error:", legacyErr.message);
        return { articles: [], source: "empty", error: legacyErr.message };
      }
      const rows = (legacy ?? []) as RawArticleRow[];
      return { articles: rows, source: rows.length > 0 ? "fallback" : "empty" };
    }

    return { articles: selected, source: "fallback" };
  } catch (e) {
    console.error("[api/companies/articles] fallback threw:", e);
    return {
      articles: [],
      source: "empty",
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const canonical = canonicalize(decoded);
  const { supabase } = await getSupabaseWithUser();
  const result = await fetchCompanyArticles(supabase, canonical);
  return NextResponse.json(result);
}
