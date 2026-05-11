/**
 * Lazy Finnhub ticker lookup. MUST stay logically identical to
 * backend/finnhub_helper.py.
 *
 * Algorithm: mention-count gate -> canonicalize -> Finnhub /search ->
 * filter to ACCEPTED_TYPES -> prefer no-period symbols + class-share
 * allowlist -> retry chain (suffix-strip, period-strip, first-2-tokens,
 * space-collapse, camelCase-split) -> q-too-long recovery at call level.
 *
 * Patch J changes:
 *   (a) Class-share allowlist `^[A-Z]{1,5}\.(A|B)$` (BRK.A, BRK.B).
 *   (b) ACCEPTED_TYPES extended with 'NY Reg Shrs' (ASML).
 *   (c) `q too long` -> retry with first-token only.
 *   (d) Space-collapse retry ("JP Morgan" -> "JPMorgan").
 *   (e) Pre-call canonicalize (Google -> Alphabet, Facebook -> Meta).
 *   (f) CamelCase split retry ("ExxonMobil" -> "Exxon Mobil").
 *
 * Failures are silent. 5s timeout. Caller MUST handle null.
 */

import { canonicalize } from "@/lib/company-intel";

// Patch J (b): 'NY Reg Shrs' admits ASML and similar NY-registered
// foreign issuers that Finnhub returns under that type rather than ADR.
const ACCEPTED_TYPES = new Set(["Common Stock", "ADR", "NY Reg Shrs"]);

// Patch J (a): class-share allowlist re-admits genuine US class shares
// (BRK.A, BRK.B) that the default no-period filter rejects.
const CLASS_SHARE_RE = /^[A-Z]{1,5}\.(A|B)$/;

// Hard overrides for names where Finnhub /search returns a worse-than-desired
// ticker (e.g. BRK.A, ~$700K/share with thin volume) but the better one (BRK.B)
// is reachable only by direct symbol query. Keys are lowercase post-canonicalize.
const HARD_TICKER_OVERRIDES: Record<string, string> = {
  "berkshire hathaway": "BRK.B",
  "celestica": "CLS",
  "tsmc": "TSM",
  "taiwan semiconductor": "TSM",
  "samsung": "SSNLF",
  "samsung electronics": "SSNLF",
  // Added from corrected C1f audit (3 high-confidence entries; mention_count
  // >= 5, ticker NULL, public US-listed via primary listing or ADR).
  "asml": "ASML",
  "novo nordisk": "NVO",
  "barclays": "BCS",
  // Raytheon -> RTX (NYSE:RTX, RTX Corporation, formerly Raytheon
  // Technologies). Standalone "Raytheon" row had ticker NULL with 7
  // mentions while canonical "RTX" row (8 mentions) had ticker=RTX.
  // CANONICAL map has no Raytheon entry so aliasResolver could not
  // cluster the two rows by ticker. Added per WD64-adjacent recon.
  "raytheon": "RTX",
};

// Patch J (f): brands where camelCase IS the canonical spelling -- skip
// the camelCase-split transform for these so we do not produce garbage.
const CAMELCASE_DENYLIST = new Set(
  ["iPhone", "eBay", "PayPal", "iPad", "iMac"].map((t) => t.toLowerCase()),
);

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

// Patch J (d): "JP Morgan" -> "JPMorgan". Skip if <3 chars.
function collapseSpaces(name: string): string | null {
  const collapsed = name.replace(/\s+/g, "");
  if (collapsed.length < 3 || collapsed === name.trim()) return null;
  return collapsed;
}

// Patch J (f): "ExxonMobil" -> "Exxon Mobil". Skip on no boundary or denylist.
function camelCaseSplit(name: string): string | null {
  const trimmed = name.trim();
  if (CAMELCASE_DENYLIST.has(trimmed.toLowerCase())) return null;
  const split = trimmed.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (split === trimmed) return null;
  return split;
}

// Patch J (c): on 4xx body containing `q too long`, retry once with
// only the first whitespace-separated token. The `_allowRetry` guard
// prevents recursion into another q-too-long branch.
async function doFinnhubCall(
  query: string,
  key: string,
  allowRetry = true,
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
    if (!res.ok) {
      if (allowRetry) {
        try {
          const body = await res.text();
          if (body.includes("q too long")) {
            const firstToken = query.trim().split(/\s+/)[0];
            if (firstToken && firstToken !== query.trim()) {
              return doFinnhubCall(firstToken, key, false);
            }
          }
        } catch {
          // fallthrough; treat as miss
        }
      }
      return null;
    }
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

  // Patch J (a): admit class-share symbols (BRK.A, BRK.B).
  const primary = candidates.filter((c) => {
    const ds = c.displaySymbol;
    if (typeof ds !== "string") return false;
    if (!ds.includes(".")) return true;
    return CLASS_SHARE_RE.test(ds);
  });
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

  const rawTrimmed = (companyName ?? "").trim();
  if (!rawTrimmed) return null;

  // Patch J (e): pre-call canonicalize (Google -> Alphabet, etc.).
  let base: string;
  try {
    base = canonicalize(rawTrimmed) || rawTrimmed;
  } catch {
    base = rawTrimmed;
  }
  if (!base) return null;

  const override = HARD_TICKER_OVERRIDES[base.toLowerCase()];
  if (override) return override;

  // Try the (canonicalized) name as-is first.
  const primary = await doFinnhubCall(base, key);
  if (primary !== null) {
    const sym = pickUsPrimary(primary);
    if (sym) return sym;
  }

  // Retry chain: cheapest semantic change first. Patch J appends
  // collapseSpaces and camelCaseSplit after the existing transforms.
  const seen = new Set<string>([base]);
  const transforms: Array<(s: string) => string | null> = [
    stripCorporateSuffix,
    stripInternalPeriods,
    firstTwoTokens,
    collapseSpaces,
    camelCaseSplit,
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
