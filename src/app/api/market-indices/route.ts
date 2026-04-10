import { NextResponse } from "next/server";

// S&P 500: Stooq ^spx works reliably
async function fetchStooq(symbol: string): Promise<{ raw: number; pct: number } | null> {
  const url = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`;
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
  return { raw: close, pct };
}

// VIX and 10Y Yield: Yahoo Finance — Stooq returns N/D for these index symbols
async function fetchYahoo(symbol: string): Promise<{ raw: number; pct: number } | null> {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  const price: number = meta.regularMarketPrice;
  const prev: number = meta.chartPreviousClose ?? meta.previousClose ?? 0;
  const pct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
  return { raw: price, pct };
}

interface IndexData {
  value: string;
  pct: number;
}

interface CacheEntry {
  spx: IndexData | null;
  vix: IndexData | null;
  tnx: IndexData | null;
  ts: number;
}

let cache: CacheEntry | null = null;
const CACHE_MS = 90_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_MS) {
    return NextResponse.json(
      { ...cache, source: "cache" },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=90" } },
    );
  }

  const [spxRaw, vixRaw, tnxRaw] = await Promise.all([
    fetchStooq("^spx").catch(() => null),
    fetchYahoo("^VIX").catch(() => null),
    // ^TNX from Yahoo returns the yield as a plain number (e.g. 4.29 means 4.29%)
    fetchYahoo("^TNX").catch(() => null),
  ]);

  const fresh: CacheEntry = {
    spx: spxRaw
      ? {
          value: spxRaw.raw.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
          pct: spxRaw.pct,
        }
      : null,
    vix: vixRaw ? { value: vixRaw.raw.toFixed(2), pct: vixRaw.pct } : null,
    tnx: tnxRaw ? { value: `${tnxRaw.raw.toFixed(2)}%`, pct: tnxRaw.pct } : null,
    ts: Date.now(),
  };

  // Only replace cache if at least one fetch succeeded
  if (fresh.spx || fresh.vix || fresh.tnx) {
    cache = fresh;
  }

  return NextResponse.json(
    { ...(cache ?? fresh), source: "stooq+yahoo" },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=90" } },
  );
}
