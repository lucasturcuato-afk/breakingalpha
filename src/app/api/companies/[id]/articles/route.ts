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

/**
 * What the pool selection actually did, in numbers a surface can print.
 *
 * WHY THIS EXISTS. `articles` alone cannot tell a reader the difference between
 * "the window this reads from is empty" and "the pool filled before the window
 * was exhausted". Those are different facts, and the mobile primer was printing
 * the first over screens where the second was true: development-classified rows
 * DO exist inside the 30-day candidate window, and zero of them render, because
 * step 2 of selectFacetProtectedPool fills all ten slots out of the 14-day
 * filler sub-window before step 3 can reach back into the wider set. An empty
 * section that names only its own emptiness hides that count instead of
 * explaining it.
 *
 * NUMBERS ONLY, deliberately. This block is serialized by the GET handler
 * below, so carrying the candidate ROWS here would put up to CANDIDATE_LIMIT
 * full article records into a response that today carries at most POOL_SIZE.
 *
 * `windowDays` IS NULLABLE, and the null is the cache path. Path 1 hops
 * `watchlist_articles` and applies no published_at gate at all, so it reads an
 * unbounded window and no number of days describes it. A surface that prints
 * "in the last 30 days" over a cache-path answer states a window nothing
 * enforced.
 */
export interface ArticlePoolAccounting {
  /** Which of the three read paths answered. */
  path: ArticleSource;
  /** POOL_SIZE: the ceiling the selector fills to. */
  size: number;
  /** Rows the selector actually handed back. */
  selected: number;
  /** Rows in the candidate window before selection ran. */
  candidates: number;
  /** The candidate window in days, or null when the path applies none. */
  windowDays: number | null;
  /** The sub-window step 2 fills from first, or null when the path applies none. */
  fillerWindowDays: number | null;
  /** True when the candidate read came back at CANDIDATE_LIMIT, so `candidates` is a floor. */
  candidatesTruncated: boolean;
}

export interface CompanyArticlesResult {
  articles: RawArticleRow[];
  source: ArticleSource;
  error?: string;
  /**
   * The candidate window the selector chose FROM, unselected.
   *
   * SERVER ONLY. The GET handler does not serialize it, because it is up to
   * CANDIDATE_LIMIT full rows and the response contract is POOL_SIZE. It is
   * here so `/company/[id]` can classify the wider window with the classifier
   * it already calls, rather than this route growing a second copy of the
   * development rules that could drift from the one the page renders.
   */
  candidates: RawArticleRow[];
  /** See ArticlePoolAccounting. Always present, including on an empty answer. */
  pool: ArticlePoolAccounting;
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

/** `articles.id` is a uuid column. See the cache path in fetchCompanyArticles. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every failure path answers with the same accounting shape, all zeroes. */
function emptyPool(path: ArticleSource): ArticlePoolAccounting {
  return {
    path,
    size: POOL_SIZE,
    selected: 0,
    candidates: 0,
    windowDays: null,
    fillerWindowDays: null,
    candidatesTruncated: false,
  };
}

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
      /* SHAPE-GATED, and this is a live defect and not a hypothetical.
         `watchlist_articles.article_id` carries provider-prefixed ids as well
         as uuids, and `articles.id` is a uuid column. Handing Postgres a
         provider-prefixed string in an `IN` against a uuid column is a type
         error (22P02) on the whole statement, so the join below raised on
         every render for those companies. It failed SAFE, because the error
         branch falls through to Path 2, so the cost was a wasted round trip
         rather than wrong data; but a query that can only ever raise should
         not be issued. Rows that are not uuid-shaped could never have matched
         the column, so dropping them changes no result. */
      const ids = cacheRows
        .map((r) => r.article_id as unknown)
        .filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
      if (ids.length > 0) {
        const { data: articles, error: artErr } = await supabase
          .from("articles")
          .select(ARTICLE_COLUMNS)
          .in("id", ids)
          .order("ingested_at", { ascending: false });
        if (artErr) {
          console.error("[api/companies/articles] cache→articles join failed:", artErr.message);
        } else if (articles && articles.length > 0) {
          const rows = articles as RawArticleRow[];
          /* NO WINDOW ON THIS PATH. There is no published_at gate anywhere
             above, so the days are null rather than 30, and every surface that
             prints this accounting has to survive the null instead of
             assuming a window that nothing enforced. */
          return {
            articles: rows,
            source: "cache",
            candidates: rows,
            pool: {
              path: "cache",
              size: POOL_SIZE,
              selected: rows.length,
              candidates: rows.length,
              windowDays: null,
              fillerWindowDays: null,
              candidatesTruncated: false,
            },
          };
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
      return {
        articles: [],
        source: "empty",
        error: facetErr.message,
        candidates: [],
        pool: emptyPool("empty"),
      };
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

    /* The accounting for the selection that just ran. `candidates` is the
       30-day window the selector chose FROM, so a surface can say how many
       rows existed against how many reached the pool. `candidatesTruncated`
       matters because CANDIDATE_LIMIT is a `.limit()`: at 200 the number is a
       floor and not a total, exactly like ARTICLE_LIMIT on the other read. */
    const pool: ArticlePoolAccounting = {
      path: "fallback",
      size: POOL_SIZE,
      selected: selected.length,
      candidates: facetWindow.length,
      windowDays: FACET_WINDOW_DAYS,
      fillerWindowDays: FILLER_WINDOW_DAYS,
      candidatesTruncated: facetWindow.length >= CANDIDATE_LIMIT,
    };

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
        return {
          articles: [],
          source: "empty",
          error: legacyErr.message,
          candidates: [],
          pool: emptyPool("empty"),
        };
      }
      const rows = (legacy ?? []) as RawArticleRow[];
      const path: ArticleSource = rows.length > 0 ? "fallback" : "empty";
      /* THE LEGACY RUNG HAS NO WINDOW EITHER. It is ordered by ingested_at
         with no published_at gate, so its days are null for the same reason
         the cache path's are. It reaches here only when the 30-day window
         selected nothing, so `candidates` is genuinely 0 and saying so is the
         honest answer rather than a hidden one. */
      return {
        articles: rows,
        source: path,
        candidates: rows,
        pool: {
          path,
          size: POOL_SIZE,
          selected: rows.length,
          candidates: rows.length,
          windowDays: null,
          fillerWindowDays: null,
          candidatesTruncated: false,
        },
      };
    }

    return { articles: selected, source: "fallback", candidates: facetWindow, pool };
  } catch (e) {
    console.error("[api/companies/articles] fallback threw:", e);
    return {
      articles: [],
      source: "empty",
      error: e instanceof Error ? e.message : "unknown error",
      candidates: [],
      pool: emptyPool("empty"),
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
  /* `candidates` is NOT serialized. It is up to CANDIDATE_LIMIT full article
     rows and this response has always carried at most POOL_SIZE; it exists for
     the server-side caller in `/company/[id]`, not for the wire. Listed field
     by field rather than rest-spread away, so a field added to the result in
     future has to be considered here rather than leaking by default. */
  return NextResponse.json({
    articles: result.articles,
    source: result.source,
    ...(result.error !== undefined ? { error: result.error } : {}),
    pool: result.pool,
  });
}
