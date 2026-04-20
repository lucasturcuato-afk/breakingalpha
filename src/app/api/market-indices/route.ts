import { NextRequest, NextResponse } from "next/server";

// Known symbol → Yahoo Finance mapping + display labels
const SYMBOL_MAP: Record<string, { yahoo: string; label: string; format: "price" | "pct" | "index" }> = {
  SPY:  { yahoo: "SPY",   label: "S&P 500",        format: "index" },
  SPX:  { yahoo: "^GSPC", label: "S&P 500",        format: "index" },
  VIX:  { yahoo: "^VIX",  label: "VIX Fear Index",  format: "price" },
  TNX:  { yahoo: "^TNX",  label: "10Y Yield",       format: "pct" },
  QQQ:  { yahoo: "QQQ",   label: "Nasdaq 100",      format: "index" },
  DIA:  { yahoo: "DIA",   label: "Dow Jones",       format: "index" },
  IWM:  { yahoo: "IWM",   label: "Russell 2000",    format: "index" },
  GLD:  { yahoo: "GLD",   label: "Gold",            format: "price" },
  TLT:  { yahoo: "TLT",   label: "20Y Treasury",    format: "price" },
  DXY:  { yahoo: "DX-Y.NYB", label: "US Dollar",    format: "price" },
};

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

// S&P 500: Stooq ^spx works more reliably than Yahoo for this specific index
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

interface CardData {
  symbol: string;
  label: string;
  value: string;
  pct: number;
}

async function fetchSymbol(symbol: string): Promise<CardData | null> {
  const upper = symbol.toUpperCase();
  const mapped = SYMBOL_MAP[upper];
  const yahooSymbol = mapped?.yahoo ?? upper;
  const label = mapped?.label ?? upper;
  const format = mapped?.format ?? "price";

  // Use Stooq for S&P 500 (more reliable), Yahoo for everything else
  let result: { raw: number; pct: number } | null = null;
  if (upper === "SPY" || upper === "SPX") {
    result = await fetchStooq("^spx").catch(() => null);
    if (!result) result = await fetchYahoo(yahooSymbol).catch(() => null);
  } else {
    result = await fetchYahoo(yahooSymbol).catch(() => null);
  }

  if (!result) return null;

  let value: string;
  if (format === "pct") {
    value = `${result.raw.toFixed(2)}%`;
  } else if (format === "index") {
    value = result.raw.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else {
    value = result.raw.toFixed(2);
  }

  return { symbol: upper, label, value, pct: result.pct };
}

// Cache per-symbol set (stringified key)
const cache = new Map<string, { data: Record<string, CardData | null>; ts: number }>();
const CACHE_MS = 90_000;

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : ["SPY", "VIX", "TNX"];

  const cacheKey = symbols.join(",");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return NextResponse.json(
      { cards: cached.data, source: "cache" },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=90" } },
    );
  }

  const results = await Promise.all(symbols.map(fetchSymbol));

  const data: Record<string, CardData | null> = {};
  symbols.forEach((sym, i) => {
    data[sym] = results[i];
  });

  // Only update cache if at least one fetch succeeded
  if (results.some((r) => r !== null)) {
    cache.set(cacheKey, { data, ts: Date.now() });
  }

  // Backwards compatibility: also expose spx/vix/tnx keys
  const compat: Record<string, { value: string; pct: number } | null> = {
    spx: data.SPY ? { value: data.SPY.value, pct: data.SPY.pct } : null,
    vix: data.VIX ? { value: data.VIX.value, pct: data.VIX.pct } : null,
    tnx: data.TNX ? { value: data.TNX.value, pct: data.TNX.pct } : null,
  };

  return NextResponse.json(
    { cards: data, ...compat, source: "yahoo+stooq" },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=90" } },
  );
}
