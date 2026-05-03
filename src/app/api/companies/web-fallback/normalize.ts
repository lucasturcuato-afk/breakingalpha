/**
 * Canonical-name normalization for the web-fallback Company Intel path.
 *
 * The route handler hands the raw user query straight to Exa (Exa's fuzzy
 * match handles typos), but the canonical name we return to the client is
 * derived from the result evidence rather than the user's typing. This
 * recovers the correct entity name when the query has typos or wrong
 * casing, and keeps the value used by buildWebFallbackMemoSystemPrompt
 * grounded in what the model is actually about to read.
 *
 * Pure module: no IO, no env access, no logging. Safe to import from any
 * runtime.
 */
import type { SearchResult } from "@/lib/web-search";

/**
 * Generic page-furniture words that frequently appear as standalone
 * capitalized tokens in result titles or summaries (nav links, footer
 * boilerplate). Stripped from candidate set so they cannot win.
 * Keep small and obvious; over-aggressive filtering would block legitimate
 * 1-grams in adjacent positions.
 */
const STOPWORD_TITLES = new Set<string>([
  "news",
  "about",
  "home",
  "contact",
  "privacy",
  "privacy policy",
  "terms",
  "terms of service",
  "login",
  "sign in",
  "subscribe",
  "register",
  "menu",
  "search",
]);

/**
 * Dice-coefficient threshold for the similarity filter. A candidate must
 * exceed this against at least one query reference form to be eligible.
 * 0.6 is loose enough to clear common typos ("perishing" vs "pershing",
 * Dice ~0.92) and tight enough to drop unrelated proper nouns.
 */
const SIMILARITY_THRESHOLD = 0.6;

/**
 * Maximum n-gram length to mine from result text. 3 covers most multi-word
 * company names ("Pershing Square Capital") without exploding the candidate
 * set.
 */
const MAX_NGRAM_TOKENS = 3;

/**
 * Number of leading characters of each result's summary to mine for
 * candidates. Result titles are always mined in full; summaries are
 * truncated so a long article body cannot drown out title signal.
 */
const SUMMARY_PREFIX_CHARS = 200;

/**
 * Token regex matching one capitalized word, allowing common in-name
 * characters: digits, periods, ampersands, apostrophes, hyphens.
 * ASCII only; non-Latin proper nouns ("Société Générale") fall through
 * to the heuristic. Acceptable v1 limitation.
 */
