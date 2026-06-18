/**
 * brief-voice-guard.ts -- deterministic post-parse compliance guard for the
 * Company Intel per-company brief (/api/memo, types "company" and "company-web").
 *
 * Two compliance lines the generated brief must hold:
 *   1. Impersonal voice: no first person, singular OR plural. The prompt's
 *      VOICE REGISTER historically banned first-person singular but explicitly
 *      PERMITTED the institutional "we" ("We see...", "We recommend..."), which
 *      is exactly how "we/us/our" kept leaking back in despite a prior fix. The
 *      prompt is now tightened to ban all first person, but prompt text alone
 *      drifts under token pressure. This guard enforces it deterministically.
 *   2. Informational only: no reader-directed recommendation or exposure
 *      language ("we recommend", "increase/reduce exposure", "buy", "sell",
 *      "overweight", "you should", "trim", "add to position"). Scenario
 *      analysis ("If X: the thesis holds") is preserved; only reader-directed
 *      actions and named-security calls are rejected.
 *
 * Modeled on the PR #385 opener guard (backend/synthesize.py _is_opener_recap /
 * _regenerate_opener): deterministic detect -> one bounded re-ask -> safe
 * fallback. This module owns detection and the corrective instruction; the
 * caller injects the model call (`regenerate`) so this stays pure and
 * unit-testable with no network and no secrets.
 */

export interface VoiceViolations {
  /** Distinct first-person tokens found (lowercased), e.g. ["we", "our"]. */
  firstPerson: string[];
  /** Distinct recommendation/exposure phrases found (lowercased). */
  recommendations: string[];
}

// First person, singular and plural. Possessives and common contractions
// included. Bare "I" is handled separately (case-sensitive, with a lookbehind
// that skips enumerators like "Class I", "Phase I", "Series I").
const FIRST_PERSON_PATTERNS: RegExp[] = [
  /\b(?:we|us|our|ours|ourselves|me|my|mine|myself)\b/gi,
  /\b(?:we're|we've|we'll|we'd|i'm|i've|i'll|i'd|let's|lets)\b/gi,
  /(?<!\b(?:class|phase|series|type|tier|grade|category|part|level|form|section)\s)\bi\b/gi,
];

// Reader-directed recommendations and exposure/sizing guidance. Patterns are
// scoped to avoid the obvious false positives: action verbs are only flagged
// when bound to a position/exposure noun, and buy/sell exclude "sell-side",
// "buy-side", "sell-off" (and "buyback"/"selloff" never match on word
// boundaries to begin with).
const RECOMMENDATION_PATTERNS: RegExp[] = [
  /\brecommend(?:s|ed|ing|ation|ations)?\b/gi,
  /\b(?:over|under)weight\b/gi,
  /\byou\s+(?:should|must|need\s+to|ought|may\s+want\s+to|can|could)\b/gi,
  /\b(?:increase|increasing|reduce|reducing|raise|raising|lower|lowering|cut|cutting|boost|boosting|trim|trimming|pare|paring|build|building|scale|scaling)\s+(?:your\s+|the\s+)?(?:exposure|position|positions|stake|allocation|holdings?|weighting)\b/gi,
  /\b(?:buy|sell)\b(?!-side|-off)/gi,
  /\badd(?:ing)?\s+to\s+(?:your\s+|the\s+)?position\b/gi,
  /\btake\s+profits?\b/gi,
  /\bgo\s+(?:long|short)\b/gi,
];

function collectMatches(text: string, patterns: RegExp[]): string[] {
  const hits = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      hits.add(m[0].toLowerCase().replace(/\s+/g, " "));
    }
  }
  return [...hits];
}

/** Pure detector. Scans the rendered brief text for both violation classes. */
export function detectVoiceViolations(memo: string): VoiceViolations {
  const text = memo ?? "";
  return {
    firstPerson: collectMatches(text, FIRST_PERSON_PATTERNS),
    recommendations: collectMatches(text, RECOMMENDATION_PATTERNS),
  };
}

