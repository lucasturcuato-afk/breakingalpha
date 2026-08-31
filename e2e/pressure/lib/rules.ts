/**
 * The five copy rules, asserted against the RENDERED DOM.
 *
 * `scripts/design-lint.mjs` asserts these against SOURCE, line by line, and
 * that is a different claim: source can be clean while a screen composes a
 * banned string at runtime out of two clean halves, and a screen can carry a
 * string the linter never reads because it arrived from the database. This
 * module reads what a reader actually sees.
 *
 * HOW `hold` IS SCOPED, since the prompt asks for it explicitly. The text under
 * test is `document.body.innerText`, which is the rendered text run and
 * contains NO attribute values. A `placeholder="..."` never appears in it, so
 * the repo's attribute-level allowlist is unnecessary here and is not
 * reproduced. The word-level allowlist (threshold, household, stakeholder,
 * withhold, shareholder, holder, placeholder as a literal word) IS reproduced,
 * because those can legitimately appear as rendered prose.
 *
 * `shadowRoots` are descended explicitly. `plate.mjs` does not, and a rule that
 * stops at the light DOM is a rule that passes on a screen it never read.
 */
import type { Page } from "@playwright/test";

export interface RuleHit {
  rule: string;
  detail: string;
}

export interface ScreenText {
  text: string;
  shadowText: string;
  outcomeTokens: string[];
  emptyStateBlocks: string[];
}

/**
 * Everything the rules need, read in one page evaluation.
 *
 * Reading it once matters: a second read after a re-render is a different
 * screen, and two rules disagreeing about what was on it is unresolvable.
 */
export async function readScreenText(page: Page): Promise<ScreenText> {
  return page.evaluate(() => {
    /* Descend shadow roots explicitly. */
    const shadowChunks: string[] = [];
    const walk = (root: Document | ShadowRoot) => {
      root.querySelectorAll("*").forEach((el) => {
        const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
        if (sr) {
          shadowChunks.push((sr.textContent ?? "").trim());
          walk(sr);
        }
      });
    };
    walk(document);

    /* Candidate outcome tokens: any element whose whole rendered text is one
       short word, which is the shape a verdict pill takes. Cheap, and it
       catches a pill whose vocabulary drifted without needing to know which
       component drew it. */
    const outcomeTokens: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      if (el.children.length > 0) return;
      const t = (el.textContent ?? "").trim();
      if (!t || t.length > 24) return;
      if (!/^[A-Za-z][A-Za-z ]*$/.test(t)) return;
      outcomeTokens.push(t);
    });

    /* Blocks that look like an empty state, so the "no sentence about the
       reader" rule has something narrower than the whole page to read.
       Heuristic and declared as such: a block whose text contains one of the
       empty-state phrasings this app uses. */
    const emptyStateBlocks: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      const t = ((el as HTMLElement).innerText ?? "").trim();
      if (!t || t.length > 600) return;
      if (/(nothing|no |none|empty|not set up|could not|did not|yet\b)/i.test(t)) {
        emptyStateBlocks.push(t);
      }
    });

    return {
      text: (document.body as HTMLElement).innerText ?? "",
      shadowText: shadowChunks.join("\n"),
      outcomeTokens: Array.from(new Set(outcomeTokens)),
      emptyStateBlocks: emptyStateBlocks.slice(-40),
    };
  });
}

const BANNED = ["buy", "sell", "hold", "allocation", "returns", "performance"];

/** Rendered-prose allowlist. See the header for why `placeholder=` is absent. */
const BANNED_ALLOW: Array<{ re: RegExp; why: string }> = [
  { re: /\bthresholds?\b/i, why: "threshold contains hold" },
  { re: /\bhouseholds?\b/i, why: "household contains hold" },
  { re: /\bstakeholders?\b/i, why: "stakeholder contains hold" },
  { re: /\bshareholders?\b/i, why: "shareholder contains hold" },
  { re: /\bplaceholders?\b/i, why: "placeholder contains hold" },
  { re: /\bwithhold(s|ing)?\b/i, why: "withhold contains hold" },
  { re: /\bholders?\b/i, why: "holder contains hold" },
  /* Corporate suffix. "Victory Capital Holdings" is a company name off the
     wire, not a claim about a position, and it appears in every headline feed
     this app draws. */
  { re: /\bholdings?\b/i, why: "Holdings is a corporate suffix in a company name" },
];

/** Rule 1. Banned substrings, in rendered text only. */
export function bannedInRendered(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  text.split("\n").forEach((line, i) => {
    const lower = line.toLowerCase();
    for (const word of BANNED) {
      if (!lower.includes(word)) continue;
      /* Strip every allowlisted word, then look again. A line reading
         "threshold" no longer contains `hold`; a line reading
         "threshold and hold" still does. */
      let stripped = line;
      for (const a of BANNED_ALLOW) stripped = stripped.replace(new RegExp(a.re.source, "gi"), " ");
      if (!stripped.toLowerCase().includes(word)) continue;
      hits.push({ rule: "banned-substring", detail: `"${word}" in rendered line ${i + 1}: ${line.trim().slice(0, 160)}` });
    }
  });
  return hits;
}

/** Rule 2. Em-dashes, anywhere in rendered copy. */
export function emDashInRendered(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.includes("—")) {
      hits.push({ rule: "em-dash", detail: `line ${i + 1}: ${line.trim().slice(0, 160)}` });
    }
  });
  return hits;
}

