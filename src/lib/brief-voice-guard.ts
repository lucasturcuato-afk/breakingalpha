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

import { briefLineCompanyNames } from "@/lib/company-intel";
import { maskProperNouns } from "@/lib/compliance-language-filter";

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
  /\b(?:buy|sell)\b(?![-\s](?:side|off))/gi,
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

/**
 * A COMPANY'S OWN NAME IS NOT A RECOMMENDATION, and before this it was.
 *
 * `RECOMMENDATION_PATTERNS` matches "buy" and "sell" on word boundaries, which
 * is right for prose and wrong for a proper noun. Two rows in `companies` carry
 * one of those words as a whole word in their own name, "Best Buy" and
 * "Buy Buy Baby", and the second of those sits in the thin band. The one-line
 * thin brief about it therefore read as a call to action: one wasted re-ask the
 * model could not satisfy (the thin block orders the line reproduced character
 * for character), then the redaction path below DROPPED THE SENTENCE holding
 * the count and the name, leaving the reader four words. No advice was caught,
 * because there was none in it.
 *
 * THE EXEMPTION IS A SPAN, NOT A SOFTER PATTERN. `briefLineCompanyNames` reads
 * the name out of the slot our own canonical one-line briefs reserve for it, and
 * only out of that slot: text that does not match one of those two frames yields
 * nothing and is scanned byte for byte as it was. No pattern is relaxed, no
 * lookaround is added, and no capitalised run is guessed at. A five-section
 * brief that merely mentions Best Buy is NOT covered by this and still trips the
 * guard; that case wants the company name threaded in from the route, which is
 * propose-only, so it is stated in the PR rather than done here.
 */
function maskOwnName(text: string): string {
  const names = briefLineCompanyNames(text);
  return names.length > 0 ? maskProperNouns(text, names) : text;
}

/** Pure detector. Scans the rendered brief text for both violation classes. */
export function detectVoiceViolations(memo: string): VoiceViolations {
  const text = maskOwnName(memo ?? "");
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
 * Remove recommendation-bearing content so the result is provably free of any
 * reader-directed recommendation or exposure phrase. Drops whole sentences that
 * carry a recommendation (preserving section headings and compliant sentences),
 * then neutralizes any residual token as a final guarantee. First person is left
 * untouched. Used only on the fail-closed fallback path, never on a draft that
 * can already be surfaced clean.
 */
function redactRecommendations(text: string): string {
  // Fresh non-global regex per test: the shared /g patterns carry lastIndex
  // state that would make .test() skip matches.
  const carriesRecommendation = (s: string): boolean =>
    RECOMMENDATION_PATTERNS.some((re) => new RegExp(re.source, "i").test(s));

  /* Names resolved ONCE over the whole text, then applied per sentence, so a
     frame that spans one sentence still protects the name where it appears in
     another. See maskOwnName: an empty list leaves every scan below unchanged. */
  const names = briefLineCompanyNames(text);
  const scan = (s: string): string => (names.length > 0 ? maskProperNouns(s, names) : s);

  const lines = text.split("\n").map((line) => {
    if (!line.trim()) return line;
    // Split into sentences on terminal punctuation; drop only the offending ones.
    // The DECISION reads the masked sentence; the sentence KEPT is the original.
    const sentences = line.split(/(?<=[.!?])\s+/);
    return sentences.filter((s) => !carriesRecommendation(scan(s))).join(" ");
  });

  let out = lines.join("\n");
  // Final guarantee: neutralize any residual phrase not bounded by sentence
  // punctuation (e.g. inside a bullet with no terminal period, or a heading).
  // Offsets are taken from the masked copy, which maskProperNouns keeps the same
  // length as the original, and spliced into the original from the end so the
  // earlier offsets stay valid.
  for (const re of RECOMMENDATION_PATTERNS) {
    const pattern = new RegExp(re.source, "gi");
    if (names.length === 0) {
      out = out.replace(pattern, "[redacted]");
      continue;
    }
    const spans = [...maskProperNouns(out, names).matchAll(pattern)].map(
      (m) => [m.index, m.index + m[0].length] as const,
    );
    for (let i = spans.length - 1; i >= 0; i--) {
      out = `${out.slice(0, spans[i][0])}[redacted]${out.slice(spans[i][1])}`;
    }
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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
  /**
   * The brief to surface: clean if achievable, else a fallback that is ALWAYS
   * recommendation-free (recommendation-bearing content is redacted when no
   * clean draft exists). May retain first person on the fallback path.
   */
  memo: string;
  /** Violations detected in the original draft (before any re-ask). */
  violationsBefore: VoiceViolations;
  /** True if at least one re-ask was issued. */
  reasked: boolean;
  /**
   * True if the surfaced brief still contains a violation. On the fallback path
   * this can only be leftover first person; recommendations are always removed.
   */
  stillViolating: boolean;
}

/**
 * Detect -> bounded re-ask -> FAIL-CLOSED fallback.
 *
 * Clean draft: returned unchanged, no model call. Violating draft: re-ask up to
 * maxReasks times and adopt the first fully clean result. If no draft comes back
 * clean, the fallback is FAIL-CLOSED on recommendations: a reader-directed
 * recommendation or exposure phrase must NEVER survive, even at the cost of
 * leftover first person.
 *   1. Prefer any draft that is already recommendation-free; among those, the
 *      one with the least first person. First person may remain; a
 *      recommendation may not.
 *   2. If every draft carries a recommendation, redact the recommendation-bearing
 *      sentences from the least-first-person draft so the surfaced brief is
 *      provably recommendation-free.
 * Mirrors the #385 "best effort, non-fatal" contract: never throws, never blocks
 * the response. stillViolating flags any residual (first person only by then).
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
  let reasked = false;
  // Every draft seen, in order: original first, then each non-empty re-ask.
  const candidates: string[] = [memo];

  for (let i = 0; i < maxReasks; i++) {
    const correction = buildVoiceCorrection(
      detectVoiceViolations(candidates[candidates.length - 1]),
    );
    const next = await opts.regenerate(correction);
    reasked = true;
    if (next && next.trim()) {
      if (!hasVoiceViolation(next)) {
        return { memo: next, violationsBefore: before, reasked, stillViolating: false };
      }
      candidates.push(next);
    }
  }

  // No fully clean draft. Fail closed on recommendations.
  const scored = candidates.map((text) => ({ text, v: detectVoiceViolations(text) }));
  type Scored = (typeof scored)[number];
  const leastFirstPerson = (a: Scored, b: Scored): Scored =>
    b.v.firstPerson.length < a.v.firstPerson.length ? b : a;

  // 1. A recommendation-free draft can be surfaced as-is (first person may remain).
  const recFree = scored.filter((c) => c.v.recommendations.length === 0);
  if (recFree.length > 0) {
    const winner = recFree.reduce(leastFirstPerson);
    return {
      memo: winner.text,
      violationsBefore: before,
      reasked,
      stillViolating: winner.v.firstPerson.length > 0,
    };
  }

  // 2. Every draft carries a recommendation: redact it out of the least-first-
  //    person draft so the surfaced brief is provably recommendation-free.
  const base = scored.reduce(leastFirstPerson);
  const redacted = redactRecommendations(base.text);
  const after = detectVoiceViolations(redacted);
  return {
    memo: redacted,
    violationsBefore: before,
    reasked,
    stillViolating: violationCount(after) > 0,
  };
}
