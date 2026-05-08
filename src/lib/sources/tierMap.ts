/**
 * Source-credibility tier classifier (PR-C5, hard-coded per C8 mandate).
 * Exact-match lookup -- variant lists explicitly include feed-channel
 * suffixes (e.g. "Bloomberg Tech") because the article pool stores feed
 * names as ingested. Do NOT read from the `source_credibility` table here.
 */

export type Tier = 1 | 2 | 3;

const TIER_1: ReadonlySet<string> = new Set([
  "Bloomberg", "Bloomberg Tech", "Bloomberg Markets", "Bloomberg Opinion",
  "Reuters", "Reuters Tech", "Reuters Markets",
  "FT", "Financial Times", "FT Tech", "FT Markets", "FT Alphaville",
  "WSJ", "Wall Street Journal", "WSJ Markets", "WSJ Tech", "WSJ Opinion",
]);

const TIER_2: ReadonlySet<string> = new Set([
  "CNBC", "CNBC Tech", "Barron's", "Barrons",
]);

export function classifyTier(source: string | null | undefined): Tier {
  if (!source) return 3;
  const trimmed = source.trim();
  if (TIER_1.has(trimmed)) return 1;
  if (TIER_2.has(trimmed)) return 2;
  return 3;
}
