import { NextRequest, NextResponse } from "next/server";
import { fetchQuoteSummary } from "@/lib/yahoo/quoteSummary";

// GET /api/company-kpis?ticker=NVDA
//
// Lucas-protected: does NOT modify watchlist-utils.ts, WatchlistAddInput.tsx,
// trends/page.tsx, briefing/route.ts, or MemoModal.tsx.
//
// Returns { kind: 'live' | 'private' | 'price-only-fallback', ... } or 502.
// Cache: 60s s-maxage live, 24h private. Crumb cache module-level.

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/i;
const UA = "Mozilla/5.0 (compatible; Signalera/1.0)";
const V8_TIMEOUT_MS = 7000;
const CACHE_LIVE = "s-maxage=60, stale-while-revalidate=30";
const CACHE_PRIVATE = "s-maxage=86400, stale-while-revalidate=3600";

interface V8Meta { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number }
interface V8Body { chart?: { result?: Array<{ meta?: V8Meta }>; error?: { description?: string } | null } }

async function v8PriceFallback(ticker: string): Promise<{ last: number | null; change: number | null } | null> {
  // Mirrors /api/stock-chart period-to-hyphen substitution and UA pattern.
  const symbol = ticker.toUpperCase().replace(/\./g, "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

  let resp: Response;
  try {
    resp = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(V8_TIMEOUT_MS) });
  } catch { return null; }
  if (!resp.ok) return null;

  let body: V8Body;
  try { body = (await resp.json()) as V8Body; } catch { return null; }

  const meta = body.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const last = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
  const prev = typeof meta.chartPreviousClose === "number"
    ? meta.chartPreviousClose
    : typeof meta.previousClose === "number" ? meta.previousClose : null;
  const change = last !== null && prev !== null && prev !== 0 ? (last - prev) / prev : null;
  return { last, change };
}

export async function GET(request: NextRequest) {
  const ticker = (request.nextUrl.searchParams.get("ticker") ?? "").trim();
  if (!ticker || !TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "invalid ticker" }, { status: 400 });
  }
  const upperTicker = ticker.toUpperCase();

  try {
    const result = await fetchQuoteSummary(upperTicker);
    const headers = { "Cache-Control": result.kind === "private" ? CACHE_PRIVATE : CACHE_LIVE };
    return NextResponse.json(result, { headers });
  } catch {
    // v10 failed (crumb error, network, 5xx, repeated 401). Fall back to v8
    // chart for price-only. Recipe B9 expects no error toast.
    const fallback = await v8PriceFallback(upperTicker);
    if (fallback) {
      return NextResponse.json(
        { kind: "price-only-fallback", ticker: upperTicker, last: fallback.last, change: fallback.change },
        { headers: { "Cache-Control": CACHE_LIVE } },
      );
    }
    return NextResponse.json({ error: "upstream", ticker: upperTicker }, { status: 502 });
  }
}
