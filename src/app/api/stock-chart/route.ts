import { NextRequest, NextResponse } from "next/server";

// Stock-chart proxy. Yahoo Finance v8 is keyless and already used elsewhere
// in this codebase (see /api/market-indices and /api/watchlist-quotes). Yahoo
// blocks plain server fetches without a UA, and the browser cannot hit Yahoo
// directly because of CORS, so this route is the simplest workaround.
//
// Validates `ticker` against a tight regex and `range` against an allow-list
// to avoid SSRF. Returns a flattened point array the chart component can
// render without knowing the upstream shape.

const RANGE_TO_INTERVAL: Record<string, string> = {
  "1d": "5m",
  "5d": "15m",
  "1mo": "1d",
  "3mo": "1d",
  "1y": "1wk",
  "5y": "1mo",
};

const ALLOWED_RANGES = new Set(Object.keys(RANGE_TO_INTERVAL));
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/i;

interface ChartPoint {
  t: number; // unix seconds
  c: number; // close price
}

interface ChartResponse {
  ticker: string;
  range: string;
  interval: string;
  points: ChartPoint[];
  price: number | null;
  prevClose: number | null;
  currency: string | null;
  source: "yahoo";
}

export async function GET(request: NextRequest) {
  const ticker = (request.nextUrl.searchParams.get("ticker") ?? "").trim();
  const range = (request.nextUrl.searchParams.get("range") ?? "3mo").trim().toLowerCase();

  if (!ticker || !TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "invalid ticker" }, { status: 400 });
  }
  if (!ALLOWED_RANGES.has(range)) {
    return NextResponse.json({ error: "invalid range" }, { status: 400 });
  }

  const interval = RANGE_TO_INTERVAL[range];
  const upperTicker = ticker.toUpperCase();
  // Yahoo Finance v8 uses hyphens for US class shares (BRK-B, BF-B, CWEN-A);
  // a period-form symbol returns "symbol may be delisted". Substitute at the
  // boundary only; the original form is preserved in the response body.
  const yahooTicker = upperTicker.replace(/\./g, "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooTicker,
  )}?interval=${interval}&range=${range}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      // Yahoo 403s server fetches without a browser-like UA. Same trick used
      // in /api/watchlist-quotes and /api/market-indices.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Signalera/1.0)" },
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    return NextResponse.json(
      { error: "upstream timeout", ticker: upperTicker },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `upstream ${upstream.status}`, ticker: upperTicker },
      { status: 502 },
    );
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    return NextResponse.json(
      { error: "upstream parse error", ticker: upperTicker },
      { status: 502 },
    );
  }

  const result = (
    data as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            currency?: string;
          };
        }>;
        error?: { description?: string } | null;
      };
    }
  )?.chart?.result?.[0];

  if (!result) {
    return NextResponse.json(
      { error: "no data", ticker: upperTicker },
      { status: 502 },
    );
  }

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points: ChartPoint[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c)) {
      points.push({ t: timestamps[i], c });
    }
  }

  const meta = result.meta;
  const body: ChartResponse = {
    ticker: upperTicker,
    range,
    interval,
    points,
    price:
      typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : null,
    prevClose:
      typeof meta?.chartPreviousClose === "number"
        ? meta.chartPreviousClose
        : typeof meta?.previousClose === "number"
          ? meta.previousClose
          : null,
    currency: typeof meta?.currency === "string" ? meta.currency : null,
    source: "yahoo",
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "s-maxage=300, stale-while-revalidate=60",
    },
  });
}
