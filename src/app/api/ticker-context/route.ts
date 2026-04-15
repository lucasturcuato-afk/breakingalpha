import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface TickerContextResponse {
  current_price: number | null;
  price_change_pct: number | null;
  price_change_pct_5d: number | null;
  price_change_pct_1mo: number | null;
  week52_high: number | null;
  week52_low: number | null;
  momentum_vs_thesis: number | null;
  options_implied_move: number | null;
  data_source: "Finnhub";
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function unixDaysAgo(days: number): number {
  return Math.floor((Date.now() - days * 86400000) / 1000);
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const ticker = searchParams.get("ticker");
  const thesisCreatedAt = searchParams.get("thesis_created_at");

  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FINNHUB_API_KEY not configured" }, { status: 500 });
  }

  const result: TickerContextResponse = {
    current_price: null,
    price_change_pct: null,
    price_change_pct_5d: null,
    price_change_pct_1mo: null,
    week52_high: null,
    week52_low: null,
    momentum_vs_thesis: null,
    options_implied_move: null,
    data_source: "Finnhub",
  };

  // Fetch quote for current price + daily change
  try {
    const quote = await fetchJson(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`
    );
    if (quote && typeof quote.c === "number" && (quote.c as number) > 0) {
      result.current_price = quote.c as number;
      const pc = quote.pc as number;
      if (pc && pc > 0) {
        result.price_change_pct =
          Math.round((((quote.c as number) - pc) / pc) * 10000) / 100;
      }
    }
  } catch {
    // field stays null
  }

  // 52-week candle
  try {
    const candle52w = await fetchJson(
      `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${unixDaysAgo(365)}&to=${unixNow()}&token=${apiKey}`
    );
    if (candle52w && candle52w.s === "ok") {
      const highs = candle52w.h as number[];
      const lows = candle52w.l as number[];
      if (Array.isArray(highs) && highs.length > 0) {
        result.week52_high = Math.max(...highs);
      }
      if (Array.isArray(lows) && lows.length > 0) {
        result.week52_low = Math.min(...lows);
      }
    }
  } catch {
    // field stays null
  }

  // 5-day candle for price_change_pct_5d
  try {
    const candle5d = await fetchJson(
      `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${unixDaysAgo(7)}&to=${unixNow()}&token=${apiKey}`
    );
    if (candle5d && candle5d.s === "ok") {
      const closes = candle5d.c as number[];
      if (Array.isArray(closes) && closes.length >= 2) {
        const oldest = closes[0];
        const newest = closes[closes.length - 1];
        if (oldest > 0) {
          result.price_change_pct_5d =
            Math.round(((newest - oldest) / oldest) * 10000) / 100;
        }
      }
    }
  } catch {
    // field stays null
  }

  // 1-month candle for price_change_pct_1mo
  try {
    const candle1mo = await fetchJson(
      `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${unixDaysAgo(35)}&to=${unixNow()}&token=${apiKey}`
    );
    if (candle1mo && candle1mo.s === "ok") {
      const closes = candle1mo.c as number[];
      if (Array.isArray(closes) && closes.length >= 2) {
        const oldest = closes[0];
        const newest = closes[closes.length - 1];
        if (oldest > 0) {
          result.price_change_pct_1mo =
            Math.round(((newest - oldest) / oldest) * 10000) / 100;
        }
      }
    }
  } catch {
    // field stays null
  }

  // Momentum vs thesis creation date
  if (thesisCreatedAt) {
    try {
      const thesisUnix = Math.floor(new Date(thesisCreatedAt).getTime() / 1000);
      if (!isNaN(thesisUnix) && thesisUnix > 0) {
        const candleThesis = await fetchJson(
          `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${thesisUnix}&to=${unixNow()}&token=${apiKey}`
        );
        if (candleThesis && candleThesis.s === "ok") {
          const closes = candleThesis.c as number[];
          if (Array.isArray(closes) && closes.length >= 2) {
            const oldest = closes[0];
            const newest = closes[closes.length - 1];
            if (oldest > 0) {
              result.momentum_vs_thesis =
                Math.round(((newest - oldest) / oldest) * 10000) / 100;
            }
          }
        }
      }
    } catch {
      // field stays null
    }
  }

  // Options implied move
  try {
    const optionData = await fetchJson(
      `https://finnhub.io/api/v1/stock/option-chain?symbol=${ticker}&token=${apiKey}`
    );
    if (
      optionData &&
      optionData.data &&
      Array.isArray(optionData.data) &&
      (optionData.data as unknown[]).length > 0
    ) {
      // Find nearest expiry
      const chain = optionData.data as Array<{
        expirationDate?: string;
        options?: { call?: Array<{ strike?: number; lastPrice?: number }>; put?: Array<{ strike?: number; lastPrice?: number }> };
      }>;
      const nearest = chain[0];
      if (nearest?.options?.call && nearest?.options?.put && result.current_price) {
        // Find ATM options (closest strike to current price)
        const cp = result.current_price;
        const calls = nearest.options.call;
        const puts = nearest.options.put;

        let bestCall: { strike?: number; lastPrice?: number } | null = null;
        let bestCallDist = Infinity;
        for (const c of calls) {
          if (c.strike != null && c.lastPrice != null) {
            const dist = Math.abs(c.strike - cp);
            if (dist < bestCallDist) {
              bestCallDist = dist;
              bestCall = c;
            }
          }
        }

        let bestPut: { strike?: number; lastPrice?: number } | null = null;
        let bestPutDist = Infinity;
        for (const p of puts) {
          if (p.strike != null && p.lastPrice != null) {
            const dist = Math.abs(p.strike - cp);
            if (dist < bestPutDist) {
              bestPutDist = dist;
              bestPut = p;
            }
          }
        }

        if (bestCall?.lastPrice != null && bestPut?.lastPrice != null && cp > 0) {
          const straddle = bestCall.lastPrice + bestPut.lastPrice;
          result.options_implied_move =
            Math.round((straddle / cp) * 10000) / 100;
        }
      }
    }
  } catch {
    // field stays null
  }

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "s-maxage=60, stale-while-revalidate=120",
    },
  });
}
