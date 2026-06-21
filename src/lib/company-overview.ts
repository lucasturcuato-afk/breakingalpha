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

/**
 * Stable, order-independent hash of the grounding inputs. Used as the cache
 * invalidation key: a cached overview is reused only while this matches, so a
 * changed provider summary (or sector/industry) triggers one regeneration.
 * Not cryptographic; collision risk is irrelevant for a cache key.
 */
export function overviewSourceHash(inputs: OverviewInputs): string {
  const norm = [
    (inputs.name || "").trim(),
    (inputs.ticker || "").trim().toUpperCase(),
    (inputs.sector || "").trim().toLowerCase(),
    (inputs.industry || "").trim().toLowerCase(),
    (inputs.summary || "").trim().replace(/\s+/g, " "),
    (inputs.segments ?? []).map((s) => s.trim().toLowerCase()).sort().join("|"),
  ].join("␟"); // unit separator, will not appear in inputs

  // djb2, hex-encoded. Deterministic and dependency-free.
  let h = 5381;
  for (let i = 0; i < norm.length; i++) {
    h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
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