export function violationCount(v: VoiceViolations): number {
  return v.firstPerson.length + v.recommendations.length;
}

export function hasVoiceViolation(memo: string): boolean {
  return violationCount(detectVoiceViolations(memo)) > 0;
}

/**
 * Build the corrective instruction appended to the original system prompt for
 * the bounded re-ask. Names the detected violations so the model targets them
 * without rewriting the substance.
 */
export function buildVoiceCorrection(v: VoiceViolations): string {
  const found = [...v.firstPerson, ...v.recommendations];
  const foundLine = found.length
    ? `Detected violations to remove: ${found.map((f) => `"${f}"`).join(", ")}.`
    : "";
  return [
    "COMPLIANCE REWRITE REQUIRED. The previous draft broke two hard rules. Rewrite the SAME brief: same section headings, same sourced facts, same citations, same scenario structure. Change ONLY the wording needed to comply.",
    "1. IMPERSONAL VOICE: remove ALL first person, singular and plural. No \"we\", \"us\", \"our\", \"I\", \"me\", \"my\". Do not use the institutional \"we\". Own every stance with a named actor, filing, metric, or event as the grammatical subject, or attribute it to sourced evidence (\"The filing argues...\", \"The order book points to...\").",
    "2. INFORMATIONAL ONLY: no reader-directed recommendations or exposure guidance on any named security. Remove \"recommend\", \"buy\", \"sell\", \"increase exposure\", \"reduce exposure\", \"overweight\", \"underweight\", \"trim\", \"add to position\", \"take profits\", \"you should\". State what each scenario means for the THESIS, not what the reader should do.",
    foundLine,
    "Keep every section heading, every sourced figure, every citation, and the scenario analysis. Zero em-dashes; use periods and new sentences.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface EnforceOptions {
  /**
   * Inject the model call. Receives the corrective instruction (to append to
   * the original system prompt) and returns the regenerated brief text, or
   * null on any failure. Keeping this injected means the guard is pure and the
   * route owns the Gemini client.
   */
  regenerate: (correction: string) => Promise<string | null>;
  /** Max bounded re-asks. PR #385 uses one. Default 1. */
  maxReasks?: number;
}

export interface EnforceResult {
  /** The brief to surface: clean if achievable, else the least-violating draft. */
  memo: string;
  /** Violations detected in the original draft (before any re-ask). */
  violationsBefore: VoiceViolations;
  /** True if at least one re-ask was issued. */
  reasked: boolean;
  /** True if the surfaced brief still contains a violation (fallback path). */
  stillViolating: boolean;
}

/**
 * Detect -> bounded re-ask -> safe fallback.
 *
 * Clean draft: returned unchanged, no model call. Violating draft: re-ask up to
 * maxReasks times; return the first clean result. If no re-ask comes back
 * clean, fall back to the least-violating draft seen (original or any re-ask)
 * and flag stillViolating so the caller can log it. This mirrors the #385
 * "best effort, non-fatal" contract: the guard catches the common drift and
 * fixes it in one shot; it never throws and never blocks the response.
 */
export async function enforceBriefVoice(
  memo: string,
  opts: EnforceOptions,
): Promise<EnforceResult> {
  const before = detectVoiceViolations(memo);
  if (violationCount(before) === 0) {
    return { memo, violationsBefore: before, reasked: false, stillViolating: false };
  }

  const maxReasks = opts.maxReasks ?? 1;
  let best = memo;
  let bestCount = violationCount(before);
  let reasked = false;

  for (let i = 0; i < maxReasks; i++) {
    const correction = buildVoiceCorrection(detectVoiceViolations(best));
    const next = await opts.regenerate(correction);
    reasked = true;
    if (next && next.trim()) {
      const nextCount = violationCount(detectVoiceViolations(next));
      if (nextCount === 0) {
        return { memo: next, violationsBefore: before, reasked, stillViolating: false };
      }
      if (nextCount < bestCount) {
        best = next;
        bestCount = nextCount;
      }
    }
  }

  return { memo: best, violationsBefore: before, reasked, stillViolating: bestCount > 0 };
}
