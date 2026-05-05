/**
 * Lazy Finnhub ticker lookup. Used by the detail-page route at
 * src/app/company/[id]/page.tsx as a backstop when companies.ticker is
 * null. Same matching rules as backend/finnhub_helper.py
 * (Workstream B) and backend/scripts/backfill_tickers.py
 * (Workstream A) - keep them in sync.
 *
 * Failures are silent: 5s timeout, returns null on any error or
 * non-Common-Stock zero-match. Caller MUST handle null.
 */

interface FinnhubSearchResult {
  count: number;
  result: Array<{
    description?: string;
    displaySymbol?: string;
    symbol?: string;
    type?: string;
  }>;
}

export async function fetchTickerFromFinnhub(
  companyName: string,
): Promise<string | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(companyName)}`,
      {
        headers: { "X-Finnhub-Token": key },
        signal: AbortSignal.timeout(5000),
        // Cache off: this should always reflect current Finnhub data;
        // the persisted result in companies.ticker is the cache layer.
        cache: "no-store",
      },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as FinnhubSearchResult;
    const candidates = (data.result ?? []).filter(
      (c) => c.type === "Common Stock",
    );
    if (candidates.length === 0) return null;

    const primary = candidates.find(
      (c) => c.displaySymbol && !c.displaySymbol.includes("."),
    );
    const chosen = primary ?? candidates[0];
    return chosen.symbol ?? null;
  } catch {
    return null;
  }
}
