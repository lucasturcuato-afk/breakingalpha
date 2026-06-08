import { NextRequest, NextResponse } from "next/server";

function stripHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#038;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

interface FinnhubNewsItem {
  id: number;
  headline: string;
  source: string;
  url: string;
  summary: string;
  datetime: number;
}

type NewsArticle = {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string;
  published_at: string;
  ingested_at: string;
  sector: null;
  primary_company: null;
  industry_verticals: null;
  activity_types: null;
  relevance_score: null;
};

// Per-symbol module cache (survives warm invocations). Cuts repeat Finnhub
// company-news fan-out when many users hold the same ticker. 90s TTL matches
// /api/quotes and /api/market-indices.
const newsCache = new Map<string, { articles: NewsArticle[]; ts: number }>();
const CACHE_MS = 90_000;

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol)
    return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const cacheKey = symbol.toUpperCase();
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return NextResponse.json(
      { articles: cached.articles },
      { headers: { "X-Cache": "HIT" } },
    );
  }

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  if (!FINNHUB_KEY)
    return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 400 });

  try {
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(thirtyDaysAgo)}&to=${fmt(today)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) return NextResponse.json({ articles: [] });

    const data: FinnhubNewsItem[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) return NextResponse.json({ articles: [] });

    const now = new Date().toISOString();
    const articles: NewsArticle[] = data.map((item) => ({
      id: `finnhub-${String(item.id)}`,
      title: item.headline,
      source: item.source,
      url: item.url,
      summary: stripHtml(item.summary),
      published_at: new Date(item.datetime * 1000).toISOString(),
      ingested_at: now,
      sector: null,
      primary_company: null,
      industry_verticals: null,
      activity_types: null,
      relevance_score: null,
    }));

    newsCache.set(cacheKey, { articles, ts: Date.now() });

    return NextResponse.json({ articles }, { headers: { "X-Cache": "MISS" } });
  } catch {
    return NextResponse.json({ articles: [] });
  }
}
