import { NextResponse } from "next/server";

const TICKERS = [
  { symbol: "SPY", stooq: "spy.us" },
  { symbol: "QQQ", stooq: "qqq.us" },
  { symbol: "AAPL", stooq: "aapl.us" },
  { symbol: "NVDA", stooq: "nvda.us" },
  { symbol: "MSFT", stooq: "msft.us" },
  { symbol: "META", stooq: "meta.us" },
  { symbol: "GOOGL", stooq: "googl.us" },
  { symbol: "AMZN", stooq: "amzn.us" },
  { symbol: "TSLA", stooq: "tsla.us" },
  { symbol: "GLD", stooq: "gld.us" },
  { symbol: "TLT", stooq: "tlt.us" },
  { symbol: "BTC", stooq: "btc.v" },
];

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

async function fetchFinnhub(symbol: string, apiKey: string) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const d = await res.json();
  if (!d.c || d.c === 0) return null;
  const pct =
    d.o > 0 ? ((d.c - d.o) / d.o) * 100 : ((d.c - d.pc) / d.pc) * 100;
  return { price: fmt(d.c), pct, raw: d.c };
}

async function fetchStooq(stooqSymbol: string) {
  const url = `https://stooq.com/q/l/?s=${stooqSymbol}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) return null;
  const cols = lines[1].split(",");
  const close = parseFloat(cols[6]);
  const open = parseFloat(cols[3]);
  if (isNaN(close) || close === 0) return null;
  const pct = open > 0 ? ((close - open) / open) * 100 : 0;
  return { price: fmt(close), pct, raw: close };
}

// Module-level cache (survives warm invocations)
let cache = { quotes: [] as { symbol: string; price: string; pct: number }[], ts: 0 };
const CACHE_MS = 90_000;

export async function GET() {
  if (Date.now() - cache.ts < CACHE_MS && cache.quotes.length > 0) {
    return NextResponse.json(
      { quotes: cache.quotes, source: "cache" },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "s-maxage=60, stale-while-revalidate=90",
        },
      }
    );
  }

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  const useFinnhub = !!FINNHUB_KEY;

  const results = await Promise.allSettled(
    TICKERS.map(async (t) => {
      let data = null;
      if (useFinnhub) {
        data = await fetchFinnhub(t.symbol, FINNHUB_KEY!).catch(() => null);
      }
      if (!data) {
        data = await fetchStooq(t.stooq).catch(() => null);
      }
      if (!data) return null;
      return { symbol: t.symbol, price: data.price, pct: data.pct };
    })
  );

  const quotes = results
    .filter(
      (r): r is PromiseFulfilledResult<{ symbol: string; price: string; pct: number } | null> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value)
    .filter((v): v is { symbol: string; price: string; pct: number } => v !== null);

  if (quotes.length > 0) {
    cache = { quotes, ts: Date.now() };
  }

  return NextResponse.json(
    {
      quotes: cache.quotes,
      source: useFinnhub ? "finnhub" : "stooq",
      count: cache.quotes.length,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "s-maxage=60, stale-while-revalidate=90",
      },
    }
  );
}
