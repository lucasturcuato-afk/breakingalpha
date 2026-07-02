/**
 * compliance-language-filter.ts -- standalone, reusable descriptive-only guard.
 *
 * Scans free text for language that crosses the informational-only line for a
 * registered rep surfacing commentary on a named security, and strips the
 * offending sentences. Built as the POST-GENERATION BACKSTOP: prompt text alone
 * drifts under token pressure (proven by the web-memo work), so no feature
 * should rely on the model behaving. Any feature that emits security-adjacent
 * prose can import this and apply it after generation.
 *
 * Scope, deliberately DESCRIPTIVE-vs-PRESCRIPTIVE, not sentiment scrubbing:
 *   ALLOWED   reported figures + their own-history changes ("operating margin
 *             expanded four consecutive quarters"), factual firsts, line-item
 *             definitions.
 *   BLOCKED   valuation language (cheap/expensive/undervalued/fairly valued),
 *             security assessment (compelling/well-positioned as an investment),
 *             recommendations (buy/sell/hold/accumulate/avoid), price targets or
 *             forward projections, peer-comparison claims, and qualitative
 *             verdicts on results (good/bad/healthy/weak/strong/impressive).
 *
 * Sibling of thesis-recommendation-guard.ts (which owns thesis title/rationale
 * framing + bounded re-ask). This module is the general text-sanitizer: it drops
 * whole sentences that carry a prohibited phrase and reports what it removed. It
 * is conservative by design -- when a sentence is ambiguous it is stripped, not
 * kept, because emitting a verdict is the expensive failure, not losing a line.
 *
 * Pure and dependency-free: no network, no model, no secrets. Unit-testable.
 */

/** Prohibited-language categories, ordered by review priority. */
export type ComplianceCategory =
  | "valuation"
  | "recommendation"
  | "security_assessment"
  | "price_target"
  | "peer_comparison"
  | "verdict";

export interface ComplianceFinding {
  /** The sentence (trimmed) that carried prohibited language. */
  sentence: string;
  /** Which lexicon category tripped. */
  category: ComplianceCategory;
  /** The specific matched phrase (lowercased), for review + telemetry. */
  term: string;
}

export interface ComplianceResult {
  /** Input with every offending sentence removed. Whitespace re-collapsed. */
  clean: string;
  /** Everything the scan removed, in document order. */
  findings: ComplianceFinding[];
  /** True when at least one sentence was stripped. */
  blocked: boolean;
}

