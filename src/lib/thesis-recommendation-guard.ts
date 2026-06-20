/**
 * thesis-recommendation-guard.ts -- deterministic informational-only guard for
 * GENERATED theses (title + rationale).
 *
 * A registered rep cannot surface named-security directional recommendations.
 * Thesis titles historically opened with a directive prefix ("Buy AeroVironment
 * on Backlog Strength", "Long JPMorgan's European Retail Expansion", "Short
 * Defense Suppliers") and rationales closed with a recommended-vehicle line
 * ("The cleanest expression is AVAV, because ..."). Both cross the
 * informational-only line. This guard enforces descriptive framing
 * deterministically, because prompt text alone drifts under token pressure.
 *
 * Modeled EXACTLY on brief-voice-guard.ts (PR #389): detect -> one bounded
 * re-ask -> FAIL-CLOSED fallback. This module owns detection and the corrective
 * instruction; the caller injects the model call (`regenerate`) so this stays
 * pure and unit-testable with no network and no secrets.
 *
 * It touches ONLY the reader-facing title and rationale. The structured fields
 * the grader reads (conviction, ticker, horizon, verifiable_signal) are left
 * untouched, so direction survives via conviction and grading stays as-is.
 */

export interface ThesisViolations {
  /** Matched directional title prefix (lowercased), e.g. ["buy "]. */
  directionalTitle: string[];
  /** Recommended-vehicle / best-way-to-play phrases found. */
  vehicle: string[];
  /** Reader-directed recommendation/exposure phrases found. */
  recommendations: string[];
}

// Directional prefixes the old prompt mandated. Anchored to the title start.
const TITLE_PREFIX_PATTERN = /^\s*(?:buy|sell|long|short|avoid|watch)\b[\s:,-]*/i;

// Recommended-vehicle / best-way-to-play phrasings.
const VEHICLE_PATTERNS: RegExp[] = [
  /\b(?:the\s+)?cleanest\s+(?:expression|way\s+to\s+play)\b/gi,
  /\b(?:the\s+)?(?:best|purest|simplest)\s+(?:expression|way\s+to\s+play)\b/gi,
  /\bbest\s+way\s+to\s+(?:play|express)\b/gi,
];

// Reader-directed recommendations and exposure/sizing guidance. Ported verbatim
// from brief-voice-guard.ts RECOMMENDATION_PATTERNS so the two guards share one
// definition of "a recommendation".
const RECOMMENDATION_PATTERNS: RegExp[] = [
  /\brecommend(?:s|ed|ing|ation|ations)?\b/gi,
  /\b(?:over|under)weight\b/gi,
  /\byou\s+(?:should|must|need\s+to|ought|may\s+want\s+to|can|could)\b/gi,
  /\b(?:increase|increasing|reduce|reducing|raise|raising|lower|lowering|cut|cutting|boost|boosting|trim|trimming|pare|paring|build|building|scale|scaling)\s+(?:your\s+|the\s+)?(?:exposure|position|positions|stake|allocation|holdings?|weighting)\b/gi,
  /\b(?:buy|sell)\b(?![-\s](?:side|off))/gi,
  /\badd(?:ing)?\s+to\s+(?:your\s+|the\s+)?position\b/gi,
  /\btake\s+profits?\b/gi,
  /\bgo\s+(?:long|short)\b/gi,
];

function collectMatches(text: string, patterns: RegExp[]): string[] {
  const hits = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      hits.add(m[0].toLowerCase().replace(/\s+/g, " ").trim());
    }
  }
  return [...hits].filter(Boolean);
}

/** Pure detector over a thesis title + rationale. */
export function detectThesisViolations(
  title: string | null | undefined,
  rationale: string | null | undefined,
): ThesisViolations {
  const t = title ?? "";
  const r = rationale ?? "";
  const combined = `${t}\n${r}`;
  const prefix = TITLE_PREFIX_PATTERN.exec(t);
  return {
    directionalTitle: prefix ? [prefix[0].toLowerCase().replace(/\s+/g, " ").trim()] : [],
    vehicle: collectMatches(combined, VEHICLE_PATTERNS),
    recommendations: collectMatches(combined, RECOMMENDATION_PATTERNS),
  };
}

export function violationCount(v: ThesisViolations): number {
  return v.directionalTitle.length + v.vehicle.length + v.recommendations.length;
}

export function hasThesisViolation(
  title: string | null | undefined,
  rationale: string | null | undefined,
): boolean {
  return violationCount(detectThesisViolations(title, rationale)) > 0;
}

/**
 * Strip a single leading directional prefix so the title reads as analysis.
 * Capitalizes the new leading character. Idempotent.
 */
