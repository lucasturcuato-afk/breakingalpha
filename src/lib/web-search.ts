/**
 * Web search adapter for the Company Intel web-fallback path.
 *
 * Wraps the existing Exa REST API (already used by backend/watchlist_sync.py
 * via the same EXA_API_KEY env var). The Python integration lives in
 * `backend/watchlist_sync.py:fetch_exa_articles`; this is the equivalent
 * TypeScript surface so the Node runtime can call Exa directly without a
 * cross-process hop.
 *
 * Designed so the underlying provider can swap (Brave, GDELT, etc.) by
 * changing only this file. Callers should treat the SearchResult shape as
 * the stable contract.
 *
 * Caching: results are persisted to the `web_search_cache` Supabase table
 * keyed on a SHA-256 hash of the normalized query string with a 6-hour TTL.
 * The cache uses the service-role key (mirrors /api/memo's personalization
 * reads). If the env var is missing, cache reads/writes soft-fail and the
 * caller still gets fresh Exa results.
 */
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { canonicalize } from "@/lib/company-intel";

export interface SearchResult {
  /** Source URL, after canonical normalization (no tracking params, no trailing slash). */
  url: string;
  /** Article or page title from the provider. */
  title: string;
  /** Provider-supplied summary or stitched highlights. May be empty. */
  summary: string;
  /** Origin domain extracted from the URL (e.g. "reuters.com"). */
  source: string;
  /** ISO 8601 publish date if the provider returned one; otherwise null. */
  publishedAt: string | null;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const EXA_ENDPOINT = "https://api.exa.ai/search";

function getCacheClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Service role only: web_search_cache has RLS on and no policy, so an anon
  // fallback would read empty and write nothing, silently. Missing key = no cache.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[web-search] SUPABASE_SERVICE_ROLE_KEY unset; search cache disabled");
    return null;
  }
  try {
    return createClient(url, key);
  } catch {
    return null;
  }
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashQuery(query: string): string {
  return createHash("sha256").update(normalizeQuery(query)).digest("hex");
}

/**
 * Strip tracking params, trailing slashes, fragment identifiers, and normalize
 * the protocol so equivalent URLs collapse to one cache key.
 */
function canonicalUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    // Force https for comparison; many providers return both http and https
    // for the same article.
    u.protocol = "https:";
    // Drop common tracking params
    const trackingParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "gclid", "fbclid", "mc_cid", "mc_eid", "ref", "ref_src", "_hsenc", "_hsmi",
    ];
    for (const p of trackingParams) u.searchParams.delete(p);
    // Drop the fragment
    u.hash = "";
    // Strip trailing slash on the path (but keep "/" for the root)
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    // Drop default ports
    if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) {
      u.port = "";
    }
    return u.toString();
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function extractDomain(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function readCache(queryHash: string): Promise<SearchResult[] | null> {
  const client = getCacheClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from("web_search_cache")
      .select("results, fetched_at")
      .eq("query_hash", queryHash)
      .maybeSingle();
    if (error || !data) return null;
    const fetchedAt = new Date(data.fetched_at as string).getTime();
    if (Number.isNaN(fetchedAt)) return null;
    if (Date.now() - fetchedAt > CACHE_TTL_MS) return null;
    const payload = data.results as unknown;
    if (Array.isArray(payload)) return payload as SearchResult[];
    return null;
  } catch {
    return null;
  }
}

async function writeCache(queryHash: string, query: string, results: SearchResult[]): Promise<void> {
  const client = getCacheClient();
  if (!client) return;
  try {
    await client.from("web_search_cache").upsert(
      {
        query_hash: queryHash,
        query,
        provider: "exa",
        results,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "query_hash" },
    );
  } catch {
    // Soft-fail; web-fallback should still work without the cache.
  }
}

interface ExaResultRaw {
  url?: string;
  title?: string;
  author?: string;
  publishedDate?: string;
  highlights?: string[] | null;
  text?: string;
}

interface ExaResponseRaw {
  results?: ExaResultRaw[];
}

