import type { SupabaseClient } from "@supabase/supabase-js";

import { getCompanyVariants } from "@/lib/company-intel";
import { searchWeb, type SearchResult } from "@/lib/web-search";
import type { Completeness } from "@/lib/article-signal";

import type { CompanyDetailArticle } from "./getCompanyDetail";

// ---------------------------------------------------------------------------
// Read-only two-layer article fallback for the Company Intel ArticlesTab.
// ---------------------------------------------------------------------------
// Source of truth: docs/diagnosis-snow-websearch.md
//
// Why this exists:
//   An indexed company (companies row present, e.g. Snowflake / SNOW) can have
//   a non-null companyDetail and a fully-mounted tab grid, yet zero articles in
//   the tab. getCompanyDetail() feeds ArticlesTab via a name-variant match on
//   articles.companies[] gated to published_at >= now-14d. When entity-tagging
//   only ever co-mentioned the company (Snowflake: 3 tagged rows ever, all >40
//   days old, despite 94 untagged text mentions in 30d), that query returns 0
//   rows and the tab reads "No coverage in last 30 days."
//
// What this provides (both layers are strictly read-only):
//   Layer 1 (own-DB text match): query articles whose title or content matches
//     a known surface-form variant of the company name, within a 30-day window,
//     gated at relevance_score >= 6 (the ingestion gate) so we surface only rows
//     the pipeline already judged financially relevant. These are REAL articles
//     with their REAL relevance_score, deduped against rows already in the tab.
//   Layer 2 (Exa web): only if tagged + Layer 1 are still below the threshold,
//     call searchWeb() and map SearchResult[] into synthetic CompanyDetailArticle
//     rows flagged isWebSourced so the tab can badge them. searchWeb persists
//     only to web_search_cache (6h TTL).
//
// What this does NOT do:
//   - No writes to articles, companies, or mention_count. Layer 1 only reads;
//     Layer 2's only persistence is searchWeb's web_search_cache row.
//   - No migrations, no schema changes.
//   - Nothing at all unless NEXT_PUBLIC_ARTICLES_WEB_FALLBACK_ENABLED === "true".
//     Default off: the function returns [] before any query, so the feature
//     ships dark and prod behavior is unchanged.
// ---------------------------------------------------------------------------

/** Minimum in-tab article count below which the fallback engages. */
export const ARTICLE_FALLBACK_MIN = 3;

const FALLBACK_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const MIN_RELEVANCE = 6;
const LAYER1_LIMIT = 20;
const WEB_LIMIT = 8;
const MAX_VARIANTS = 12;

// Mirrors getCompanyDetail's ARTICLE_COLS. We deliberately do NOT select
// `content` (avoids shipping paywall payloads to the client) even though Layer 1
// filters on it.
const ARTICLE_COLS =
  "id, title, source, url, published_at, sentiment, deal_type, relevance_score, sector, summary, relevance_reason, sentiment_reason, ingested_at";

type ArticleRow = {
  id: string;
  title: string | null;
  source: string | null;
  url: string | null;
  published_at: string | null;
  sentiment: string | null;
  deal_type: string | null;
  relevance_score: number | null;
  sector: string | null;
  summary: string | null;
  relevance_reason: string | null;
  sentiment_reason: string | null;
  ingested_at: string | null;
};

/** Feature flag, mirroring the PR #176 pattern. Default off (ships dark). */
export function isArticleFallbackEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ARTICLES_WEB_FALLBACK_ENABLED === "true";
}

function completenessOf(summary: string | null): Completeness {
  return summary && summary.length > 200 ? "summary" : "headline";
}

/**
 * Sanitize a variant for safe inclusion in a PostgREST `.or()` ilike value.
 * Drops anything that could break the or-group grammar (commas, parentheses,
 * asterisks, dots) and trims. Returns null when nothing usable remains.
 */
function safeIlikeNeedle(variant: string): string | null {
  const cleaned = variant.replace(/[(),*.]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 3) return null;
  return cleaned;
}

/**
 * Build a PostgREST `.or(...)` expression matching title OR content (case
 * insensitive) against any sanitized variant. Returns "" when no usable needle
 * exists, in which case the caller skips Layer 1.
 */
function buildTextMatchOr(variants: string[]): string {
  const needles = new Set<string>();
  for (const v of variants) {
    const n = safeIlikeNeedle(v);
    if (n) needles.add(n);
    if (needles.size >= MAX_VARIANTS) break;
  }
  if (needles.size === 0) return "";
  const clauses: string[] = [];
  for (const n of needles) {
    clauses.push(`title.ilike.*${n}*`);
    clauses.push(`content.ilike.*${n}*`);
  }
  return clauses.join(",");
}

