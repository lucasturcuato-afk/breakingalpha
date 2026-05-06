/**
 * Lazy Finnhub ticker lookup. Used by the detail-page route at
 * src/app/company/[id]/page.tsx as a backstop when companies.ticker is
 * null.
 *
 * MUST stay logically identical to backend/finnhub_helper.py
 * (web-fallback ticker population on canonical creation) and
 * backend/scripts/backfill_tickers.py (one-time bulk backfill).
 *
 * Match algorithm (canonical, mirrored exactly from finnhub_helper.py):
 *   1. Mention-count gate: skip rows where mention_count < 2.
 *   2. Query Finnhub /search with the name as-is.
 *   3. Filter to type IN ('Common Stock', 'ADR'). ADRs cover foreign
 *      companies with US-listed depositary receipts (BABA, TSM, BUD, TM).
 *   4. Prefer matches whose displaySymbol does NOT contain a period
 *      (US primary listing). If no US-primary match, return null;
 *      foreign-only listings (.KS, .TO, .L, .DE, .HK) are NEVER written.
 *   5. If the primary call misses, retry once with each transform in
 *      sequence (cheapest semantic change first):
 *      a. Trailing corporate suffix stripped ("Hologic Inc." -> "Hologic")
 *      b. Internal periods stripped ("Warner Bros." -> "Warner Bros")
 *      c. First-2-tokens kept ("Warner Bros Discovery" -> "Warner Bros"),
 *         guarded by an ambiguous-prefix denylist so generic words like
 *         "Bank", "Capital", "Apple" do not fire false positives.
 *   6. If every retry misses: return null.
 *
 * Failures are silent. 5s timeout. Caller MUST handle null.
 */

const ACCEPTED_TYPES = new Set(["Common Stock", "ADR"]);

const MIN_MENTION_COUNT_FOR_LOOKUP = 2;

const CORPORATE_SUFFIXES = [
  "Corporation",
  "Incorporated",
  "Limited",
  "Company",
  "Holdings",
  "Holding",
  "Corp.",
  "Corp",
  "Inc.",
  "Inc",
  "Ltd.",
  "Ltd",
  "Co.",
  "Co",
  "LLC",
  "L.L.C.",
  "PLC",
  "plc",
  "P.L.C.",
  "S.A.",
  "SA",
  "N.V.",
  "NV",
  "GmbH",
  "AG",
  "SE",
];

// First-token denylist for the first-2-tokens retry. If the first
// token of the truncated candidate is in this set, the retry is
// skipped. Two categories: (a) hot single-name brands that are
// over-greedy when truncated to (Apple, Google, Meta, Amazon, etc.)
// and (b) generic finance descriptors (Bank, Capital, Holdings,
// Partners, etc.) that match too broadly when used as a 1-2 token
// prefix.
const AMBIGUOUS_FIRST_TOKENS = new Set(
  [
    "Apple",
    "Google",
    "Meta",
    "Amazon",
    "Microsoft",
    "Tesla",
    "Twitter",
    "Apollo",
    "Capital",
    "Group",
    "Bank",
    "Holdings",
    "Partners",
    "Asset",
    "Investments",
    "Securities",
    "Financial",
    "Global",
    "International",
    "Strategic",
    "Ventures",
    "Fund",
    "Trust",
    "Corp",
  ].map((t) => t.toLowerCase()),
);

interface FinnhubResultItem {
  description?: string;
  displaySymbol?: string;
  symbol?: string;
  type?: string;
}

interface FinnhubSearchResult {
  count: number;
  result?: FinnhubResultItem[];
}

function stripCorporateSuffix(name: string): string | null {
  const base = name.trim();
  const baseLower = base.toLowerCase();
  for (const suffix of CORPORATE_SUFFIXES) {
    const sl = suffix.toLowerCase();
    for (const boundary of [" ", ",", ", "]) {
      const tail = boundary + sl;
      if (baseLower.endsWith(tail)) {
        const stripped = base.slice(0, -tail.length).replace(/[\s,]+$/, "").trim();
        if (stripped && stripped !== base) return stripped;
        return null;
      }
    }
  }
  return null;
}

function stripInternalPeriods(name: string): string | null {
  if (!name.includes(".")) return null;
  const cleaned = name.replace(/\./g, " ").split(/\s+/).filter(Boolean).join(" ");
  if (!cleaned || cleaned === name.trim()) return null;
  return cleaned;
}

function firstTwoTokens(name: string): string | null {
  // Combined transform: take the first two tokens AND strip any internal
  // periods from the result. The combined operation rescues names like
  // "Warner Bros. Discovery": first-2-tokens alone yields "Warner Bros."
  // which Finnhub still fails to tokenize; chaining period-strip yields
  // "Warner Bros" which matches WBD.
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  if (AMBIGUOUS_FIRST_TOKENS.has(parts[0].toLowerCase())) return null;
  const raw = `${parts[0]} ${parts[1]}`;
  const candidate = raw.replace(/\./g, " ").split(/\s+/).filter(Boolean).join(" ");
  return candidate || null;
}

async function doFinnhubCall(
  query: string,
  key: string,
): Promise<FinnhubResultItem[] | null> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}`,
      {
        headers: { "X-Finnhub-Token": key },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as FinnhubSearchResult;
    const result = data.result;
    return Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}

function pickUsPrimary(result: FinnhubResultItem[]): string | null {
  const candidates = result.filter(
    (c) => typeof c.type === "string" && ACCEPTED_TYPES.has(c.type),
  );
  if (candidates.length === 0) return null;

  const primary = candidates.filter(
    (c) => typeof c.displaySymbol === "string" && !c.displaySymbol.includes("."),
  );
  if (primary.length === 0) return null;

  const sym = primary[0].symbol;
  if (typeof sym !== "string") return null;
  const trimmed = sym.trim();
  return trimmed || null;
}

interface FetchTickerOptions {
  /**
   * Mention count from the companies row. If provided and < 2, the
   * function returns null without calling Finnhub. Per Amendment 3 of
   * the rules-alignment sprint, 1-mention rows are extraction noise.
   */
  mentionCount?: number;
}

export async function fetchTickerFromFinnhub(
  companyName: string,
  options: FetchTickerOptions = {},
): Promise<string | null> {
  const { mentionCount } = options;
  if (typeof mentionCount === "number" && mentionCount < MIN_MENTION_COUNT_FOR_LOOKUP) {
    return null;
  }

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;

  const base = (companyName ?? "").trim();
  if (!base) return null;

  // Try the name as-is first.
  const primary = await doFinnhubCall(base, key);
  if (primary !== null) {
    const sym = pickUsPrimary(primary);
    if (sym) return sym;
  }

  // Retry chain: each transform produces at most one additional Finnhub
  // call. Order goes from cheapest semantic change to most aggressive.
  const seen = new Set<string>([base]);
  const transforms: Array<(s: string) => string | null> = [
    stripCorporateSuffix,
    stripInternalPeriods,
    firstTwoTokens,
  ];

  for (const transform of transforms) {
    const candidate = transform(base);
    if (candidate === null || seen.has(candidate)) continue;
    seen.add(candidate);
    const retry = await doFinnhubCall(candidate, key);
    if (retry === null) continue;
    const sym = pickUsPrimary(retry);
    if (sym) return sym;
  }

  return null;
}
