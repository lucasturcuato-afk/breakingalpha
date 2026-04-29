import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { canonicalize, type RawArticleRow } from "@/lib/company-intel";

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

// Cache-first reader exported for direct use by the detail server component
// (which can't fetch its own API route without an absolute URL during SSR).
// Read 1 hops watchlist_articles → articles by id so the response keeps the
// full RawArticleRow shape that filterAndClassifyArticles expects. Read 2
// falls back to a direct articles query by companies array containment.
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

  try {
    const { data: articles, error: artErr } = await supabase
      .from("articles")
      .select(ARTICLE_COLUMNS)
      .contains("companies", [canonicalName])
      .order("ingested_at", { ascending: false })
      .limit(50);
    if (artErr) {
      console.error("[api/companies/articles] fallback error:", artErr.message);
      return { articles: [], source: "empty", error: artErr.message };
    }
    const rows = (articles ?? []) as RawArticleRow[];
    return { articles: rows, source: rows.length > 0 ? "fallback" : "empty" };
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
