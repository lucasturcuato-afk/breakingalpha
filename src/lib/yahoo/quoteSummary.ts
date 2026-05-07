// Yahoo v10 quoteSummary fetcher with crumb-auth.
//
// Lucas-protected: does NOT modify watchlist-utils.ts, WatchlistAddInput.tsx,
// trends/page.tsx, briefing/route.ts, or MemoModal.tsx.
//
// Phase 4 LOCKED field paths:
//   - defaultKeyStatistics.floatShares (NOT summaryDetail.floatShares)
//   - earningsHistory.history[] LAST element (oldest-first)
//   - price.marketCap (NOT summaryDetail.marketCap)

import { getCrumb, invalidateCrumb } from "@/lib/yahoo/crumbAuth";

const UA = "Mozilla/5.0 (compatible; Signalera/1.0)";
const FETCH_TIMEOUT_MS = 7000;
const MODULES = "price,summaryDetail,defaultKeyStatistics,financialData,earningsHistory,calendarEvents";

export interface QuoteSummaryLive {
  kind: "live";
  ticker: string;
  last: number | null;
  change: number | null; // decimal, 0.0214 = +2.14%
  marketCap: number | null;
  float: number | null;
  peTrailing: number | null;
  peForward: number | null;
  epsTrailing: number | null;
  epsForward: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  averageVolume: number | null;
  targetMeanPrice: number | null;
  nextEarningsDate: number | null; // unix seconds
  lastEarnings: { actualEPS: number | null; estimateEPS: number | null; surprisePct: number | null } | null;
}

export interface QuoteSummaryPrivate { kind: "private"; ticker: string; reason: string }
export type QuoteSummaryResult = QuoteSummaryLive | QuoteSummaryPrivate;

interface YahooRaw { raw?: number }
type YahooNumeric = number | YahooRaw | null | undefined;
interface YahooQuoteSummaryBody {
  quoteSummary?: {
    result?: Array<Record<string, unknown>> | null;
    error?: { code?: string; description?: string } | null;
  };
}

function num(v: YahooNumeric): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && typeof v.raw === "number" && Number.isFinite(v.raw)) return v.raw;
  return null;
}

// Yahoo v10/v8 use hyphens for class shares (BRK-B). Mirror /api/stock-chart.
const toSymbol = (t: string) => t.toUpperCase().replace(/\./g, "-");

async function fetchV10(symbol: string): Promise<Response> {
  const { cookie, crumb } = await getCrumb();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=${MODULES}&crumb=${encodeURIComponent(crumb)}`;
  return fetch(url, {
    headers: { "User-Agent": UA, Cookie: cookie },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

const isPrivateError = (b: YahooQuoteSummaryBody) => b.quoteSummary?.error?.code === "Not Found";

function mapResult(ticker: string, raw: Record<string, unknown>): QuoteSummaryLive {
  const price = (raw.price ?? {}) as Record<string, YahooNumeric>;
  const summary = (raw.summaryDetail ?? {}) as Record<string, YahooNumeric>;
  const stats = (raw.defaultKeyStatistics ?? {}) as Record<string, YahooNumeric>;
  const financial = (raw.financialData ?? {}) as Record<string, YahooNumeric>;
  const calendar = (raw.calendarEvents ?? {}) as { earnings?: { earningsDate?: YahooNumeric[] } };
  const history = ((raw.earningsHistory ?? {}) as { history?: Array<Record<string, YahooNumeric>> }).history ?? [];

  // Phase 4 lock: history is oldest-first, so most recent is LAST.
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;
  const lastEarnings = lastEntry ? {
    actualEPS: num(lastEntry.epsActual),
    estimateEPS: num(lastEntry.epsEstimate),
    surprisePct: num(lastEntry.surprisePercent),
  } : null;
  const earningsDateArr = calendar.earnings?.earningsDate ?? [];

  return {
    kind: "live",
    ticker,
    last: num(price.regularMarketPrice),
    change: num(price.regularMarketChangePercent),
    marketCap: num(price.marketCap),
    float: num(stats.floatShares),
    peTrailing: num(summary.trailingPE),
    peForward: num(summary.forwardPE),
    epsTrailing: num(stats.trailingEps),
    epsForward: num(stats.forwardEps),
    fiftyTwoWeekHigh: num(summary.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(summary.fiftyTwoWeekLow),
    volume: num(summary.regularMarketVolume) ?? num(price.regularMarketVolume),
    averageVolume: num(summary.averageVolume),
    targetMeanPrice: num(financial.targetMeanPrice),
    nextEarningsDate: earningsDateArr.length > 0 ? num(earningsDateArr[0]) : null,
    lastEarnings,
  };
}

export async function fetchQuoteSummary(ticker: string): Promise<QuoteSummaryResult> {
  const symbol = toSymbol(ticker);
  const upperTicker = ticker.toUpperCase();

  let resp: Response;
  try {
    resp = await fetchV10(symbol);
  } catch (e) {
    invalidateCrumb();
    throw e;
  }

  // Auth failure -> invalidate and retry exactly once.
  if (resp.status === 401 || resp.status === 403) {
    invalidateCrumb();
    resp = await fetchV10(symbol);
  }

  if (resp.status === 404) {
    let body: YahooQuoteSummaryBody = {};
    try { body = (await resp.json()) as YahooQuoteSummaryBody; } catch { /* noop */ }
    if (isPrivateError(body)) {
      return { kind: "private", ticker: upperTicker, reason: "Yahoo 404 -- private company or unlisted symbol" };
    }
    throw new Error(`quoteSummary 404 (non-private) for ${upperTicker}`);
  }
  if (!resp.ok) throw new Error(`quoteSummary upstream ${resp.status} for ${upperTicker}`);

  const body = (await resp.json()) as YahooQuoteSummaryBody;
  const result = body.quoteSummary?.result?.[0];
  if (!result) {
    if (isPrivateError(body)) {
      return { kind: "private", ticker: upperTicker, reason: "Yahoo returned no result -- private company or unlisted symbol" };
    }
    throw new Error(`quoteSummary empty result for ${upperTicker}`);
  }
  return mapResult(upperTicker, result);
}
