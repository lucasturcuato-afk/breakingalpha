import { NextRequest, NextResponse } from "next/server";
import { fetchYahooDaily } from "@/lib/yahoo-daily";

function fmt(price: number) {
  if (!price || isNaN(price)) return "—";
  if (price >= 1000)
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

type Quote = { price: string; pct: number };

async function fetchFinnhub(symbol: string, apiKey: string): Promise<Quote | null> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const d = await res.json();
  if (!d.c || d.c === 0) return null;
  const pct = d.pc > 0 ? ((d.c - d.pc) / d.pc) * 100 : 0;
  return { price: fmt(d.c), pct: parseFloat(pct.toFixed(2)) };
}

// Finnhub's free tier does not support index tickers (^GSPC, ^DJI, ^IXIC,
// ^RUT, ^TNX, ^VIX) or futures (CL=F, GC=F, etc.) — /quote returns c:0 for
// them. Yahoo Finance's public v8 chart endpoint fills the gap and is
// keyless. Used both as a primary for ^/= symbols and as a fallback for
// anything Finnhub blanks on.
//
// Prior-close derivation lives in the shared lib/yahoo-daily helper: Yahoo's
// meta.chartPreviousClose can anchor two sessions back for caret symbols, so
// the helper derives prev from the actual last two daily bars instead.
async function fetchYahoo(symbol: string): Promise<Quote | null> {
  const q = await fetchYahooDaily(symbol, { timeoutMs: 5000 });
  if (!q) return null;
  return { price: fmt(q.price), pct: q.pct };
}

function isYahooFirst(symbol: string): boolean {
  // Caret-prefixed indices and futures (=F) are Finnhub-paid territory; go
  // straight to Yahoo for these.
  return symbol.startsWith("^") || symbol.includes("=");
}

// Per-symbol module cache (survives warm invocations). Keyed by symbol, NOT by
// the requested symbol-set, so distinct watchlists share entries: when 50 users
// hold AAPL, the first request fetches it and the rest hit cache. 90s TTL
// matches /api/quotes and /api/market-indices. Only successful quotes are
// cached, so transient failures retry.
const quoteCache = new Map<string, { data: Quote; ts: number }>();
const CACHE_MS = 90_000;

async function getQuoteCached(
  symbol: string,
  finnhubKey: string | undefined,
): Promise<Quote | null> {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  let data: Quote | null = null;
  if (isYahooFirst(symbol)) {
    data = await fetchYahoo(symbol).catch(() => null);
    if (!data && finnhubKey) {
      data = await fetchFinnhub(symbol, finnhubKey).catch(() => null);
    }
  } else {
    if (finnhubKey) {
      data = await fetchFinnhub(symbol, finnhubKey).catch(() => null);
    }
    if (!data) {
      data = await fetchYahoo(symbol).catch(() => null);
    }
  }

  if (data) quoteCache.set(symbol, { data, ts: Date.now() });
  return data;
}

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols");
  if (!symbols)
    return NextResponse.json({ error: "symbols required" }, { status: 400 });

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

  const symbolList = symbols
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  const results = await Promise.allSettled(
    symbolList.map(async (symbol) => {
      const data = await getQuoteCached(symbol, FINNHUB_KEY);
      return { symbol, data };
    }),
  );

  const quotes: Record<string, Quote> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.data) {
      quotes[r.value.symbol] = r.value.data;
    }
  }

  return NextResponse.json(
    { quotes },
    {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=90",
      },
    },
  );
}