const CAPITALIZED_TOKEN_RE = /^[A-Z][A-Za-z0-9.&'-]*$/;

/**
 * Extract runs of consecutive capitalized tokens from arbitrary text.
 * Returns each run as a single space-joined string.
 */
function extractCapitalizedRuns(text: string): string[] {
  const runs: string[] = [];
  let current: string[] = [];
  for (const t of text.split(/\s+/)) {
    if (CAPITALIZED_TOKEN_RE.test(t)) {
      current.push(t);
    } else if (current.length > 0) {
      runs.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) runs.push(current.join(" "));
  return runs;
}

/**
 * From each capitalized run, emit every contiguous 1- to maxN-token
 * subsequence. Trailing punctuation on individual tokens is stripped
 * (".", ",", "'", etc.) but inner punctuation is preserved
 * ("Booking.com", "AT&T"). Casing is preserved.
 */
function extractCapitalizedNgrams(text: string, maxN: number): string[] {
  const out: string[] = [];
  for (const run of extractCapitalizedRuns(text)) {
    const tokens = run
      .split(/\s+/)
      .map((t) => t.replace(/[.,;:!?'"]+$/, ""))
      .filter((t) => t.length > 0);
    for (let n = 1; n <= maxN; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const slice = tokens.slice(i, i + n).join(" ").trim();
        if (slice.length >= 2) out.push(slice);
      }
    }
  }
  return out;
}

/**
 * Bigram-based Sorensen-Dice coefficient on the input strings'
 * whitespace-stripped lowercase forms. Returns 1.0 for identical strings,
 * 0.0 for no shared bigrams. Pure ASCII bigrams; Unicode normalization
 * is left to the caller.
 */
function diceCoefficient(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const an = norm(a);
  const bn = norm(b);
  if (an.length < 2 || bn.length < 2) {
    return an === bn ? 1 : 0;
  }
  const bigramCounts = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ag = bigramCounts(an);
  const bg = bigramCounts(bn);
  let intersection = 0;
  for (const [g, ac] of ag) {
    intersection += Math.min(ac, bg.get(g) ?? 0);
  }
  const total = (an.length - 1) + (bn.length - 1);
  return (2 * intersection) / total;
}

/**
 * Derive a canonical company name from web search results, using the
 * user's query as a similarity anchor so we recover from typos and casing
 * errors. The returned string is what the API hands to the client and what
 * the memo system prompt interpolates as ${canonicalName}.
 *
 * Algorithm summary:
 *   1. Build the similarity-input set from the query: capitalized runs if
 *      any, else lowercased tokens. (Handles "Perishing Square" and
 *      "nvidia earnings" symmetrically.)
 *   2. Mine 1- to 3-grams of capitalized tokens from each result's title
 *      plus the first SUMMARY_PREFIX_CHARS of its summary. Count once per
 *      result so a single chatty result cannot dominate.
 *   3. Drop generic page-furniture stopwords ("News", "Home", etc.).
 *   4. Keep only candidates that share >= SIMILARITY_THRESHOLD Dice
 *      coefficient with at least one query reference form, OR that
 *      contain / are contained by one (substring fallback for short
 *      acronyms and exact-token matches).
 *   5. Sort by: count desc, then |form-tokens - query-tokens| asc, then
 *      total form-length asc.
 *   6. Top candidate must clear the >= 50% confidence threshold (appear
 *      in ceil(N/2) results). Otherwise return the heuristic fallback.
 *
 * Worked cases:
 *
 *   1. Typo case. query="Perishing Square" (2 tokens), 4/5 result titles
 *      contain "Pershing Square Capital Management". Mined 2-gram
 *      "Pershing Square" scores 4 (one per result, sub-gram counted once).
 *      Mined 1-gram "Pershing" also scores 4 (same titles). Both pass the
 *      similarity filter (Dice("pershing", "perishing") ~0.92, Dice on the
 *      2-grams ~0.85). Tie at count 4. Tie-break by query token closeness:
 *      |2-2|=0 beats |1-2|=1. Returns "Pershing Square".
 *
 *   2. Casing case. query="nvidia earnings", zero capitalized runs in the
 *      query. Falls back to lowercased tokens ["nvidia", "earnings"].
 *      "NVIDIA" appears in 5/5 result titles; lowercased it equals
 *      "nvidia", passes the filter on equality. Score 5 of 5. Returns
 *      "NVIDIA".
 *
 *   3. Legal-suffix case (the case Noah explicitly chose). query="Apple"
 *      (1 token), 4/5 titles contain "Apple Inc.". Both "Apple" 1-gram
 *      and "Apple Inc" 2-gram score 4 (sub-gram counted from each "Apple
 *      Inc."). Tie. Query token closeness: |1-1|=0 beats |2-1|=1.
 *      Returns "Apple". Matches Noah's "ties go to shorter" choice when
 *      query is 1 token.
 *
 *   4. Ambiguous case (known limitation). query="Bridgewater" (1 token),
 *      results split: "Bridgewater Bank" (3x), "Bridgewater Associates"
 *      (2x), plus standalone "Bridgewater" mentions. The 1-gram
 *      "Bridgewater" appears in all 5 results (sub-gram of every longer
 *      match), score 5. By count alone it dominates and never reaches
 *      tie-break. Returns "Bridgewater" (equivalent to the title-cased
 *      heuristic; not "Bridgewater Bank" as in the spec example). The
 *      simple n-gram approach cannot disambiguate when a 1-gram is
 *      subsumed by mutually exclusive multi-grams. Accepted v1 limitation;
 *      a maximal-run-only counting strategy could fix it in v2 at the
 *      cost of breaking case 1.
 *
 *   5. Fallback case. query="Acme XYZ Holdings", results have no
 *      capitalized n-gram that both passes the similarity filter and
 *      clears the 50% threshold. Returns the heuristic fallback as-is.
 */
export function normalizeFromResults(
  query: string,
  results: SearchResult[],
  fallback: string,
): string {
  if (results.length === 0) return fallback;

  // Build query reference forms for the similarity filter. Capitalized runs
  // are preferred (the user typed proper nouns); if there are none, fall
  // back to lowercased tokens so an all-lowercase query still gates
  // candidates against what the user actually typed.
  const queryRuns = extractCapitalizedRuns(query);
  const queryComparisonInputs: string[] =
    queryRuns.length > 0
      ? queryRuns.map((s) => s.toLowerCase())
      : query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (queryComparisonInputs.length === 0) return fallback;

  const queryTokenCount = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0).length;

  // Mine candidates from each result; count once per result.
  type CandidateInfo = { count: number; bestForm: string };
  const candidateScores = new Map<string, CandidateInfo>();
  for (const r of results) {
    const text = `${r.title}\n${(r.summary || "").slice(0, SUMMARY_PREFIX_CHARS)}`;
    const seenInThisResult = new Set<string>();
    for (const ng of extractCapitalizedNgrams(text, MAX_NGRAM_TOKENS)) {
      const key = ng.toLowerCase();
      if (STOPWORD_TITLES.has(key)) continue;
      if (seenInThisResult.has(key)) continue;
      seenInThisResult.add(key);
      const existing = candidateScores.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        // Preserve the first-seen casing as the rendering form.
        candidateScores.set(key, { count: 1, bestForm: ng });
      }
    }
  }

  // Similarity filter: keep only candidates anchored to the user's query.
  const filteredCandidates: { form: string; count: number }[] = [];
  for (const [key, info] of candidateScores) {
    let pass = false;
    for (const ref of queryComparisonInputs) {
      if (key === ref || key.includes(ref) || ref.includes(key)) {
        pass = true;
        break;
      }
      if (diceCoefficient(key, ref) >= SIMILARITY_THRESHOLD) {
        pass = true;
        break;
      }
    }
    if (pass) {
      filteredCandidates.push({ form: info.bestForm, count: info.count });
    }
  }
  if (filteredCandidates.length === 0) return fallback;

  // Sort: count desc, query-token-count proximity asc, total length asc.
  filteredCandidates.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const aDiff = Math.abs(a.form.split(/\s+/).length - queryTokenCount);
    const bDiff = Math.abs(b.form.split(/\s+/).length - queryTokenCount);
    if (aDiff !== bDiff) return aDiff - bDiff;
    return a.form.length - b.form.length;
  });

  // Confidence threshold: top must appear in at least half the results.
  const requiredCount = Math.ceil(results.length / 2);
  const top = filteredCandidates[0];
  if (top.count < requiredCount) return fallback;

  return top.form;
}

/**
 * Internal helpers exported for testing and introspection only. Not part
 * of the public module contract. Mirrors the pattern in src/lib/web-search.ts.
 */
export const __internal = {
  extractCapitalizedRuns,
  extractCapitalizedNgrams,
  diceCoefficient,
  STOPWORD_TITLES,
  SIMILARITY_THRESHOLD,
  MAX_NGRAM_TOKENS,
  SUMMARY_PREFIX_CHARS,
};
