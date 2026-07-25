/**
 * multi-period-claim-validator.ts -- post-generation backstop for streak and
 * extreme claims.
 *
 * Sibling of compliance-language-filter.ts and deliberately the same mechanism:
 * split into sentences, test each one, drop the offenders, report what was
 * removed. The difference is what it tests for. The compliance filter asks "is
 * this sentence prescriptive"; this asks "is this multi-period arithmetic
 * actually true of the data". Both are needed, and neither substitutes for the
 * other: gemini-2.5-flash produced perfectly compliant sentences that were
 * simply false ("decreased for the third consecutive year" against a table
 * showing a run of two).
 *
 * Verification is against the closed set from financials-derived-facts.ts, which
 * computed the runs in code. A sentence that makes a multi-period claim is kept
 * ONLY when a derived fact supports it: right metric, right direction, right
 * view, and a run at least as long as the one claimed. Everything else is
 * stripped.
 *
 * Conservative by construction, matching the compliance filter's stance: when a
 * multi-period claim cannot be resolved to a fact (metric unrecognized, count
 * unparseable, direction ambiguous) it is stripped rather than kept. Emitting a
 * fabricated streak is the expensive failure; losing a sentence is not.
 *
 * Prompt-only was tried and is not sufficient. The DERIVED FACTS block reduces
 * the error rate; this module is what makes it hold.
 *
 * Pure and dependency-free: no network, no model, no DB. Unit-testable.
 */

import { splitSentences } from "./compliance-language-filter";
import type { DerivedFact, DerivedView } from "./financials-derived-facts";

export interface MultiPeriodFinding {
  /** The sentence (trimmed) that carried an unverified claim. */
  sentence: string;
  /** The claim phrasing that tripped the scan, for review + telemetry. */
  trigger: string;
  /** Why no derived fact supported it. */
  reason: string;
}

export interface MultiPeriodResult {
  /** Input with every unverified sentence removed. Whitespace re-collapsed. */
  clean: string;
  /** Everything the scan removed, in document order. */
  findings: MultiPeriodFinding[];
  /** True when at least one sentence was stripped. */
  blocked: boolean;
}

/**
 * Phrasings that assert something across more than one period. Any hit forces
 * the sentence to be justified by a derived fact.
 */
