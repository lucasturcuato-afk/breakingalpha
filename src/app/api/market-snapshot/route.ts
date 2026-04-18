import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function fetchSPY(apiKey: string): Promise<{ price: string; pct: number } | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=SPY&token=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.c || d.c === 0) return null;
    const pct = d.pc > 0 ? ((d.c - d.pc) / d.pc) * 100 : 0;
    const price = (d.c as number).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return { price, pct: parseFloat(pct.toFixed(2)) };
  } catch {
    return null;
  }
}

async function fetchVIX(apiKey: string): Promise<{ price: string; pct: number } | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=VIX&token=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.c || d.c === 0) return null;
    const pct = d.pc > 0 ? ((d.c - d.pc) / d.pc) * 100 : 0;
    return { price: (d.c as number).toFixed(2), pct: parseFloat(pct.toFixed(2)) };
  } catch {
    return null;
  }
}

async function fetchTNX(apiKey: string): Promise<{ price: string; pct: number } | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=%5ETNX&token=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.c || d.c === 0) return null;
    const pct = d.pc > 0 ? ((d.c - d.pc) / d.pc) * 100 : 0;
    return { price: `${(d.c as number).toFixed(2)}%`, pct: parseFloat(pct.toFixed(2)) };
  } catch {
    return null;
  }
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
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 500 });
  }

  const [spyResult, vixResult, tnxResult, signalsResult] = await Promise.allSettled([
    fetchSPY(apiKey),
    fetchVIX(apiKey),
    fetchTNX(apiKey),
    fetchSignalsToday(),
  ]);

  const sp500 = spyResult.status === "fulfilled" ? spyResult.value : null;
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
