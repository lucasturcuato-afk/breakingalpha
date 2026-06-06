import { NextRequest, NextResponse } from "next/server";
import type { DisplayUnit } from "@/lib/format-change";
import { fetchYahooDaily } from "@/lib/yahoo-daily";

// How the card should be formatted for display.
type Format =
  | "index"       // SPY / QQQ / DIA / DXY → "5,847.22"
  | "vix"         // VIX → "18.3"
  | "yield"       // TNX → "4.21%"
  | "btc"         // BTC-USD → "$97,230" (no decimals over $100)
  | "futures";    // GC=F, CL=F → "$2,385.40"

// Asset class drives the markets-closed heuristic. Equity indices are gated
// to US exchange hours (09:30–16:00 ET, weekdays). Everything else trades
// ~24h so we never mark them "closed".
type AssetClass = "equity-index" | "24h";

// Known symbol → Yahoo Finance mapping + display labels.
// The key is the user-facing symbol (what the UI and DB store);
// `yahoo` is the query-parameter Yahoo expects.
//
// `displayUnit` controls how the change column is rendered downstream:
//   - "percent" (default): relative percent change with adaptive precision
//   - "bps": absolute delta in basis points (Treasury-yield convention)
const SYMBOL_MAP: Record<
  string,
  { yahoo: string; label: string; format: Format; assetClass: AssetClass; displayUnit?: DisplayUnit }
> = {
  // ── Canonical 10 symbols (in the picker) ──
  SPY:  { yahoo: "^GSPC",     label: "S&P 500",    format: "index",   assetClass: "equity-index" },
  QQQ:  { yahoo: "^IXIC",     label: "Nasdaq",     format: "index",   assetClass: "equity-index" },
  DIA:  { yahoo: "^DJI",      label: "Dow Jones",  format: "index",   assetClass: "equity-index" },
  VIX:  { yahoo: "^VIX",      label: "VIX",        format: "vix",     assetClass: "24h" },
  TNX:  { yahoo: "^TNX",      label: "10Y Yield",  format: "yield",   assetClass: "24h", displayUnit: "bps" },
  "BTC-USD": { yahoo: "BTC-USD", label: "Bitcoin",    format: "btc",     assetClass: "24h" },
  "GC=F":    { yahoo: "GC=F",    label: "Gold",       format: "futures", assetClass: "24h" },
  "CL=F":    { yahoo: "CL=F",    label: "Oil (WTI)",  format: "futures", assetClass: "24h" },
  "DX-Y.NYB": { yahoo: "DX-Y.NYB", label: "DXY",      format: "index",   assetClass: "equity-index" },

  // ── Legacy aliases (kept so previously-saved prefs still work) ──
  SPX:  { yahoo: "^GSPC",     label: "S&P 500",    format: "index",   assetClass: "equity-index" },
  IWM:  { yahoo: "IWM",       label: "Russell 2000", format: "index", assetClass: "equity-index" },
  GOLD: { yahoo: "GC=F",      label: "Gold",       format: "futures", assetClass: "24h" },
  GLD:  { yahoo: "GLD",       label: "Gold ETF",   format: "futures", assetClass: "24h" },
  OIL:  { yahoo: "CL=F",      label: "Oil (WTI)",  format: "futures", assetClass: "24h" },
  DXY:  { yahoo: "DX-Y.NYB",  label: "DXY",        format: "index",   assetClass: "equity-index" },
  BTC:  { yahoo: "BTC-USD",   label: "Bitcoin",    format: "btc",     assetClass: "24h" },
  "ETH-USD": { yahoo: "ETH-USD", label: "Ethereum", format: "btc",    assetClass: "24h" },
  ETH:  { yahoo: "ETH-USD",   label: "Ethereum",   format: "btc",     assetClass: "24h" },
  TLT:  { yahoo: "TLT",       label: "20Y Treasury", format: "futures", assetClass: "equity-index" },
};

interface YahooResult {
  raw: number;
  // Prior close in the same units as `raw`. Used for absolute-delta display
  // (bps for yields). 0 when upstream did not provide a usable prev close.
  prev: number;
  pct: number;
  // unix seconds of last quote from Yahoo (regularMarketTime)
  ts: number | null;
}

// Prior-close derivation lives in the shared lib/yahoo-daily helper: Yahoo's
// meta.chartPreviousClose can anchor two sessions back for caret symbols, so
// the helper derives prev from the actual last two daily bars instead.
async function fetchYahoo(symbol: string): Promise<YahooResult | null> {
  const q = await fetchYahooDaily(symbol);
  if (!q) return null;
  return { raw: q.price, prev: q.prev, pct: q.pct, ts: q.ts };
}

// Stooq is more reliable for ^spx than Yahoo on some days.
async function fetchStooq(symbol: string): Promise<YahooResult | null> {
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
  // Stooq's live CSV does not expose prior close, only today's OHLC. Using
  // today's open as the baseline produces an intraday change, not a vs-prev-
  // close change. Accept that approximation here because Stooq is only used
  // as a fallback when Yahoo fails.
  const pct = open > 0 ? ((close - open) / open) * 100 : 0;
  // Stooq returns date + time columns (1, 2) — combine if present
  let ts: number | null = null;
  if (cols[1] && cols[2]) {
    const parsed = Date.parse(`${cols[1]}T${cols[2]}Z`);
    if (!isNaN(parsed)) ts = Math.floor(parsed / 1000);
  }
  return { raw: close, prev: open, pct, ts };
}

