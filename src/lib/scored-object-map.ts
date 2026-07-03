/**
 * scored-object-map — pure mappers from real rows to ScoredObject OPEN props.
 *
 * These ONLY ever produce `state: "open"`. There is no resolution model on live
 * surfaces yet, so nothing here can emit right/wrong/inconclusive, a verdict word,
 * a calibration line, or a scored date. Every field is passed straight from real
 * data; a missing field is omitted (never faked). The resolved ScoredObject states
 * live exclusively in /preview/scored-object.
 */

import type { ScoredObjectProps } from "@/components/scored-object/ScoredObject";

/** Short "Apr 8" style date; returns undefined for missing/invalid input. */
export function shortDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** 0-1 confidence -> integer percent; undefined if not a real number. */
function toPct(confidence: number | null | undefined): number | undefined {
  if (confidence == null || Number.isNaN(confidence)) return undefined;
  // Stored 0-1; guard against an already-percent value just in case.
  const pct = confidence <= 1 ? confidence * 100 : confidence;
  return Math.round(pct);
}

export interface OpenThesisInput {
  /** Already-neutralized title/claim (caller applies neutralizeThesisTitle). */
  claim: string;
  sector?: string | null;
  generated_at?: string | null;
  check_after?: string | null;
  horizon?: string | null;
  confidence?: number | null;
}

/** Map an OPEN thesis (no terminal outcome) to ScoredObject open props. */
export function openThesisProps(t: OpenThesisInput): ScoredObjectProps {
  return {
    state: "open",
    sector: (t.sector && t.sector.trim()) || "Thesis",
    claim: t.claim,
    calledDate: shortDate(t.generated_at),
    confidencePct: toPct(t.confidence),
    resolvesWhen: shortDate(t.check_after),
    resolvesSource: t.horizon ? `the ${t.horizon} signal check` : undefined,
  };
}

export interface OpenCallInput {
  claim_text: string;
  target_symbol?: string | null;
  claim_type?: string | null;
  confidence?: number | null;
  created_at?: string | null;
  brief_date?: string | null;
}

/**
 * Map a real morning_brief_calls row to ScoredObject open props. These are the
 * brief's predictive claims; grading is not live, so they only ever render open.
 */
export function openCallProps(c: OpenCallInput): ScoredObjectProps {
  const eyebrow =
    (c.target_symbol && c.target_symbol.trim()) ||
    (c.claim_type && c.claim_type.trim()) ||
    "Call";
  return {
    state: "open",
    sector: eyebrow,
    claim: c.claim_text,
    calledDate: shortDate(c.created_at ?? c.brief_date),
    confidencePct: toPct(c.confidence),
    // Grading basis is the market close (how these are scored once resolution
    // ships); the resolve DATE is not a stored field, so it is left to the
    // component's neutral fallback rather than invented.
    resolvesSource: "the market close",
  };
}