export function stripDirectionalTitle(title: string | null | undefined): string {
  let out = (title ?? "").replace(TITLE_PREFIX_PATTERN, "").trim();
  if (out) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

/**
 * Remove recommendation-bearing and recommended-vehicle content so the rationale
 * is provably free of any reader-directed recommendation or named-vehicle call.
 * Drops whole sentences that carry one (preserving compliant sentences and the
 * evidence/invalidation close), then neutralizes any residual token. Fallback
 * path only.
 */
export function redactRationale(text: string): string {
  const all = [...VEHICLE_PATTERNS, ...RECOMMENDATION_PATTERNS];
  const carries = (s: string): boolean =>
    all.some((re) => new RegExp(re.source, "i").test(s));

  const lines = (text ?? "").split("\n").map((line) => {
    if (!line.trim()) return line;
    const sentences = line.split(/(?<=[.!?])\s+/);
    return sentences.filter((s) => !carries(s)).join(" ");
  });

  let out = lines.join("\n");
  for (const re of all) {
    out = out.replace(new RegExp(re.source, "gi"), "[redacted]");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Corrective instruction appended to the original prompt for the bounded
 * re-ask. Names the detected violations so the model targets them.
 */
export function buildThesisCorrection(v: ThesisViolations): string {
  const found = [...v.directionalTitle, ...v.vehicle, ...v.recommendations];
  const foundLine = found.length
    ? `Detected violations to remove: ${found.map((f) => `"${f}"`).join(", ")}.`
    : "";
  return [
    "COMPLIANCE REWRITE REQUIRED. The previous thesis crossed the informational-only line. Rewrite the SAME thesis: same companies, same facts, same catalyst, same structure. Change ONLY the wording needed to comply. Return the rewritten title and rationale.",
    '1. DESCRIPTIVE TITLE: the title states what is changing and why it matters, as analysis. Remove any directional prefix ("Buy", "Sell", "Long", "Short", "Avoid", "Watch"). Name the security or theme as the SUBJECT, e.g. "AeroVironment Backlog Strengthens on New Orders", not "Buy AeroVironment".',
    '2. NO RECOMMENDED VEHICLE: do not name a security as the instrument to trade. Remove "the cleanest expression is [ticker]", "best way to play", and any buy/sell/long/short/overweight/underweight/recommend/"increase exposure"/"add to position" phrasing. Name the security as the subject of analysis. Keep an evidence or invalidation close ("What invalidates this: ...").',
    foundLine,
    "Keep the substance, the named companies, and the structure. Zero em-dashes; use periods and new sentences.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface ThesisEnforceOptions {
  /**
   * Inject the model call. Receives the corrective instruction and returns the
   * rewritten { title, rationale }, or null on any failure.
   */
  regenerate: (correction: string) => Promise<{ title: string; rationale: string } | null>;
  /** Max bounded re-asks. Brief guard uses one. Default 1. */
  maxReasks?: number;
}

export interface ThesisEnforceResult {
  title: string;
  rationale: string;
  violationsBefore: ThesisViolations;
  reasked: boolean;
  stillViolating: boolean;
}

/**
 * Detect -> bounded re-ask -> FAIL-CLOSED fallback. Never throws.
 *
 * Clean thesis: returned unchanged, no model call. Violating thesis: re-ask up
 * to maxReasks times and adopt the first fully clean result. If no draft comes
 * back clean, the fallback is FAIL-CLOSED: strip the directional title prefix and
 * redact recommendation/vehicle sentences from the rationale so the surfaced text
 * is provably free of any directional call.
 */
export async function enforceThesisRecommendation(
  title: string,
  rationale: string,
  opts: ThesisEnforceOptions,
): Promise<ThesisEnforceResult> {
  const before = detectThesisViolations(title, rationale);
  if (violationCount(before) === 0) {
    return { title, rationale, violationsBefore: before, reasked: false, stillViolating: false };
  }

  const maxReasks = opts.maxReasks ?? 1;
  let reasked = false;
  const candidates: Array<{ title: string; rationale: string }> = [{ title, rationale }];

  for (let i = 0; i < maxReasks; i++) {
    const last = candidates[candidates.length - 1];
    const correction = buildThesisCorrection(detectThesisViolations(last.title, last.rationale));
    const next = await opts.regenerate(correction);
    reasked = true;
    if (next && (next.title || next.rationale)) {
      const nt = next.title ?? "";
      const nr = next.rationale ?? "";
      if (!hasThesisViolation(nt, nr)) {
        return { title: nt, rationale: nr, violationsBefore: before, reasked, stillViolating: false };
      }
      candidates.push({ title: nt, rationale: nr });
    }
  }

  // No fully clean draft. A clean candidate wins; else fail closed by redaction.
  for (const c of candidates) {
    if (violationCount(detectThesisViolations(c.title, c.rationale)) === 0) {
      return { title: c.title, rationale: c.rationale, violationsBefore: before, reasked, stillViolating: false };
    }
  }

  const base = candidates[candidates.length - 1];
  const safeTitle = stripDirectionalTitle(base.title);
  const safeRationale = redactRationale(base.rationale);
  const after = detectThesisViolations(safeTitle, safeRationale);
  return {
    title: safeTitle,
    rationale: safeRationale,
    violationsBefore: before,
    reasked,
    stillViolating: violationCount(after) > 0,
  };
}
