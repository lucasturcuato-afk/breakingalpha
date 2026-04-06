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

async function fetchFinnhub(symbol: string, apiKey: string) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const d = await res.json();
  if (!d.c || d.c === 0) return null;
  const pct = d.pc > 0 ? ((d.c - d.pc) / d.pc) * 100 : 0;
  return { price: fmt(d.c), pct: parseFloat(pct.toFixed(2)) };
}

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols");
  if (!symbols)
    return NextResponse.json({ error: "symbols required" }, { status: 400 });

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  if (!FINNHUB_KEY)
    return NextResponse.json(
      { error: "FINNHUB_API_KEY not set" },
      { status: 500 }
    );

  const symbolList = symbols
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  const results = await Promise.allSettled(
    symbolList.map(async (symbol) => {
      const data = await fetchFinnhub(symbol, FINNHUB_KEY).catch(() => null);
      return { symbol, data };
    })
  );

  const quotes: Record<string, { price: string; pct: number }> = {};
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
    }
  );
}
