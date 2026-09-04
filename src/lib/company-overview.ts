/**
 * Coverage Primer business-overview normalization (pure helpers).
 *
 * The Primer's Business overview historically rendered the raw Yahoo
 * assetProfile summary, which is verbose, boilerplate-heavy, and inconsistent.
 * This module builds a strictly-grounded Gemini prompt that normalizes the
 * source into a clean 1-to-2-sentence factual overview, and provides a stable
 * source hash so the result can be cached per company and only regenerated when
 * the inputs materially change.
 *
 * Pure and unit-testable: no network, no Gemini call, no DB. The API route owns
 * the model call and the cache I/O; this module owns the prompt and the hash so
 * the grounded-only contract is asserted without a live model.
 */

export interface OverviewInputs {
  /** Canonical company name (also the cache key, target_company). */
  name: string;
  ticker: string | null;
  sector: string | null;
  industry: string | null;
  /** Raw provider business summary (Yahoo assetProfile). May be null/empty. */
  summary: string | null;
  /** Optional revenue/business segments, if ever available. Currently unused. */
  segments?: string[] | null;
}

/** Max characters for a normalized overview (a clean 1-to-2 sentences). */
export const OVERVIEW_MAX_CHARS = 320;

/** djb2, hex-encoded. Deterministic, dependency-free, not cryptographic. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/**
 * Stable, order-independent hash of the grounding inputs AND of the prompt that
 * turns them into an overview. Used as the cache invalidation key: a cached
 * overview is reused only while this matches, so a changed provider summary (or
 * sector/industry) triggers one regeneration.
 *
 * WHY THE PROMPT IS IN THE KEY. A cache key must cover everything that
 * determines the cached value, and the prompt determines it just as much as the
 * inputs do. Without the prompt in the key, rows written under an old prompt
 * outlive every later prompt fix: the fix ships, the hash still matches, and
 * every already-cached company keeps serving output the new instructions would
 * never have produced. `memo` avoids that with a hand-maintained
 * MEMO_PROMPT_VERSION constant. This does the same job WITHOUT the constant,
 * because a constant somebody has to remember to bump is the same
 * two-paths-one-fact shape as the bug this whole file exists to fix.
 * OVERVIEW_PROMPT_FINGERPRINT is derived from the prompt builder itself, so it
 * moves the moment the prompt moves and there is nothing to forget.
 *
 * THE TRADEOFF, STATED. Any edit to the prompt, cosmetic ones included,
 * invalidates every cached company. That costs exactly one regeneration per
 * company, once, and it is the conservative direction: serving stale output
 * silently is worse than paying for one refresh.
 *
 * `promptFingerprint` is a parameter, not an inlined read of the constant, so a
 * test can drive two different fingerprints through the real function and prove
 * the key actually depends on it. See company-overview.test.ts.
 */
export function overviewSourceHash(
  inputs: OverviewInputs,
  promptFingerprint: string = OVERVIEW_PROMPT_FINGERPRINT
): string {
  const norm = [
    (inputs.name || "").trim(),
    (inputs.ticker || "").trim().toUpperCase(),
    (inputs.sector || "").trim().toLowerCase(),
    (inputs.industry || "").trim().toLowerCase(),
    (inputs.summary || "").trim().replace(/\s+/g, " "),
    (inputs.segments ?? []).map((s) => s.trim().toLowerCase()).sort().join("|"),
    promptFingerprint,
  ].join("␟"); // unit separator, will not appear in inputs

  return djb2(norm);
}

/** True when there is no real source text to normalize (thin source). */
export function isThinSource(inputs: OverviewInputs): boolean {
  return !(inputs.summary && inputs.summary.trim().length >= 40);
}

/**
 * Build the system + user prompt for the normalization call. The grounded-only
 * and descriptive-only constraints live here verbatim so the unit tests pin
 * them. A thin source produces a shorter prompt that carries no facts to invent
 * from, and the instructions tell the model to return a shorter overview (or an
 * empty string) rather than pad.
 */