function mapDbRow(r: ArticleRow): CompanyDetailArticle {
  return {
    id: r.id,
    title: r.title ?? "",
    source: r.source,
    url: r.url,
    publishedAt: r.published_at,
    sentiment: r.sentiment,
    dealType: r.deal_type,
    relevanceScore: r.relevance_score,
    sector: r.sector,
    summary: r.summary,
    relevanceReason: r.relevance_reason,
    sentimentReason: r.sentiment_reason,
    ingestedAt: r.ingested_at,
    sourceWinRate: null,
    sourceSampleSize: null,
    completeness: completenessOf(r.summary),
    isWebSourced: false,
    provenanceUrl: r.url,
  };
}

function mapWebResult(r: SearchResult): CompanyDetailArticle {
  return {
    id: `web:${r.url}`,
    title: r.title ?? "",
    source: r.source,
    url: r.url,
    publishedAt: r.publishedAt,
    sentiment: null,
    dealType: null,
    relevanceScore: null,
    sector: null,
    summary: r.summary && r.summary.length > 0 ? r.summary : null,
    relevanceReason: null,
    sentimentReason: null,
    ingestedAt: null,
    sourceWinRate: null,
    sourceSampleSize: null,
    completeness: completenessOf(r.summary ?? null),
    isWebSourced: true,
    provenanceUrl: r.url,
  };
}

/**
 * Compute the extra articles to append to the ArticlesTab list for a company
 * whose in-tab coverage is below ARTICLE_FALLBACK_MIN. Returns [] when the
 * feature flag is off or coverage already meets the threshold.
 *
 * Read-only. Does not mutate `existing`. The caller appends the returned rows
 * after the tagged rows; ArticlesTab ranks web-sourced rows last.
 *
 * @param existing  The rows already in the tab (from getCompanyDetail). Used
 *                  for the threshold check and to dedupe Layer 1 by id/url.
 * @param threshold Minimum coverage; defaults to ARTICLE_FALLBACK_MIN.
 *
 * Reachable from the /company/[id] Promise.all. Before adding .throwOnError(),
 * .abortSignal(), or an await outside this function's existing trys, read the
 * reject-safety block at the top of src/lib/sec-filings.ts.
 */
export async function getArticleFallback(
  supabase: SupabaseClient,
  canonicalName: string,
  existing: CompanyDetailArticle[],
  displayName: string,
  threshold: number = ARTICLE_FALLBACK_MIN,
): Promise<CompanyDetailArticle[]> {
  if (!isArticleFallbackEnabled()) return [];
  if (existing.length >= threshold) return [];

  const seenIds = new Set(existing.map((a) => a.id));
  const seenUrls = new Set(
    existing.map((a) => a.url).filter((u): u is string => !!u),
  );
  const result: CompanyDetailArticle[] = [];

  // Layer 1: own-DB text match (real rows, real relevance_score).
  try {
    const variants = getCompanyVariants(canonicalName);
    const orExpr = buildTextMatchOr(variants);
    if (orExpr) {
      // Title-match needles: the (tightened) variants, lowercased. A row qualifies
      // only when one appears in the TITLE, not body-only. This drops the
      // thin-coverage pollution where a high-relevance article about another
      // company merely names this one in its body. Combined with the
      // common-word guard in getCompanyVariants, it also blocks wrong-entity
      // matches. See docs/recon/fallback-validation.md (options 1 + 2).
      const titleNeedles = variants
        .map((v) => v.toLowerCase())
        .filter((v) => v.length > 0);
      const cutoff = new Date(Date.now() - FALLBACK_WINDOW_DAYS * DAY_MS).toISOString();
      const { data, error } = await supabase
        .from("articles")
        .select(ARTICLE_COLS)
        .or(orExpr)
        .gte("published_at", cutoff)
        .gte("relevance_score", MIN_RELEVANCE)
        .order("relevance_score", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(LAYER1_LIMIT);
      if (error) {
        console.error("[getArticleFallback] layer1 error:", error.message);
      } else {
        for (const row of (data ?? []) as ArticleRow[]) {
          if (seenIds.has(row.id)) continue;
          if (row.url && seenUrls.has(row.url)) continue;
          const title = (row.title ?? "").toLowerCase();
          if (!titleNeedles.some((n) => title.includes(n))) continue;
          seenIds.add(row.id);
          if (row.url) seenUrls.add(row.url);
          result.push(mapDbRow(row));
        }
      }
    }
  } catch (e) {
    console.error("[getArticleFallback] layer1 threw:", e);
  }

  // Layer 2: Exa web, only if tagged + Layer 1 still short of the threshold.
  if (existing.length + result.length < threshold) {
    try {
      const web = await searchWeb(`${displayName} stock news`, WEB_LIMIT);
      for (const r of web) {
        if (!r.url || seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        result.push(mapWebResult(r));
      }
    } catch (e) {
      console.error("[getArticleFallback] layer2 threw:", e);
    }
  }

  return result;
}