// One ordered lexicon per category. Each entry is a global, case-insensitive
// pattern. Word boundaries keep "premium" (valuation) from firing on
// "premium product" is impossible to fully disambiguate, so valuation terms are
// anchored to their financial usage where feasible and accepted as conservative
// elsewhere. Maintained centrally: add a prohibited phrasing here, every
// importer inherits it.
const LEXICON: Record<ComplianceCategory, RegExp[]> = {
  // Valuation verdicts: is the security cheap or expensive.
  valuation: [
    /\b(?:under|over|fairly|richly|cheaply|attractively)\s*valued\b/gi,
    /\b(?:under|over)valuation\b/gi,
    /\bfair\s+value\b/gi,
    /\b(?:cheap|expensive|pricey|inexpensive|bargain|overpriced|underpriced)\b/gi,
    /\battractive(?:ly)?\b/gi,
    /\bcompelling\s+(?:valuation|entry|value|multiple)\b/gi,
    /\b(?:rich|stretched|depressed|discounted|elevated|full)\s+(?:valuation|multiple|multiples)\b/gi,
    /\btrad(?:es|ing)\s+at\s+(?:a\s+)?(?:discount|premium)\b/gi,
    /\b(?:discount|premium)\s+to\s+(?:fair\s+value|intrinsic|peers|the\s+group|the\s+sector|book)\b/gi,
    /\b(?:cheap|expensive)\s+(?:relative|compared)\b/gi,
    /\bmultiple\s+looks\b/gi,
  ],
  // Reader-directed action calls.
  recommendation: [
    /\b(?:buy|sell|hold|accumulate|avoid)\b(?![-\s](?:side|off|out|er|ers|ing\s+power))/gi,
    /\b(?:over|under)weight\b/gi,
    /\bstrong\s+buy\b/gi,
    /\b(?:add(?:ing)?|adds)\s+to\s+(?:your\s+|the\s+|a\s+)?position\b/gi,
    /\btake\s+profits?\b/gi,
    /\bgo\s+(?:long|short)\b/gi,
    /\b(?:you|investors?)\s+(?:should|ought\s+to|may\s+want\s+to|must|need\s+to)\b/gi,
    /\brecommend(?:s|ed|ing|ation|ations)?\b/gi,
    /\b(?:increase|reduce|trim|raise|lower|build|scale)\s+(?:your\s+|the\s+)?(?:exposure|position|stake|allocation|holdings?)\b/gi,
  ],
  // The security as an investment is good/bad.
  security_assessment: [
    /\bwell[-\s]positioned\b/gi,
    /\b(?:compelling|attractive|strong|weak|poor|great|excellent|best[-\s]in[-\s]class|must[-\s]own)\s+(?:investment|opportunity|name|stock|story|setup|risk[\/-]reward)\b/gi,
    /\b(?:high|low|strong|weak)\s+conviction\b/gi,
    /\bde[-\s]?risk(?:ed|ing)?\b/gi,
    /\brisk[\/-]reward\s+(?:is\s+)?(?:favorable|attractive|skewed|compelling)\b/gi,
    /\b(?:bull|bear)\s*(?:ish|\s+case)\b/gi,
  ],
  // Numbers not in the filing: targets and forward projections.
  price_target: [
    /\bprice\s+targets?\b/gi,
    /\b(?:worth|valued\s+at|should\s+trade\s+at|fair\s+value\s+of)\s+\$?\d/gi,
    /\b(?:we|analysts?)\s+(?:expect|project|forecast|estimate|see|model)\b/gi,
    /\b(?:projected|forecast(?:ed)?|expected)\s+to\s+(?:reach|hit|grow|rise|climb|fall|decline)\b/gi,
    /\b(?:next|coming)\s+(?:year|quarter)\s+(?:should|will|is\s+likely)\b/gi,
    /\bguidance\s+implies\b/gi,
  ],
  // Cross-company claims (fabrication risk).
  peer_comparison: [
    /\b(?:out|under)performs?\s+(?:its\s+)?(?:peers|competitors|rivals|the\s+sector|the\s+group|the\s+industry)\b/gi,
    /\b(?:better|worse|stronger|weaker|cheaper|richer|ahead|behind)\s+than\s+(?:its\s+)?(?:peers|competitors|rivals|the\s+sector|the\s+group)\b/gi,
    /\bindustry[-\s]leading\b/gi,
    /\bbest[-\s]in[-\s]class\b/gi,
    /\b(?:versus|vs\.?|relative\s+to|compared\s+to|against)\s+(?:its\s+)?(?:peers|competitors|rivals|the\s+group|the\s+sector)\b/gi,
    /\bmarket\s+share\s+(?:gain|leader|leadership)\b/gi,
  ],
  // Qualitative verdict on whether the reported results are good or bad.
  verdict: [
    /\b(?:results?|quarter|performance|numbers?|print|report|execution|momentum|growth|margins?|profitability|balance\s+sheet)\s+(?:were|was|is|are|look(?:s|ed)?|remain(?:s|ed)?|came\s+in|proved)\s+(?:strong|weak|healthy|robust|solid|impressive|disappointing|poor|excellent|concerning|troubling|good|bad|soft|stellar|mixed|encouraging|worrying)\b/gi,
    /\b(?:strong|weak|healthy|robust|solid|impressive|disappointing|poor|excellent|concerning|troubling|stellar|encouraging|worrying)\s+(?:results?|quarter|performance|numbers?|print|report|execution|momentum|growth|profitability|fundamentals?)\b/gi,
    /\b(?:beat|missed)\s+(?:expectations?|estimates?|consensus|the\s+street)\b/gi,
    /\bimpressive(?:ly)?\b/gi,
    /\b(?:remarkabl|excellent|outstanding|troubling|worrying|alarming|disappointing)[a-z]*\b/gi,
  ],
};

const CATEGORY_ORDER: ComplianceCategory[] = [
  "valuation",
  "recommendation",
  "security_assessment",
  "price_target",
  "peer_comparison",
  "verdict",
];

/**
 * Split text into sentences on terminal punctuation, keeping the punctuation.
 * Newlines are treated as soft breaks so bullet/paragraph text is scanned per
 * sentence too. Empty fragments are dropped.
 */
export function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * First prohibited match in a sentence, scanning categories in review-priority
 * order. Returns null for a clean sentence. Exported for callers that want to
 * classify without stripping.
 */
export function matchProhibited(
  sentence: string,
): { category: ComplianceCategory; term: string } | null {
  for (const category of CATEGORY_ORDER) {
    for (const re of LEXICON[category]) {
      // Fresh lastIndex every test: patterns are global for scanText's matchAll.
      re.lastIndex = 0;
      const m = re.exec(sentence);
      if (m) {
        return { category, term: m[0].toLowerCase().replace(/\s+/g, " ").trim() };
      }
    }
  }
  return null;
}

/**
 * Scan-only: report every prohibited sentence without modifying the text. Use
 * when a caller wants to fail-closed (reject the whole output) rather than strip.
 */
export function scanCompliance(text: string): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  for (const sentence of splitSentences(text)) {
    const hit = matchProhibited(sentence);
    if (hit) findings.push({ sentence, category: hit.category, term: hit.term });
  }
  return findings;
}

/**
 * Strip every prohibited sentence and return the surviving text plus a record of
 * what was removed. This is the backstop applied post-generation: the model is
 * asked to stay descriptive, and whatever slips through is deleted here.
 * Never throws; a fully-prohibited input returns clean === "".
 */
export function filterComplianceLanguage(text: string | null | undefined): ComplianceResult {
  const src = (text ?? "").trim();
  if (!src) return { clean: "", findings: [], blocked: false };

  const findings: ComplianceFinding[] = [];
  const kept: string[] = [];
  for (const sentence of splitSentences(src)) {
    const hit = matchProhibited(sentence);
    if (hit) {
      findings.push({ sentence, category: hit.category, term: hit.term });
    } else {
      kept.push(sentence);
    }
  }

  const clean = kept.join(" ").replace(/\s{2,}/g, " ").trim();
  return { clean, findings, blocked: findings.length > 0 };
}
