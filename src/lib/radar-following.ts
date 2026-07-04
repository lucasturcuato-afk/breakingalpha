/**
 * radar-following — follow-matching against the ALREADY-INGESTED corpus.
 *
 * Hard rule: follows NEVER trigger per-follow external API calls. Every
 * matcher here reads tables the pipeline already populates:
 *   industry/activity -> articles.industry_verticals / activity_types
 *                        (whitelist-validated 11+11 taxonomy arrays)
 *   ticker/company    -> primary_company/title ILIKE over resolved names
 *                        (the watchlist-utils precedent; articles carry
 *                        no ticker column, so tickers resolve to company
 *                        names at follow-creation time)
 *   topic             -> content_embeddings via the existing
 *                        match_content_embeddings RPC (the follow phrase
 *                        is embedded ONCE at creation and stored on the
 *                        follows row), plus a keyword ILIKE complement.
 *
 * The article select deliberately EXCLUDES sentiment: Following renders
 * descriptive copy only (honesty rule), enforced structurally by never
 * loading evaluative fields.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface FollowRow {
  id: string;
  follow_type: "ticker" | "company" | "industry" | "activity" | "topic";
  target: string;
  display_name: string | null;
  matched_keywords: string[] | null;
  embedding: string | null; // pgvector comes back as a string
  muted: boolean;
  created_at: string;
}

export interface FollowArticle {
  id: string;
  title: string;
  source: string | null;
  summary: string | null;
  url: string | null;
  published_at: string | null;
  industry_verticals: string[] | null;
  activity_types: string[] | null;
  primary_company: string | null;
}

export interface FollowDevelopments {
  follow: Pick<FollowRow, "id" | "follow_type" | "target" | "display_name" | "muted">;
  articles: FollowArticle[];
}

// Descriptive fields only; no sentiment, no relevance_reason.
const ARTICLE_SELECT =
  "id, title, source, summary, url, published_at, industry_verticals, activity_types, primary_company";

const PER_FOLLOW_LIMIT = 8;
const DEFAULT_WINDOW_DAYS = 7;

/** PostgREST .or() condition escaping, per the watchlist-utils precedent:
 *  strip characters that would break the filter grammar. */
function safeIlikeTerm(term: string): string {
  return term.replace(/[,()%]/g, "").trim();
}

function keywordOrFilter(keywords: string[]): string | null {
  const conditions: string[] = [];
  for (const kw of keywords) {
    const safe = safeIlikeTerm(kw);
    if (!safe) continue;
    conditions.push(`primary_company.ilike.%${safe}%`);
    if (safe.length >= 6) conditions.push(`title.ilike.%${safe}%`);
  }
  return conditions.length ? conditions.join(",") : null;
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

async function matchTaxonomy(
  sb: SupabaseClient,
  column: "industry_verticals" | "activity_types",
  value: string,
  days: number,
): Promise<FollowArticle[]> {
  const { data, error } = await sb
    .from("articles")
    .select(ARTICLE_SELECT)
    .contains(column, [value])
    .gte("published_at", sinceIso(days))
    .order("published_at", { ascending: false })
    .limit(PER_FOLLOW_LIMIT);
  if (error) return [];
  return (data as FollowArticle[] | null) ?? [];
}

async function matchKeywords(
  sb: SupabaseClient,
  keywords: string[],
  days: number,
): Promise<FollowArticle[]> {
  const orFilter = keywordOrFilter(keywords);
  if (!orFilter) return [];
  const { data, error } = await sb
    .from("articles")
    .select(ARTICLE_SELECT)
    .or(orFilter)
    .gte("published_at", sinceIso(days))
    .order("published_at", { ascending: false })
    .limit(PER_FOLLOW_LIMIT);
  if (error) return [];
  return (data as FollowArticle[] | null) ?? [];
}

async function matchTopic(
  sb: SupabaseClient,
  follow: FollowRow,
  days: number,
): Promise<FollowArticle[]> {
  const results: FollowArticle[] = [];

  // Semantic leg: stored embedding through the existing RPC.
  if (follow.embedding) {
    const { data: matches, error } = await sb.rpc("match_content_embeddings", {
      query_embedding: follow.embedding,
      match_threshold: 0.3,
      match_count: 24,
    });
    if (!error && Array.isArray(matches)) {
      const articleIds = matches
        .filter((m: { content_type: string }) => m.content_type === "article")
        .map((m: { content_id: string }) => m.content_id)
        .slice(0, 24);
      if (articleIds.length) {
        const { data } = await sb
          .from("articles")
          .select(ARTICLE_SELECT)
          .in("id", articleIds)
          .gte("published_at", sinceIso(days))
          .order("published_at", { ascending: false })
          .limit(PER_FOLLOW_LIMIT);
        results.push(...((data as FollowArticle[] | null) ?? []));
      }
    }
  }

  // Keyword complement (exact phrase + stored expansions).
  if (results.length < PER_FOLLOW_LIMIT) {
    const keywords = [follow.target, ...(follow.matched_keywords ?? [])];
    const seen = new Set(results.map((a) => a.id));
    const byKeyword = await matchKeywords(sb, keywords, days);
    for (const a of byKeyword) {
      if (!seen.has(a.id)) {
        results.push(a);
        seen.add(a.id);
      }
      if (results.length >= PER_FOLLOW_LIMIT) break;
    }
  }
  return results.slice(0, PER_FOLLOW_LIMIT);
}

/**
 * Match one follow against the ingested corpus. Errors degrade to an
 * empty list (honest thin state), never a throw.
 */
export async function matchFollow(
  sb: SupabaseClient,
  follow: FollowRow,
  days: number = DEFAULT_WINDOW_DAYS,
): Promise<FollowArticle[]> {
  try {
    switch (follow.follow_type) {
      case "industry":
        return await matchTaxonomy(sb, "industry_verticals", follow.target, days);
      case "activity":
        return await matchTaxonomy(sb, "activity_types", follow.target, days);
      case "ticker":
      case "company": {
        const keywords = follow.matched_keywords?.length
          ? follow.matched_keywords
          : [follow.display_name ?? follow.target];
        return await matchKeywords(sb, keywords, days);
      }
      case "topic":
        return await matchTopic(sb, follow, days);
      default:
        return [];
    }
  } catch {
    return [];
  }
}