async function fetchExa(query: string, limit: number): Promise<SearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    console.warn("[web-search] EXA_API_KEY not set; returning empty results");
    return [];
  }

  // Mirror the watchlist_sync.py shape: 30-day window, news category, auto type,
  // highlights for the summary field.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Exa caps numResults; request a few extra so dedup still leaves the caller's `limit`.
  const requestCount = Math.min(Math.max(limit * 2, 10), 25);

  let raw: ExaResponseRaw;
  try {
    const resp = await fetch(EXA_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        type: "auto",
        category: "news",
        numResults: requestCount,
        startPublishedDate: thirtyDaysAgo,
        contents: {
          highlights: {
            maxCharacters: 400,
            numSentences: 3,
          },
        },
      }),
    });
    if (resp.status === 401 || resp.status === 402) {
      console.warn(`[web-search] Exa API key issue (${resp.status}); returning empty results`);
      return [];
    }
    if (!resp.ok) {
      console.warn(`[web-search] Exa returned ${resp.status}`);
      return [];
    }
    raw = (await resp.json()) as ExaResponseRaw;
  } catch (err) {
    console.warn("[web-search] Exa fetch failed:", err instanceof Error ? err.message : err);
    return [];
  }

  const items = raw.results ?? [];
  const mapped: SearchResult[] = items
    .map((item): SearchResult | null => {
      const url = canonicalUrl(item.url ?? "");
      if (!url) return null;
      const title = (item.title ?? "").trim();
      if (title.length < 8) return null;
      const highlights = item.highlights ?? [];
      const summary = highlights.length > 0 ? highlights.join(" ") : (item.text ?? "").slice(0, 400);
      return {
        url,
        title,
        summary: summary.trim(),
        source: extractDomain(url) || (item.author ?? "Web"),
        publishedAt: item.publishedDate ?? null,
      };
    })
    .filter((r): r is SearchResult => r !== null);

  return mapped;
}

/**
 * Two-pass dedup:
 *   1. Collapse identical canonical URLs (highest-ranked - i.e. earliest in the
 *      provider's response - wins).
 *   2. Collapse results whose titles canonicalize to the same company name
 *      (so "Mistral", "Mistral AI", and "Mistral.ai" headlines map to one entity).
 *      The leading proper-noun phrase of the title is fed through canonicalize();
 *      the highest-ranked result per canonical name is kept.
 */
function dedupe(results: SearchResult[]): SearchResult[] {
  // Pass 1: by canonical URL
  const byUrl = new Map<string, SearchResult>();
  for (const r of results) {
    if (!byUrl.has(r.url)) byUrl.set(r.url, r);
  }

  // Pass 2: by canonical name extracted from the title's leading entity phrase.
  // We take the run of capitalized tokens (or up-to-5-token prefix) and feed it
  // through canonicalize(). If the result is too short to be a real company
  // name (under 3 chars), fall back to the URL as the dedup key.
  const byName = new Map<string, SearchResult>();
  for (const r of byUrl.values()) {
    const leadingEntity = extractLeadingEntity(r.title);
    const canonical = leadingEntity ? canonicalize(leadingEntity).toLowerCase() : "";
    const key = canonical.length >= 3 ? `name:${canonical}` : `url:${r.url}`;
    if (!byName.has(key)) byName.set(key, r);
  }

  return Array.from(byName.values());
}

function extractLeadingEntity(title: string): string {
  if (!title) return "";
  // Take up to the first 5 tokens before a punctuation break. We split on
  // colons, pipes, hyphens, bullets, commas, plus U+2014 (em-dash) and
  // U+2013 (en-dash) which appear in many news headlines. Using unicode
  // escapes so the source file contains no literal em-dash characters.
  const cut = title.split(/[:|\u2014\u2013\-\u2022,]/)[0].trim();
  const tokens = cut.split(/\s+/).slice(0, 5);
  return tokens.join(" ");
}

/**
 * Search the web for results relevant to `query`. Returns up to `limit` deduped
 * results in provider-rank order.
 *
 * @param query  Free-text search string. Caller is responsible for any
 *               disambiguation suffixes (e.g. "company news").
 * @param limit  Maximum number of results to return after dedup. Default 8.
 */
export async function searchWeb(query: string, limit: number = 8): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const queryHash = hashQuery(trimmed);

  // Cache read
  const cached = await readCache(queryHash);
  if (cached) {
    return cached.slice(0, limit);
  }

  // Provider call
  const fresh = await fetchExa(trimmed, limit);
  const deduped = dedupe(fresh);

  // Cache write (fire-and-forget; we still return even if it fails)
  void writeCache(queryHash, trimmed, deduped);

  return deduped.slice(0, limit);
}

/**
 * Internal helpers exported for testing / introspection only. Not part of the
 * public adapter contract.
 */
export const __internal = { canonicalUrl, extractLeadingEntity, dedupe, hashQuery };