interface CardData {
  symbol: string;
  label: string;
  value: string;
  /** Relative percent change vs prior close. */
  pct: number;
  /**
   * Absolute delta in the same units as the displayed value (e.g. for TNX
   * with a 4.36% yield, `change` is in percentage points, so bps = change*100).
   * 0 when prior close was unavailable upstream.
   */
  change: number;
  /** How the change column should be formatted. Defaults to "percent". */
  displayUnit: DisplayUnit;
  asOf: string | null;
  closed: boolean;
}

// Format a numeric value according to the mapped format.
function formatValue(raw: number, format: Format): string {
  switch (format) {
    case "index":
      // SPY / QQQ / DIA / DXY: "5,847.22"
      return raw.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    case "vix":
      // VIX: "18.3"
      return raw.toFixed(1);
    case "yield":
      // TNX / 10Y: "4.21%"
      return `${raw.toFixed(2)}%`;
    case "btc":
      // BTC: "$97,230" (no decimals over $100)
      return raw >= 100
        ? `$${Math.round(raw).toLocaleString("en-US")}`
        : `$${raw.toFixed(2)}`;
    case "futures":
      // GC=F / CL=F: "$2,385.40"
      return `$${raw.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
  }
}

// Threshold used to decide equity indices are "closed" when the timestamp
// surfaced by Yahoo is unusable. Anything staler than this (8h) counts
// as closed regardless of the ET-hours heuristic.
const STALE_MS = 8 * 60 * 60 * 1000;

// Returns true when US equity markets are likely closed: weekend, or outside
// 09:30–16:00 Eastern on a weekday. Applies only to `equity-index` assets.
function isUSMarketClosed(now = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

  if (weekday === "Sat" || weekday === "Sun") return true;

  const minutesSinceMidnight = hour * 60 + minute;
  const open = 9 * 60 + 30;  // 09:30
  const close = 16 * 60;     // 16:00
  return minutesSinceMidnight < open || minutesSinceMidnight >= close;
}

async function fetchSymbol(symbol: string): Promise<CardData> {
  const upper = symbol.toUpperCase();
  const mapped = SYMBOL_MAP[upper] ?? SYMBOL_MAP[symbol];
  const yahooSymbol = mapped?.yahoo ?? upper;
  const label = mapped?.label ?? upper;
  const format: Format = mapped?.format ?? "futures";
  const assetClass: AssetClass = mapped?.assetClass ?? "24h";
  const displayUnit: DisplayUnit = mapped?.displayUnit ?? "percent";

  // S&P 500 ETF: prefer Yahoo because its chart endpoint exposes
  // `chartPreviousClose`, which yields the correct vs-prior-close percent
  // change. Stooq's live CSV only has today's OHLC and would compute pct
  // against today's open (off by the overnight gap). Stooq stays as a
  // fallback when Yahoo is unavailable.
  let result: YahooResult | null = null;
  try {
    if (upper === "SPY" || upper === "SPX") {
      result = await fetchYahoo(yahooSymbol).catch(() => null);
      if (!result) result = await fetchStooq("^spx").catch(() => null);
    } else {
      result = await fetchYahoo(yahooSymbol).catch(() => null);
    }
  } catch {
    result = null;
  }

  // Per-symbol failure: still return a card so the UI can render a placeholder.
  if (!result) {
    return {
      symbol: upper,
      label,
      value: "—",
      pct: 0,
      change: 0,
      displayUnit,
      asOf: null,
      closed: assetClass === "equity-index" && isUSMarketClosed(),
    };
  }

  const asOf =
    result.ts != null ? new Date(result.ts * 1000).toISOString() : null;

  // Closed logic: equity-index asset class only. Prefer the ET-hours
  // heuristic (most accurate) and fall back to the staleness threshold
  // if the upstream timestamp is clearly old.
  let closed = false;
  if (assetClass === "equity-index") {
    closed = isUSMarketClosed();
    if (!closed && result.ts != null) {
      const ageMs = Date.now() - result.ts * 1000;
      if (ageMs > STALE_MS) closed = true;
    }
  }

  return {
    symbol: upper,
    label,
    value: formatValue(result.raw, format),
    pct: result.pct,
    change: result.prev > 0 ? result.raw - result.prev : 0,
    displayUnit,
    asOf,
    closed,
  };
}

// Cache per-symbol-set (stringified key).
const cache = new Map<string, { data: Record<string, CardData>; ts: number }>();
const CACHE_MS = 90_000;

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        // SIGNALS is client-side only — never fetch it.
        .filter((s) => s !== "SIGNALS")
    : ["SPY", "VIX", "TNX"];

  const cacheKey = symbols.join(",");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return NextResponse.json(
      { cards: cached.data, source: "cache" },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=90" } },
    );
  }

  // Parallel fetch — one slow feed shouldn't block the others. Each call is
  // guarded so one bad symbol never takes down the rest.
  const results = await Promise.all(symbols.map((s) => fetchSymbol(s)));

  const data: Record<string, CardData> = {};
  symbols.forEach((sym, i) => {
    data[sym] = results[i];
  });

  // Only update cache if at least one fetch produced a real value.
  if (results.some((r) => r.value !== "—")) {
    cache.set(cacheKey, { data, ts: Date.now() });
  }

  // Backwards compatibility: also expose spx/vix/tnx keys used by older callers.
  const compat: Record<string, { value: string; pct: number } | null> = {
    spx: data.SPY && data.SPY.value !== "—" ? { value: data.SPY.value, pct: data.SPY.pct } : null,
    vix: data.VIX && data.VIX.value !== "—" ? { value: data.VIX.value, pct: data.VIX.pct } : null,
    tnx: data.TNX && data.TNX.value !== "—" ? { value: data.TNX.value, pct: data.TNX.pct } : null,
  };

  return NextResponse.json(
    { cards: data, ...compat, source: "yahoo+stooq" },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=90" } },
  );
}