export function buildOverviewPrompt(inputs: OverviewInputs): { system: string; user: string } {
  const system = [
    "You normalize a company's business description into a clean, factual overview for an analyst coverage sheet.",
    "OUTPUT: 1 to 2 sentences stating what the company does and how it makes money. Plain text only, no headings, no markdown, no lead-in.",
    "STRICTLY GROUNDED: restate ONLY facts present in the inputs below. Never invent or infer figures, dates, market share, rankings, customers, or claims not in the inputs. If the inputs are thin, return a SHORTER overview (one short sentence) rather than padding. If there is no usable description at all, return an empty string.",
    "DESCRIPTIVE ONLY: no opinion, no outlook, no buy, sell, hold, recommendation, rating, price target, valuation judgment, or exposure or allocation language. Strip marketing and boilerplate (mission statements, 'leading provider', founding year, headquarters) unless they describe the actual business.",
    "Zero em-dashes. Use periods and commas.",
  ].join("\n");

  const lines: string[] = [`Company: ${inputs.name}`];
  if (inputs.ticker) lines.push(`Ticker: ${inputs.ticker}`);
  if (inputs.sector) lines.push(`Sector: ${inputs.sector}`);
  if (inputs.industry) lines.push(`Industry: ${inputs.industry}`);
  if (inputs.segments && inputs.segments.length > 0) {
    lines.push(`Segments: ${inputs.segments.join(", ")}`);
  }
  if (inputs.summary && inputs.summary.trim()) {
    lines.push(`Provider summary: ${inputs.summary.trim()}`);
  } else {
    lines.push("Provider summary: (none provided)");
  }

  const user = [
    "Inputs:",
    lines.join("\n"),
    "",
    "Return the normalized overview as plain text only.",
  ].join("\n");

  return { system, user };
}

/**
 * Fixed sentinel inputs used only to render the prompt for fingerprinting.
 *
 * Every field is present and constant, so the rendered probe exercises every
 * optional branch of the template (ticker/sector/industry/segments lines and the
 * provider-summary line). A template edit that adds, removes or relabels any of
 * those lines therefore changes the fingerprint. Values are deliberately
 * non-real so nobody mistakes this for a fixture.
 */
const PROMPT_FINGERPRINT_PROBE: OverviewInputs = {
  name: "␟probe",
  ticker: "␟T",
  sector: "␟s",
  industry: "␟i",
  summary: "␟summary",
  segments: ["␟seg"],
};

/**
 * A digest of the CURRENT prompt, computed from the real builder at module load.
 *
 * Not hand-maintained on purpose. The failure this avoids is a version constant
 * that someone forgets to bump after editing the prompt, which leaves the whole
 * cache serving output the edited prompt would never produce. Deriving it means
 * the prompt is the only place the fact lives.
 *
 * Cheap: one djb2 pass over a short string, once per process.
 */
export const OVERVIEW_PROMPT_FINGERPRINT: string = (() => {
  const { system, user } = buildOverviewPrompt(PROMPT_FINGERPRINT_PROBE);
  return djb2(`${system}␟${user}`);
})();

/**
 * Defensive post-processing of the model output: strip code fences/quotes,
 * collapse whitespace, drop em-dashes, and hard-cap length at a sentence
 * boundary. Returns "" for an empty or whitespace-only result so the caller can
 * fall back. Never throws.
 */
