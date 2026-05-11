import { NextRequest, NextResponse } from "next/server";

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
async function fetchYahoo(symbol: string): Promise<Quote | null> {
  // Yahoo Finance v8 uses hyphens for US class shares (BRK-B, BF-B, CWEN-A);
  // a period-form symbol returns "symbol may be delisted". Substitute at the
  // boundary only; the original form is preserved in the caller's response.
  const yahooSymbol = symbol.replace(/\./g, "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol,
  )}?interval=1d&range=1d`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    // Yahoo 403s plain server fetches — a browser UA is enough to pass.
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Signalera/1.0)" },
  });
  if (!res.ok) return null;
  const d = await res.json();
  const meta = d?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = Number(meta.regularMarketPrice ?? meta.previousClose);
  const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
  if (!price || isNaN(price)) return null;
  const pct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
  return { price: fmt(price), pct: parseFloat(pct.toFixed(2)) };
}

function isYahooFirst(symbol: string): boolean {
  // Caret-prefixed indices and futures (=F) are Finnhub-paid territory; go
  // straight to Yahoo for these.
  return symbol.startsWith("^") || symbol.includes("=");
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
      let data: Quote | null = null;
      if (isYahooFirst(symbol)) {
        data = await fetchYahoo(symbol).catch(() => null);
        if (!data && FINNHUB_KEY) {
          data = await fetchFinnhub(symbol, FINNHUB_KEY).catch(() => null);
        }
      } else {
        if (FINNHUB_KEY) {
          data = await fetchFinnhub(symbol, FINNHUB_KEY).catch(() => null);
        }
        if (!data) {
          data = await fetchYahoo(symbol).catch(() => null);
        }
      }
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
