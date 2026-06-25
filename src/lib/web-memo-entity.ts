/**
 * Web-memo grounding-quality guards (eval PR #415 fixes).
 *
 * The web-fallback memo failed on thin, name-ambiguous tickers in two ways:
 *   Mode 1 - off-entity pool contamination: an Exa "Lake Shore Bancorp" search
 *     returns mostly OTHER "Shore" banks (Shore Bancshares, North Shore Bank),
 *     and the prompt's "treat all naming variants as one entity" folded them in,
 *     so the memo attributed another bank's $95M acquisition to the subject.
 *   Mode 2 - thin-pool confident generation: with only 1-2 genuinely on-entity
 *     results, the model built a whole thesis on a single (sometimes wrong) source.
 *
 * This module is pure (no IO) so it unit-tests under node:test and is shared by
 * the web-fallback route and the memo content builder.
 */

export interface WebResultLike {
  url: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string | null;
}

/** Fewer than this many on-entity results => render the thin-coverage state
 * instead of a confident brief. Named so it is tunable in one place. */
export const THIN_POOL_MIN_ON_ENTITY = 4;

/** A single significant token this long (and not generic) is distinctive enough
 * to identify the company on its own ("jpmorgan", "nvidia", "richtech"). Shorter
 * shared tokens ("shore", "lake", "first") are not. */
const DOMINANT_TOKEN_MIN_LEN = 6;