export function sanitizeOverview(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/^```[a-z]*\n?|\n?```$/gi, "").trim();
  s = s.replace(/^["']|["']$/g, "").trim();
  s = s.replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (s.length <= OVERVIEW_MAX_CHARS) return s;
  const slice = s.slice(0, OVERVIEW_MAX_CHARS);
  const stop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (stop > 120) return slice.slice(0, stop + 1);
  return slice.replace(/\s+\S*$/, "") + "...";
}

// ---------------------------------------------------------------------------
// Cache contract. ONE definition of the fact "which output_type row is a
// Coverage Primer overview", shared by the read filter and the write payload.
// ---------------------------------------------------------------------------

/**
 * The `outputs.output_type` value for a cached Primer overview.
 *
 * TWO PATHS, ONE FACT. Before this constant existed the route carried the
 * string "company_overview" twice: once in the cache-read filter and once in
 * the cache-write payload. Nothing tied them to each other or to the database
 * enum, so all three could disagree, and they did: the enum had no such member
 * at all, which 22P02'd BOTH the read filter and the write.
 *
 * The read filter and the write value now come from here. The third path, the
 * `public.output_type_enum` member itself, lives in the database and is pinned
 * by src/lib/outputs.enum.test.ts against a snapshot captured from it.
 */
export const COMPANY_OVERVIEW_OUTPUT_TYPE = "company_overview" as const;

/**
 * The complete equality filter that selects the ONE cached row usable right now.
 *
 * WHY THIS EXISTS AS A FUNCTION AND NOT THREE `.eq()` CALLS IN THE ROUTE.
 * The route reads with `.order(created_at desc).limit(1)`, so whatever this
 * filter does not narrow, recency decides. The original read narrowed on
 * output_type and target_company only, then checked the hash AFTER the row came
 * back. That is latest-row-wins, and it never hits, because PrimerTab POSTs two
 * DIFFERENT bodies per mount for any company that has both a curated
 * description and a live quote:
 *
 *   1. on mount, `quote` is null, so `resolvedIndustry` and `sourceSummary` are
 *      the CURATED values that came down with the page;
 *   2. once /api/company-kpis resolves, both of those are effect deps and both
 *      flip to the LIVE Yahoo assetProfile values, so the effect re-runs.
 *
 * Two bodies, two hashes, one cache key. Under latest-row-wins each read
 * returns the OTHER variant's row, fails the hash check, regenerates and writes
 * again, forever: a model call per variant per mount and two more rows each
 * time, with no upsert, no unique constraint and no TTL to stop it.
 *
 * Selecting ON the hash makes the two variants two independent cache entries
 * that both hit from the second mount on. It does NOT bound rows for all time:
 * a genuinely changed provider summary still adds a row and the superseded one
 * is never collected. That is growth on input change rather than growth per
 * page view, and reaping old rows is a separate piece of work.
 *
 * Returned as a descriptor rather than applied inline so the route can apply it
 * mechanically and a unit test can read the same object the route applies.
 * There is one definition of "which row is servable", not two.
 */
export function overviewCacheFilter(
  name: string,
  sourceHash: string
): Record<string, string> {
  return {
    output_type: COMPANY_OVERVIEW_OUTPUT_TYPE,
    "content->>target_company": name,
    "content->>source_hash": sourceHash,
  };
}

/**
 * The jsonb payload stored in `outputs.content` for a Primer overview.
 *
 * A `type` alias, not an `interface`, on purpose: recordOutput takes
 * `Record<string, unknown>` and TypeScript grants an implicit index signature to
 * type aliases but not to interfaces, so an interface here fails to assign.
 */
export type OverviewCacheContent = {
  target_company: string;
  overview: string;
  source_hash: string;
};

/**
 * Decide whether a cached row may be served for the current inputs.
 *
 * A hit requires a non-empty overview AND a source_hash equal to the current
 * inputs' hash. A stale hash is a miss, not a soft hit: the whole point of the
 * hash is that changed grounding inputs force exactly one regeneration.
 *
 * The hash compare is now defence in depth rather than the primary mechanism.
 * overviewCacheFilter selects ON the hash, so a mismatched row can no longer
 * come back from the query at all; this still catches a row whose overview is
 * empty or whitespace, which the filter cannot express. Both sides read the same
 * `hash` value, so this is one fact checked twice, not two facts that can drift.
 */
export function isOverviewCacheHit(
  cached: Partial<OverviewCacheContent> | null | undefined,
  currentHash: string
): boolean {
  if (!cached) return false;
  const overview = (cached.overview ?? "").trim();
  if (!overview) return false;
  return cached.source_hash === currentHash;
}

/**
 * Build the exact `recordOutput` payload for a Primer overview.
 *
 * Deliberately returns NO `source_id`. `outputs.source_id` is a uuid column and
 * this cache is keyed by company NAME, so passing the name there raised a
 * second, independent 22P02 ("invalid input syntax for type uuid") on the very
 * same insert. Adding the enum member alone would NOT have fixed the write.
 * The cache key lives in content.target_company, which is what the read filters
 * on, so source_id was never load-bearing here.
 */
export function buildOverviewCacheRow(
  name: string,
  overview: string,
  sourceHash: string
): {
  output_type: typeof COMPANY_OVERVIEW_OUTPUT_TYPE;
  content: OverviewCacheContent;
  source_table: string;
} {
  return {
    output_type: COMPANY_OVERVIEW_OUTPUT_TYPE,
    content: { target_company: name, overview, source_hash: sourceHash },
    source_table: "companies",
  };
}
