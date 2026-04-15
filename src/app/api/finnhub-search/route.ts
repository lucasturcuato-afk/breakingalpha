import { NextRequest, NextResponse } from "next/server";

interface FinnhubSearchItem {
  symbol: string;
  description: string;
  type: string;
  displaySymbol: string;
}

interface FinnhubSearchResponse {
  count: number;
  result: FinnhubSearchItem[];
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ results: [] });

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  if (!FINNHUB_KEY) return NextResponse.json({ results: [] });

  // ?all=1 skips type filtering (used by company mode to surface private-adjacent results)
  const allTypes = request.nextUrl.searchParams.get("all") === "1";

  console.log("[finnhub-search] query:", q, "| key present:", !!FINNHUB_KEY);

  try {
    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    console.log("[finnhub-search] Finnhub response status:", res.status);
    if (!res.ok) return NextResponse.json({ results: [] });

    const data: FinnhubSearchResponse = await res.json();
    if (!data?.result || !Array.isArray(data.result)) return NextResponse.json({ results: [] });

    const filtered = allTypes
      ? data.result
      : data.result.filter((item) => item.type === "Common Stock" || item.type === "ETP");

    const results = filtered.slice(0, 8).map((item) => ({
      symbol: item.displaySymbol,
      description: item.description,
    }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