// Tokens that do NOT establish a specific company identity on their own. A name
// reduced to only these has no distinctive signal, so matching falls back to the
// distinctive multi-word phrase. "shore" is deliberately NOT here: it is the
// shared token in the contamination case, and the fix is to require the
// distinctive bigram ("lake shore"), not to treat "shore" as identifying.
const GENERIC_TOKENS = new Set([
  "the", "inc", "incorporated", "corp", "corporation", "co", "company",
  "companies", "ltd", "limited", "plc", "group", "holding", "holdings",
  "sa", "ag", "nv", "ab", "lp", "llc", "bancorp", "bancshares", "bank",
  "banks", "financial", "international", "intl", "technologies", "technology",
  "systems", "industries", "capital", "partners", "enterprises", "enterprise",
  "services", "solutions", "global", "ltd.",
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Whole-token containment (so "shore" does not match "offshore"). */
function hasToken(hay: string, token: string): boolean {
  if (!token) return false;
  return ` ${hay} `.includes(` ${token} `);
}

function significantTokens(canonical: string): string[] {
  return normalize(canonical)
    .split(" ")
    .filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
}

/**
 * Does this haystack (normalized title + summary) actually refer to the subject
 * company by NAME (ticker is checked separately by the caller)?
 *   - one distinctive long token present -> yes ("jpmorgan" in a JPMorgan piece)
 *   - single significant token -> require that token ("apple", "unum", "asml")
 *   - multiple significant tokens -> require the distinctive leading bigram
 *     ("lake shore") OR all significant tokens; a single shared token ("shore")
 *     is NOT enough.
 */
export function matchesName(canonical: string, normalizedHay: string): boolean {
  const sig = significantTokens(canonical);
  if (sig.length === 0) {
    // Name was all-generic; fall back to any of its tokens appearing.
    return normalize(canonical).split(" ").some((t) => t && hasToken(normalizedHay, t));
  }
  // A distinctive long token matches as a SUBSTRING so concatenated brand forms
  // resolve (e.g. "jpmorgan" inside "JPMorganChase"). Gated at length >= 6 so
  // short shared tokens ("shore", "first", "lake") never substring-match.
  if (sig.some((t) => t.length >= DOMINANT_TOKEN_MIN_LEN && normalizedHay.includes(t))) {
    return true;
  }
  if (sig.length === 1) return hasToken(normalizedHay, sig[0]);
  const bigram = `${sig[0]} ${sig[1]}`;
  if (normalizedHay.includes(bigram)) return true;
  return sig.every((t) => hasToken(normalizedHay, t));
}

export interface ClassifySubject {
  canonical: string;
  ticker?: string | null;
}

export interface ClassifiedResults<T extends WebResultLike = WebResultLike> {
  onEntity: T[];
  sectorContext: T[];
}

/**
 * Partition a result pool into rows that are actually about the subject
 * (on-entity) vs rows that merely share a token (sector context). A row is
 * on-entity if it passes matchesName on title+summary, OR its ticker appears in
 * the TITLE. Only on-entity rows are fed to the memo as subject material.
 *
 * The ticker test is title-scoped on purpose: a ticker buried in a body
 * quote-table of many unrelated stocks ("Old Second Bancorp (OSBC) ... also
 * lists LSBK 15.77") is a shared-token false positive, the same failure class as
 * a shared name token, and must not pull another company's article on-entity.
 */
export function classifyWebResults<T extends WebResultLike>(
  subject: ClassifySubject,
  results: readonly T[],
): ClassifiedResults<T> {
  const ticker = subject.ticker ? normalize(subject.ticker) : "";
  const onEntity: T[] = [];
  const sectorContext: T[] = [];
  for (const r of results) {
    const nameHit = matchesName(subject.canonical, normalize(`${r.title} ${r.summary}`));
    const tickerHit = ticker !== "" && hasToken(normalize(r.title), ticker);
    (nameHit || tickerHit ? onEntity : sectorContext).push(r);
  }
  return { onEntity, sectorContext };
}

export function isThinPool(onEntityCount: number): boolean {
  return onEntityCount < THIN_POOL_MIN_ON_ENTITY;
}

/**
 * Pick the name the entity filter should anchor on (Mode 1 root-cause fix).
 *
 * The web-fallback route derives the subject name from the result pool
 * (normalizeFromResults). When the pool is dominated by other same-token
 * companies, that derivation collapses to the bare high-frequency shared token:
 * a "Lake Shore Bancorp" pool full of Shore Bancshares / North Shore Bank rows
 * normalizes to "Shore". Anchoring the filter on "Shore" makes EVERY Shore bank
 * match, so no contaminant is dropped and the thin-pool gate never trips.
 *
 * Guard: if the pool-derived name is a single, short, non-distinctive token but
 * the query-derived name carries strictly more distinctive tokens, classify on
 * the query-derived name instead so matchesName requires the full distinctive
 * phrase ("lake shore"), not a shared token. A pool name that is already
 * distinctive (a long token like "nvidia", or two+ significant tokens like
 * "Pershing Square") is kept, preserving typo recovery.
 */
export function subjectForClassification(poolName: string, queryName: string): string {
  const poolSig = significantTokens(poolName);
  const querySig = significantTokens(queryName);
  const poolDistinctive =
    poolSig.some((t) => t.length >= DOMINANT_TOKEN_MIN_LEN) || poolSig.length >= 2;
  if (!poolDistinctive && querySig.length > poolSig.length) return queryName;
  return poolName;
}

// ---------------------------------------------------------------------------
// Citation check (Mode 2/3): verify each [n]-cited numeric claim actually
// appears in the cited result. Pure post-process; returns flags. Wiring it to
// DROP sentences in the live render is a one-line call in the (protected) memo
// render path -- see the eval doc follow-up.
// ---------------------------------------------------------------------------

export interface CitationFlag {
  sentence: string;
  citedIndices: number[];
  missingFigures: string[];
}

/** Extract digit-bearing figure tokens ($95, 11.3%, 2.93 billion, 9,834). */
function figureTokens(sentence: string): string[] {
  const out = new Set<string>();
  const re = /\$?\d[\d,.]*\s?(?:%|percent|billion|bn|million|mn|thousand|k)?/gi;
  for (const m of sentence.match(re) ?? []) {
    const digits = m.replace(/[^0-9]/g, "");
    if (digits.length >= 1) out.add(digits);
  }
  return [...out];
}

function splitSentences(memo: string): string[] {
  // Keep it simple: split on sentence terminators, retain the trailing [n] tags.
  return memo
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * For every sentence that carries [n] citations and a digit-bearing figure,
 * confirm the figure's digits appear in at least one cited result's
 * title+summary. Sentences whose figure is absent from ALL their cited results
 * are flagged (the [n] points somewhere the number is not).
 */
export function verifyMemoCitations(
  memo: string,
  results: readonly WebResultLike[],
): CitationFlag[] {
  const flags: CitationFlag[] = [];
  for (const sentence of splitSentences(memo)) {
    const citedIndices = [...sentence.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    if (citedIndices.length === 0) continue;
    const figs = figureTokens(sentence.replace(/\[\d+\]/g, ""));
    if (figs.length === 0) continue;
    const citedText = citedIndices
      .map((n) => results[n - 1])
      .filter(Boolean)
      .map((r) => `${r.title} ${r.summary}`.replace(/[^0-9]/g, ""))
      .join(" ");
    const missing = figs.filter((f) => !citedText.includes(f));
    if (missing.length > 0) {
      flags.push({ sentence, citedIndices, missingFigures: missing });
    }
  }
  return flags;
}

/**
 * Reconstruct the numbered subject result pool from the memo PROMPT content
 * (buildWebFallbackMemoContent output). The memo's [n] citations map to the
 * "WEB SEARCH RESULTS" list; the SECTOR CONTEXT block (different companies,
 * never cited) restarts its own numbering, so it is excluded.
 */
export function parseWebResultsFromContent(content: string): WebResultLike[] {
  const subjectPart = content.split(/^SECTOR CONTEXT/m)[0];
  const byIndex = new Map<number, string>();
  for (const line of subjectPart.split(/\r?\n/)) {
    const m = line.match(/^\[(\d+)\]\s+(.*)$/);
    if (m) byIndex.set(Number(m[1]), m[2]);
  }
  const max = byIndex.size === 0 ? 0 : Math.max(...byIndex.keys());
  const out: WebResultLike[] = [];
  for (let i = 1; i <= max; i++) {
    out.push({ url: "", title: byIndex.get(i) ?? "", summary: "", source: "", publishedAt: null });
  }
  return out;
}

/**
 * Citation enforcement (least-destructive): for each numeric-bearing sentence,
 * strip ONLY the [n] citations whose cited result contains none of the
 * sentence's figures, leaving the sentence prose intact. A sentence that loses
 * its only citation is kept as uncited prose, never deleted. Non-numeric
 * citations are never touched (the checker can false-positive on rephrased
 * figures, so it is conservative by design).
 */
export function enforceMemoCitations(memo: string, results: readonly WebResultLike[]): string {
  let out = memo;
  for (const sentence of splitSentences(memo)) {
    const citedIndices = [...sentence.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    if (citedIndices.length === 0) continue;
    const figs = figureTokens(sentence.replace(/\[\d+\]/g, ""));
    if (figs.length === 0) continue;
    let fixed = sentence;
    for (const n of citedIndices) {
      const res = results[n - 1];
      const resDigits = res ? `${res.title} ${res.summary}`.replace(/[^0-9]/g, "") : "";
      const supports = figs.some((f) => resDigits.includes(f));
      if (!supports) fixed = fixed.split(`[${n}]`).join("");
    }
    if (fixed !== sentence) {
      fixed = fixed.replace(/ {2,}/g, " ").replace(/\s+([.,;!?])/g, "$1").trim();
      out = out.replace(sentence, fixed);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Corroboration guard (Mode 2/B): the UNM failure asserted a single-source
// (and wrong) Q1 revenue figure that anchored a whole thesis. enforceMemoCitations
// only checks that SOME cited result carries the figure; it does not care how
// many sources do, and it compares bare digits, so "$2.93 billion" reads as
// corroborated by a source that actually said "$2.93 million". This guard
// requires a numeric claim to be CORROBORATED (same figure, compatible
// magnitude, in >= 2 distinct subject results) before it may stand as sourced.
// Single-source figures and order-of-magnitude mismatches lose their citation.
// ---------------------------------------------------------------------------

const MAGNITUDE_EXP: Record<string, number> = {
  k: 3, thousand: 3, thousands: 3,
  m: 6, mn: 6, million: 6, millions: 6,
  b: 9, bn: 9, billion: 9, billions: 9,
};

/** Minimum distinct subject results that must carry a figure for it to anchor a
 * claim as sourced. Two independent sources is the floor for corroboration. */
export const MIN_CORROBORATING_SOURCES = 2;

/** A figure as digits plus magnitude exponent (0 = none, 3/6/9 = k/m/b). The
 * exponent is what separates "$2.93 billion" (exp 9) from "$2.93 million"
 * (exp 6) so an order-of-magnitude mismatch is not read as agreement. */
interface ScaledFigure {
  digits: string;
  exp: number;
}

function scaledFigures(text: string): ScaledFigure[] {
  const out: ScaledFigure[] = [];
  // Only genuinely financial figures gate corroboration: a leading "$", a
  // trailing magnitude word, or a percent. This deliberately ignores bare
  // integers, quarter markers ("Q1"), and years ("2026", "2029") so they cannot
  // create spurious uncorroborated figures. Longest unit alternatives first; a
  // word boundary stops single-letter "b"/"m" from matching inside a word.
  const re = /(\$)?\s?(\d[\d,.]*)\s?(billions?|millions?|thousands?|bn|mn|[kmb]|%|percent)?\b/gi;
  for (const match of text.matchAll(re)) {
    const hasDollar = Boolean(match[1]);
    const digits = match[2].replace(/[^0-9]/g, "");
    if (!digits) continue;
    const unit = match[3]?.toLowerCase();
    if (!hasDollar && !unit) continue;
    out.push({ digits, exp: unit ? (MAGNITUDE_EXP[unit] ?? 0) : 0 });
  }
  return out;
}

/** A result corroborates a figure when it contains the same digits AND a
 * compatible magnitude (either side unitless, or the two exponents agree).
 * A billion-vs-million collision is NOT corroboration. */
function resultCorroborates(figure: ScaledFigure, resultFigures: ScaledFigure[]): boolean {
  return resultFigures.some(
    (rf) =>
      rf.digits === figure.digits &&
      (figure.exp === 0 || rf.exp === 0 || rf.exp === figure.exp),
  );
}

function corroboratingSourceCount(
  figure: ScaledFigure,
  perResultFigures: ScaledFigure[][],
): number {
  return perResultFigures.filter((rf) => resultCorroborates(figure, rf)).length;
}

/**
 * Strip the [n] citations from any numeric sentence whose figure is not
 * corroborated by at least MIN_CORROBORATING_SOURCES distinct subject results
 * (counting an order-of-magnitude mismatch as non-corroborating). Prose is left
 * intact, identical contract to enforceMemoCitations: a de-authorized figure
 * stays as text but no longer reads as a sourced fact, so it cannot anchor the
 * thesis. Conservative on percentages and bare counts, which often restate the
 * same value in different words across sources.
 */
export function enforceCorroboratedFigures(
  memo: string,
  results: readonly WebResultLike[],
): string {
  const perResultFigures = results.map((r) => scaledFigures(`${r.title} ${r.summary}`));
  let out = memo;
  for (const sentence of splitSentences(memo)) {
    const citedIndices = [...sentence.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    if (citedIndices.length === 0) continue;
    const figs = scaledFigures(sentence.replace(/\[\d+\]/g, ""));
    if (figs.length === 0) continue;
    const allCorroborated = figs.every(
      (f) => corroboratingSourceCount(f, perResultFigures) >= MIN_CORROBORATING_SOURCES,
    );
    if (allCorroborated) continue;
    let fixed = sentence;
    for (const n of citedIndices) fixed = fixed.split(`[${n}]`).join("");
    if (fixed !== sentence) {
      fixed = fixed.replace(/ {2,}/g, " ").replace(/\s+([.,;!?])/g, "$1").trim();
      out = out.replace(sentence, fixed);
    }
  }
  return out;
}