const CLAIM_TRIGGERS: RegExp[] = [
  /\b(?:consecutive|successive|straight)\b/i,
  /\bin\s+a\s+row\b/i,
  /\b(?:each|every)\s+of\s+the\s+(?:last|past)\s+\S+/i,
  /\b(?:each|every)\s+(?:successive\s+)?(?:year|quarter|fiscal\s+year|fiscal\s+quarter|period)\s+since\b/i,
  /\b(?:in|for)\s+(?:each|every)\s+of\s+the\s+\S+/i,
  /\b(?:highest|lowest|record|strongest|weakest|peak|trough)\b/i,
  /\bfirst\s+(?:positive|negative|profitable|profit|loss|time)\b/i,
  /\bturned\s+(?:positive|negative|profitable)\b/i,
  /\bsince\s+FY?\s?\d{2,4}\b/i,
  /\bfor\s+(?:a|the)\s+(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i,
];

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

const CARDINALS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Sentence words that mean the metric moved up / down. */
const UP_WORDS =
  /\b(?:increase[sd]?|increasing|rose|rise[sn]?|rising|grew|grow(?:s|n|ing)?|growth|expand(?:s|ed|ing)?|expansion|higher|climb(?:s|ed|ing)?|gain(?:s|ed)?|improve[sd]?|advanced|up)\b/gi;
const DOWN_WORDS =
  /\b(?:decrease[sd]?|decreasing|declin(?:e|es|ed|ing)|fell|fall(?:s|en|ing)?|drop(?:s|ped|ping)?|lower|contract(?:s|ed|ing)?|contraction|shrank|shrunk|shrink(?:s|ing)?|reduc(?:ed|tion)|weakened|down)\b/gi;

/** Metric aliases, longest-first within each entry so "EPS" cannot shadow. */
const METRIC_ALIASES: Array<{ keys: string[]; patterns: RegExp[] }> = [
  { keys: ["gross_margin"], patterns: [/\bgross\s+margins?\b/gi] },
  { keys: ["operating_margin"], patterns: [/\boperating\s+margins?\b/gi] },
  { keys: ["net_margin"], patterns: [/\b(?:net|profit)\s+margins?\b/gi] },
  { keys: ["eps_diluted"], patterns: [/\bdiluted\s+(?:eps|earnings\s+per\s+share)\b/gi, /\beps\s*\(diluted\)/gi] },
  { keys: ["eps_basic"], patterns: [/\bbasic\s+(?:eps|earnings\s+per\s+share)\b/gi, /\beps\s*\(basic\)/gi] },
  { keys: ["eps_diluted", "eps_basic"], patterns: [/\beps\b/gi, /\bearnings\s+per\s+share\b/gi] },
  { keys: ["operating_cash_flow"], patterns: [/\boperating\s+cash\s+flow\b/gi, /\bcash\s+(?:flow\s+)?from\s+operations\b/gi, /\bcash\s+flow\s+from\s+operating\b/gi] },
  { keys: ["cost_of_revenue"], patterns: [/\bcost\s+of\s+(?:revenue|sales|goods)\b/gi] },
  { keys: ["gross_profit"], patterns: [/\bgross\s+profits?\b/gi] },
  { keys: ["operating_income"], patterns: [/\boperating\s+(?:income|profit|earnings)\b/gi] },
  { keys: ["net_income"], patterns: [/\bnet\s+(?:income|profit|earnings|loss)\b/gi] },
  { keys: ["total_assets"], patterns: [/\btotal\s+assets\b/gi, /\bassets\b/gi] },
  { keys: ["total_liabilities"], patterns: [/\btotal\s+liabilities\b/gi, /\bliabilities\b/gi] },
  { keys: ["stockholders_equity"], patterns: [/\b(?:stockholders|shareholders)'?\s+equity\b/gi, /\bbook\s+value\b/gi] },
  { keys: ["cash_and_equivalents"], patterns: [/\bcash\s+(?:and|&)\s+(?:cash\s+)?equivalents\b/gi, /\bcash\s+balance\b/gi, /\bcash\b/gi] },
  { keys: ["shares_diluted"], patterns: [/\bdiluted\s+shares?\b/gi, /\bshare\s+count\b/gi, /\bshares\s+outstanding\b/gi] },
  { keys: ["revenue"], patterns: [/\brevenues?\b/gi, /\bsales\b/gi, /\btop\s+line\b/gi] },
];

/** First trigger hit in a sentence, with its position. */
function findTrigger(sentence: string): { text: string; index: number } | null {
  let best: { text: string; index: number } | null = null;
  for (const re of CLAIM_TRIGGERS) {
    re.lastIndex = 0;
    const m = re.exec(sentence);
    if (m && (best === null || m.index < best.index)) {
      best = { text: m[0].toLowerCase().replace(/\s+/g, " ").trim(), index: m.index };
    }
  }
  return best;
}

/** Nearest match to `anchor` among a global pattern's hits, or null. */
function nearestMatch(sentence: string, re: RegExp, anchor: number): number | null {
  re.lastIndex = 0;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const m of sentence.matchAll(re)) {
    const dist = Math.abs((m.index ?? 0) - anchor);
    if (dist < bestDist) {
      bestDist = dist;
      best = m.index ?? 0;
    }
  }
  return best === null ? null : bestDist;
}

/**
 * Direction of the claim, taken from the movement word nearest the trigger.
 * Sentences that mention both directions are common ("rose in FY2025 following
 * a decline"), so proximity decides rather than presence.
 */
function claimDirection(sentence: string, anchor: number): "up" | "down" | null {
  const up = nearestMatch(sentence, UP_WORDS, anchor);
  const down = nearestMatch(sentence, DOWN_WORDS, anchor);
  if (up === null && down === null) return null;
  if (up === null) return "down";
  if (down === null) return "up";
  if (up === down) return null;
  return up < down ? "up" : "down";
}

/** How many periods the sentence claims, or null when it states no count. */
function claimedCount(sentence: string): number | null {
  const patterns: RegExp[] = [
    /\b(\w+|\d+)\s+(?:consecutive|successive|straight)\b/i,
    /\b(?:for|in|marking)\s+(?:a|the|its)\s+(\w+)\s+(?:consecutive|successive|straight)\b/i,
    /\b(?:each|every)\s+of\s+the\s+(?:last|past)\s+(\w+|\d+)\b/i,
    /\b(?:highest|lowest|record|strongest|weakest)\b[^.]*?\bin\s+(\w+|\d+)\s+(?:years?|quarters?|periods?)\b/i,
    /\b(\w+|\d+)\s+(?:years?|quarters?)\s+in\s+a\s+row\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(sentence);
    if (!m) continue;
    const token = (m[1] ?? "").toLowerCase();
    if (/^\d+$/.test(token)) return parseInt(token, 10);
    if (token in ORDINALS) return ORDINALS[token];
    if (token in CARDINALS) return CARDINALS[token];
  }
  return null;
}

/** Fiscal year named by a "since FY2022" style clause, or null. */
function claimedSinceYear(sentence: string): number | null {
  const m = /\bsince\s+(?:FY\s?)?(\d{4})\b/i.exec(sentence) ?? /\bsince\s+FY\s?(\d{2})\b/i.exec(sentence);
  if (!m) return null;
  const raw = parseInt(m[1], 10);
  return raw < 100 ? 2000 + raw : raw;
}

function yearOf(label: string): number | null {
  const m = /(\d{4})/.exec(label);
  return m ? parseInt(m[1], 10) : null;
}

/** Views the sentence could be talking about. */
function claimedViews(sentence: string): DerivedView[] {
  const quarterly = /\b(?:quarter|quarters|quarterly|qoq|q\/q|sequential(?:ly)?)\b/i.test(sentence);
  const annual = /\b(?:year|years|yearly|annual(?:ly)?|fiscal\s+year|yoy|y\/y|fy\s?\d{2,4})\b/i.test(sentence);
  if (quarterly && !annual) return ["quarterly"];
  if (annual && !quarterly) return ["annual"];
  return ["annual", "quarterly"];
}

/** Metric keys named in the sentence, nearest the trigger first. */
function claimedMetrics(sentence: string, anchor: number): string[] {
  const hits: Array<{ keys: string[]; dist: number }> = [];
  for (const { keys, patterns } of METRIC_ALIASES) {
    let best = Infinity;
    for (const re of patterns) {
      const d = nearestMatch(sentence, re, anchor);
      if (d !== null && d < best) best = d;
    }
    if (best !== Infinity) hits.push({ keys, dist: best });
  }
  hits.sort((a, b) => a.dist - b.dist);
  // Aliases overlap ("net income" also contains no other metric, but "cash"
  // matches inside "cash flow"); the nearest distinct key wins and the rest are
  // still allowed as candidates.
  const ordered: string[] = [];
  for (const h of hits) {
    for (const k of h.keys) if (!ordered.includes(k)) ordered.push(k);
  }
  return ordered;
}

interface Verdict {
  ok: boolean;
  reason: string;
}

/** Does any derived fact support this sentence's multi-period claim. */
function verifySentence(sentence: string, facts: DerivedFact[]): Verdict {
  const trigger = findTrigger(sentence);
  if (!trigger) return { ok: true, reason: "no multi-period claim" };

  const metrics = claimedMetrics(sentence, trigger.index);
  if (metrics.length === 0) {
    return { ok: false, reason: "multi-period claim names no recognizable metric" };
  }

  const views = claimedViews(sentence);
  const scoped = facts.filter((f) => metrics.includes(f.metricKey) && views.includes(f.view));
  if (scoped.length === 0) {
    return { ok: false, reason: `no derived fact for ${metrics[0]} in this view` };
  }

  const isExtreme = /\b(?:highest|lowest|record|strongest|weakest|peak|trough)\b/i.test(sentence);
  const isFirst = /\bfirst\s+(?:positive|negative|profitable|profit|loss|time)\b|\bturned\s+(?:positive|negative|profitable)\b/i.test(sentence);

  if (isFirst) {
    const wantsPositive = /\b(?:positive|profitable|profit)\b/i.test(sentence);
    const kind = wantsPositive ? "first_positive" : "first_negative";
    const hit = scoped.some((f) => f.kind === kind);
    return hit
      ? { ok: true, reason: `verified by ${kind}` }
      : { ok: false, reason: `no ${kind} fact for ${metrics[0]}` };
  }

  if (isExtreme) {
    const wantsHigh = /\b(?:highest|record|strongest|peak)\b/i.test(sentence);
    const kind = wantsHigh ? "extreme_high" : "extreme_low";
    const n = claimedCount(sentence);
    const hit = scoped.some((f) => f.kind === kind && (n === null || f.periodsCovered >= n));
    return hit
      ? { ok: true, reason: `verified by ${kind}` }
      : { ok: false, reason: `no ${kind} fact for ${metrics[0]} covering the claimed span` };
  }

  // Streak claim from here down.
  const direction = claimDirection(sentence, trigger.index);
  if (direction === null) {
    return { ok: false, reason: "streak claim with no resolvable direction" };
  }
  const kind = direction === "up" ? "run_increase" : "run_decrease";
  const runs = scoped.filter((f) => f.kind === kind);
  if (runs.length === 0) {
    return { ok: false, reason: `no ${kind} run for ${metrics[0]}` };
  }

  const n = claimedCount(sentence);
  const since = claimedSinceYear(sentence);

  if (n !== null) {
    const ok = runs.some((f) => f.runLength >= n);
    const longest = Math.max(...runs.map((f) => f.runLength));
    return ok
      ? { ok: true, reason: `run of ${longest} covers the claimed ${n}` }
      : { ok: false, reason: `claimed ${n} consecutive but the computed run is ${longest}` };
  }

  if (since !== null) {
    const ok = runs.some((f) => {
      const start = yearOf(f.startLabel);
      return start !== null && start <= since;
    });
    return ok
      ? { ok: true, reason: `run reaches back to the claimed year` }
      : { ok: false, reason: `run does not reach back to ${since}` };
  }

  // Unquantified streak ("has increased consecutively"): a run of any length
  // supports it, since MIN_RUN already gates what becomes a fact.
  return { ok: true, reason: `run of ${Math.max(...runs.map((f) => f.runLength))} exists` };
}

/**
 * Strip every sentence whose multi-period claim is not supported by the derived
 * facts, and report what was removed. Sentences making no multi-period claim
 * pass through untouched. Never throws; empty input returns clean === "".
 */
export function validateMultiPeriodClaims(
  text: string | null | undefined,
  facts: DerivedFact[],
): MultiPeriodResult {
  const src = (text ?? "").trim();
  if (!src) return { clean: "", findings: [], blocked: false };

  const findings: MultiPeriodFinding[] = [];
  const kept: string[] = [];
  for (const sentence of splitSentences(src)) {
    const trigger = findTrigger(sentence);
    const verdict = verifySentence(sentence, facts);
    if (verdict.ok) {
      kept.push(sentence);
    } else {
      findings.push({ sentence, trigger: trigger?.text ?? "", reason: verdict.reason });
    }
  }

  const clean = kept.join(" ").replace(/\s{2,}/g, " ").trim();
  return { clean, findings, blocked: findings.length > 0 };
}
