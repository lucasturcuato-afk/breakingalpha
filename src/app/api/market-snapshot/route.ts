import { NextResponse } from "next/server";
import { fetchYahooDaily } from "@/lib/yahoo-daily";

export const dynamic = "force-dynamic";

// Index, VIX, and 10Y are sourced from Yahoo Finance v8 via the shared
// fetchYahooDaily helper (same approach as src/app/api/market-indices/route.ts).
// Previously these used Finnhub: SPY (~$590, an ETF, not the index level) was
// relabeled "S&P 500", and VIX / TNX returned c:0 on Finnhub's free tier so
// those cards blanked out. Yahoo gives the real index level (^GSPC ~5,900-6,100)
// and populates VIX (^VIX) and the 10Y yield (^TNX).
//
// Each fetcher returns { price: string; pct: number } | null to match the
// shape landing-page.tsx consumes (marketData.sp500/.vix/.yield10y).

const YAHOO_TIMEOUT_MS = 6000;

async function fetchIndex(): Promise<{ price: string; pct: number } | null> {
  const q = await fetchYahooDaily("^GSPC", { timeoutMs: YAHOO_TIMEOUT_MS });
  if (!q || !q.price) return null;
  const price = q.price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return { price, pct: q.pct };
}

async function fetchVIX(): Promise<{ price: string; pct: number } | null> {
  const q = await fetchYahooDaily("^VIX", { timeoutMs: YAHOO_TIMEOUT_MS });
  if (!q || !q.price) return null;
  return { price: q.price.toFixed(2), pct: q.pct };
}

async function fetchTNX(): Promise<{ price: string; pct: number } | null> {
  const q = await fetchYahooDaily("^TNX", { timeoutMs: YAHOO_TIMEOUT_MS });
  if (!q || !q.price) return null;
  return { price: `${q.price.toFixed(2)}%`, pct: q.pct };
}

async function fetchSignalsToday(): Promise<{ count: number } | null> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return null;
    const todayISO = new Date().toISOString().split("T")[0] + "T00:00:00.000Z";
    const url = `${supabaseUrl}/rest/v1/articles?select=id&ingested_at=gte.${todayISO}&apikey=${supabaseKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return { count: data.length };
  } catch {
    return null;
  }
}

export async function GET() {
  const [spResult, vixResult, tnxResult, signalsResult] = await Promise.allSettled([
    fetchIndex(),
    fetchVIX(),
    fetchTNX(),
    fetchSignalsToday(),
  ]);

  const sp500 = spResult.status === "fulfilled" ? spResult.value : null;
  const vix = vixResult.status === "fulfilled" ? vixResult.value : null;
  const yield10y = tnxResult.status === "fulfilled" ? tnxResult.value : null;
  const signalsToday = signalsResult.status === "fulfilled" ? signalsResult.value : null;

  return NextResponse.json(
    { sp500, vix, yield10y, signalsToday },
    {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=90",
      },
    },
  );
}
