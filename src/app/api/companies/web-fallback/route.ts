/**
 * POST /api/companies/web-fallback
 *
 * Web-search-grounded fallback for the Company Intel page. Fired only by the
 * frontend when the existing /api/companies search returns zero results; this
 * route is additive and does not alter the indexed-search behavior.
 *
 * Auth: signed-in users only (mirrors /api/memo). The route returns a 401 when
 * unauthenticated and a 503 when the NEXT_PUBLIC_WEB_FALLBACK_ENABLED feature
 * flag is not "true". The flag default is off; Noah enables it in Vercel env.
 *
 * Read-only: this route never writes to `companies` or `company_mentions`.
 * Results are ephemeral; the only persistence is the 6-hour `web_search_cache`
 * row written by `searchWeb()`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { searchWeb, type SearchResult } from "@/lib/web-search";

export const dynamic = "force-dynamic";

export interface WebFallbackResponse {
  results: SearchResult[];
  canonicalName: string;
}

/**
 * Best-guess canonical name from the user's free-text query. Picks the longest
 * run of capitalized words, title-cased; falls back to title-casing every word.
 * The memo prompt receives this name so the model can treat all naming variants
 * (Mistral / Mistral AI / Mistral.ai) as one entity.
 */
function bestGuessCanonical(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";

  // Strip a trailing " company news" or " news" suffix if present (we add it
  // when calling searchWeb but the canonical name should not include it).
  const cleaned = trimmed.replace(/\s+(company\s+news|news|inc|corp|ltd)$/i, "").trim();

  // Look for runs of capitalized tokens (proper-noun phrase). Pick the longest.
  const tokens = cleaned.split(/\s+/);
  let bestRun: string[] = [];
  let currentRun: string[] = [];
  for (const t of tokens) {
    if (/^[A-Z][A-Za-z0-9.&'-]*$/.test(t)) {
      currentRun.push(t);
      if (currentRun.length > bestRun.length) bestRun = [...currentRun];
    } else {
      currentRun = [];
    }
  }
  if (bestRun.length > 0) return bestRun.join(" ");

  // Fall back to title-casing every word.
  return cleaned
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export async function POST(request: NextRequest) {
  // Feature flag gate. Default off; Noah flips this in Vercel prod env.
  if (process.env.NEXT_PUBLIC_WEB_FALLBACK_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Web fallback is not enabled" },
      { status: 503 },
    );
  }

  const { user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (query.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }
  if (query.length > 200) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }

  const canonicalName = bestGuessCanonical(query);
  // Disambiguate the search; the watchlist Exa call uses the same suffix so we
  // get news-shaped results rather than homepage / Wikipedia hits.
  const searchQuery = `${query} company news`;

  let results: SearchResult[] = [];
  try {
    results = await searchWeb(searchQuery, 8);
  } catch (err) {
    console.error("[api/companies/web-fallback] searchWeb failed:", err);
    return NextResponse.json(
      { error: "Web search failed" },
      { status: 502 },
    );
  }

  const payload: WebFallbackResponse = {
    results,
    canonicalName,
  };
  return NextResponse.json(payload);
}
