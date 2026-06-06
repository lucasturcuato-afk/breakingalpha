/**
 * Yahoo v8 chart quotes with a baseline-correct prior close.
 *
 * Why this exists: meta.chartPreviousClose on a range=1d chart call can anchor
 * to the close TWO sessions back. Observed live on ^RUT (2026-06-05): meta
 * said 2893.51 (the Jun 3 close) while the true prior close was 2935.33,
 * turning a -3.47% day into -2.07% in the UI. meta.previousClose is null for
 * caret indices, so it cannot correct it.
 *
 * The fix: request range=5d and derive the prior close from the actual last
 * two daily bars, in exchange-local days (meta.gmtoffset). All server routes
 * that quote Yahoo go through this helper so the baseline logic cannot drift
 * between call sites. Python twin: backend/market_tape.py (parse_yahoo_daily).
 */

export interface YahooDailyQuote {
  /** Live price (regularMarketPrice, falling back to the newest daily close). */
  price: number;
  /** Prior-session close. 0 when no baseline could be established. */
  prev: number;
  /** Percent change vs prev. 0 when prev is unavailable. */
  pct: number;
  /** Absolute change vs prev, same units as price. 0 when prev unavailable. */
  change: number;
  /** Unix seconds of the live quote (regularMarketTime), if provided. */
  ts: number | null;
}

const DAY_SECONDS = 86400;

/**
 * Parse a Yahoo v8 chart JSON body (interval=1d, range=5d) into a quote.
 *
 * prev resolution order:
 *   1. latest daily close whose session (exchange-local day) is strictly
 *      before the session of the live quote;
 *   2. meta.chartPreviousClose;
 *   3. meta.previousClose;
 *   4. none (pct/change report 0).
 * Steps 2-3 keep degraded responses (single bar, fresh listing, null-padded
 * closes) no worse than the old behavior. Never throws.
 */
export function parseYahooDaily(chartJson: unknown): YahooDailyQuote | null {
  try {
    const result = (chartJson as { chart?: { result?: unknown[] } })?.chart
      ?.result?.[0] as
      | {
          meta?: Record<string, unknown>;
          timestamp?: Array<number | null>;
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }
      | undefined;
    if (!result) return null;
    const meta = result.meta ?? {};

    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const bars: Array<{ ts: number; close: number }> = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const close = closes[i];
      if (ts != null && close != null && isFinite(close)) {
        bars.push({ ts, close });
      }
    }

    const rawPrice = meta.regularMarketPrice;
    const price =
      typeof rawPrice === "number" && isFinite(rawPrice) && rawPrice !== 0
        ? rawPrice
        : bars.length > 0
          ? bars[bars.length - 1].close
          : null;
    if (price == null || price === 0) return null;

    const gmtoffset = typeof meta.gmtoffset === "number" ? meta.gmtoffset : 0;
    const marketTs =
      typeof meta.regularMarketTime === "number"
        ? meta.regularMarketTime
        : bars.length > 0
          ? bars[bars.length - 1].ts
          : null;

    let prev: number | null = null;
    if (marketTs != null && bars.length > 0) {
      const quoteDay = Math.floor((marketTs + gmtoffset) / DAY_SECONDS);
      for (const bar of bars) {
        if (Math.floor((bar.ts + gmtoffset) / DAY_SECONDS) < quoteDay) {
          prev = bar.close; // keep iterating: we want the LATEST prior session
        }
      }
    }
    if (prev == null) {
      for (const key of ["chartPreviousClose", "previousClose"] as const) {
        const v = meta[key];
        if (typeof v === "number" && isFinite(v) && v !== 0) {
          prev = v;
          break;
        }
      }
    }

    if (prev != null && prev !== 0) {
      const pct = ((price - prev) / prev) * 100;
      return {
        price,
        prev,
        pct: parseFloat(pct.toFixed(2)),
        change: price - prev,
        ts: marketTs,
      };
    }
    return { price, prev: 0, pct: 0, change: 0, ts: marketTs };
  } catch {
    return null;
  }
}

/**
 * Fetch one symbol's daily quote from Yahoo. Yahoo uses hyphens for US class
 * shares (BRK-B not BRK.B); substitute at the boundary only. Returns null on
 * any failure (caller decides on fallbacks).
 */
export async function fetchYahooDaily(
  symbol: string,
  opts: { timeoutMs?: number } = {},
): Promise<YahooDailyQuote | null> {
  const yahooSymbol = symbol.replace(/\./g, "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol,
  )}?interval=1d&range=5d`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
      // Yahoo 403s plain server fetches; a browser UA is enough to pass.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Signalera/1.0)" },
    });
    if (!res.ok) return null;
    return parseYahooDaily(await res.json());
  } catch {
    return null;
  }
}