/**
 * Rule 3. Outcome vocabulary is exactly supported / challenged / developing /
 * awaiting.
 *
 * TWO CHECKS, because one is not enough. The line-level one mirrors the
 * linter: a forbidden word beside outcome machinery. The token-level one is
 * stricter and is the one the prompt asks for: a standalone pill word that is
 * outcome-shaped but not one of the four.
 */
const ALLOWED_OUTCOMES = new Set(["supported", "challenged", "developing", "awaiting"]);
const OUTCOME_FORBIDDEN = /\b(right|wrong|correct|incorrect|win|won|loss|lost)\b/i;
const OUTCOME_CONTEXT = /(outcome|verdict|status|state|grade|graded|result|resolution|badge|pill|call|claim|thesis)/i;
/* Words that are outcome-shaped: they name how a claim turned out. A pill
   carrying one of these that is not one of the four is a vocabulary drift. */
const OUTCOME_SHAPED =
  /^(right|wrong|correct|incorrect|win|won|lose|lost|loss|hit|miss|missed|pass|passed|fail|failed|true|false|accurate|inaccurate|confirmed|refuted|rejected|validated|invalidated|proven|disproven|resolved|unresolved|pending|open|closed)$/i;

export function outcomeVocabulary(t: ScreenText): RuleHit[] {
  const hits: RuleHit[] = [];
  t.text.split("\n").forEach((line, i) => {
    if (OUTCOME_FORBIDDEN.test(line) && OUTCOME_CONTEXT.test(line)) {
      hits.push({ rule: "outcome-vocabulary", detail: `line ${i + 1}: ${line.trim().slice(0, 160)}` });
    }
  });
  for (const tok of t.outcomeTokens) {
    const w = tok.trim().toLowerCase();
    if (ALLOWED_OUTCOMES.has(w)) continue;
    if (OUTCOME_SHAPED.test(w)) {
      hits.push({ rule: "outcome-vocabulary-token", detail: `standalone token "${tok}" is outcome-shaped and is not one of the four` });
    }
  }
  return hits;
}

/**
 * Rule 4. No aggregate rate or accuracy figure.
 *
 * The linter's shapes, plus the shape a rate takes on screen rather than in
 * code: a percentage in the same line as a correctness word or a count of
 * calls.
 */
const RATE_WORDS = [
  /\baccuracy\b/i,
  /\baccurate\b/i,
  /\bhit[\s-]?rate\b/i,
  /\bwin[\s-]?rate\b/i,
  /\bsuccess[\s-]?rate\b/i,
  /\bstrike[\s-]?rate\b/i,
  /\bbatting average\b/i,
  /\btrack record of \d/i,
];
/* Unsigned only. `+2.06%` and `-0.01%` are price moves, and a rule that reads
   them as a correctness figure reports every attribution line as a defect. */
const PCT = /(?<![+\-\d.])\b\d{1,3}(?:\.\d+)?\s?%/;
const PCT_CONTEXT = /(correct|accurate|accuracy|of (your |the )?(calls?|claims?|thes[ei]s)|hit|win|success|track record)/i;

export function aggregateRate(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  text.split("\n").forEach((line, i) => {
    for (const re of RATE_WORDS) {
      if (re.test(line)) {
        hits.push({ rule: "aggregate-rate", detail: `line ${i + 1}: ${line.trim().slice(0, 160)}` });
        return;
      }
    }
    if (PCT.test(line) && PCT_CONTEXT.test(line)) {
      hits.push({ rule: "aggregate-rate-shape", detail: `percentage beside outcome words, line ${i + 1}: ${line.trim().slice(0, 160)}` });
    }
  });
  return hits;
}

/**
 * Rule 5. No sentence about the reader when the read returned nothing.
 *
 * The defect: a screen that could not read, or read zero rows, telling the
 * reader what they have or have not done. The screen does not know. This looks
 * for second-person claims about the reader's own activity inside a block that
 * also reads as an empty or failed state.
 */
const READER_CLAIM =
  /\byou (have|haven't|have not|ve|'ve|are|aren't|are not|do|don't|do not|did|didn't|did not|never)\b|\byour (first|only|last|record|calls?|claims?|watchlist|follows?)\b|\bnothing you\b|\byou'?ve\b/i;

/* The distinction that makes this rule mean anything. A read that SUCCEEDED and
   returned zero rows knows the reader has nothing, and "Nothing on your
   watchlist yet" is then true. A read that FAILED, or was never wired, knows
   nothing about the reader at all, and a sentence about them there is the
   defect. So the block must carry a failed-or-unwired marker, not merely an
   empty-sounding one. */
const FAILED_READ =
  /(could not|couldn't|did not load|didn'?t load|failed|not wired|not set up|unavailable|no source|try again|something went wrong|error)/i;

export function readerSentenceInEmptyState(t: ScreenText): RuleHit[] {
  const hits: RuleHit[] = [];
  const seen = new Set<string>();
  for (const block of t.emptyStateBlocks) {
    if (!FAILED_READ.test(block)) continue;
    const m = block.match(READER_CLAIM);
    if (!m) continue;
    const key = block.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      rule: "reader-sentence-in-empty-state",
      detail: `"${m[0]}" inside an empty/failed block: ${block.replace(/\s+/g, " ").slice(0, 200)}`,
    });
  }
  return hits;
}

export function allRules(t: ScreenText): RuleHit[] {
  const full = `${t.text}\n${t.shadowText}`;
  return [
    ...bannedInRendered(full),
    ...emDashInRendered(full),
    ...outcomeVocabulary(t),
    ...aggregateRate(full),
    ...readerSentenceInEmptyState(t),
  ];
}
