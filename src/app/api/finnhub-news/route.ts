import { NextRequest, NextResponse } from "next/server";

interface FinnhubNewsItem {
  id: number;
  headline: string;
  source: string;
  url: string;
  summary: string;
  datetime: number;
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol)
    return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  if (!FINNHUB_KEY)
    return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 400 });

  try {
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(sevenDaysAgo)}&to=${fmt(today)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) return NextResponse.json({ articles: [] });

    const data: FinnhubNewsItem[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) return NextResponse.json({ articles: [] });

    const now = new Date().toISOString();
    const articles = data.map((item) => ({
      id: `finnhub-${String(item.id)}`,
      title: item.headline,
      source: item.source,
      url: item.url,
      summary: item.summary,
      published_at: new Date(item.datetime * 1000).toISOString(),
      ingested_at: now,
      sector: null,
      primary_company: null,
      industry_verticals: null,
      activity_types: null,
      relevance_score: null,
    }));

    return NextResponse.json({ articles });
  } catch {
    return NextResponse.json({ articles: [] });
  }
}
