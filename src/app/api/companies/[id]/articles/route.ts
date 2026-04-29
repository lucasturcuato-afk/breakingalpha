import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
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

// Display-name (lowercase) → ticker. watchlist_articles.identifier is the ticker.
const NAME_TO_TICKER: Record<string, string> = {
  robinhood: "HOOD", sofi: "SOFI", coinbase: "COIN", shopify: "SHOP",
  boeing: "BA", crowdstrike: "CRWD", uber: "UBER", ionq: "IONQ",
  "ast spacemobile": "ASTS", "rocket lab": "RKLB", nasdaq: "NDAQ",
  "credo technology": "CRDO", celestica: "CLS", "planet labs": "PL",
  "sui group": "SUIG", apple: "AAPL", amazon: "AMZN", alphabet: "GOOGL",
  microsoft: "MSFT", meta: "META", nvidia: "NVDA", tesla: "TSLA",
  intel: "INTC", oracle: "ORCL", visa: "V", blackstone: "BX",
  "goldman sachs": "GS",
};

const ARTICLE_COLUMNS =
  "id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, primary_company, relevance_score, deal_type";

interface WatchlistArticleRow {
  article_id: string;
  identifier: string;
  title: string;
  url: string | null;
  source: string | null;
  source_type: string | null;
  summary: string | null;
  published_at: string | null;
  relevance_score: number | null;
  fetched_at: string | null;
}

// Synthesizes `companies` so the consumer's containment filter accepts the row.
// Cached rows lack deal_type / primary_company / sector / sentiment / content,
// so they always classify as context (never developments) — degraded but better
// than the previous zero-row outcome.
function adaptWatchlistRow(row: WatchlistArticleRow, canonicalName: string): RawArticleRow {
  return {
    id: row.article_id,
    title: row.title,
    source: row.source,
    sector: null,
    sentiment: null,
    summary: row.summary,
    published_at: row.published_at,
    ingested_at: row.fetched_at,
    url: row.url,
    companies: [canonicalName],
    primary_company: null,
    relevance_score: row.relevance_score,
    deal_type: null,
  };
}

// Cookie + origin via next/headers — keeps fetchCompanyArticles' signature stable.
async function readRequestContext(): Promise<{ cookie: string | null; origin: string | null }> {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
    const hdrs = await headers();
    const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
    const proto = hdrs.get("x-forwarded-proto") ?? "https";
    return { cookie: cookieHeader || null, origin: host ? `${proto}://${host}` : null };
  } catch {
    return { cookie: null, origin: null };
  }
}

export async function fetchCompanyArticles(
  supabase: SupabaseClient,
  canonicalName: string,
): Promise<CompanyArticlesResult> {
  const { cookie, origin } = await readRequestContext();

  if (origin) {
    try {
      const lookupId = NAME_TO_TICKER[canonicalName.toLowerCase()] ?? canonicalName;
      const url = `${origin}/api/watchlist-articles?identifier=${encodeURIComponent(lookupId)}`;
      const fetchHeaders: Record<string, string> = {};
      if (cookie) fetchHeaders["cookie"] = cookie;
      const res = await fetch(url, { headers: fetchHeaders, cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { articles?: WatchlistArticleRow[]; count?: number };
        const rows = Array.isArray(json.articles) ? json.articles : [];
        if (rows.length > 0) {
          return { articles: rows.map((r) => adaptWatchlistRow(r, canonicalName)), source: "cache" };
        }
      } else {
        console.error("[api/companies/articles] watchlist-articles non-OK status:", res.status);
      }
    } catch (e) {
      console.error("[api/companies/articles] watchlist-articles proxy threw:", e);
    }
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
