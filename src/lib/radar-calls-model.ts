import { horizonFromDates } from "./call-horizons.ts";

/**
 * radar-calls-model - the shapes and the pure rules behind Radar's Calls
 * section, on both the desk and the phone.
 *
 * WHAT MOVED HERE AND WHY. Every declaration in this file was module-private
 * inside `src/app/radar/calls/page.tsx`. That was fine while the desk was the
 * only surface that drew calls. Radar's third section now exists on a phone
 * too, and the alternative to this file was a second copy of the grouping rule
 * and a second copy of two sentences that tell a reader how a call resolves.
 *
 * A second copy of a SENTENCE is the worse half. `briefResolutionSentence`
 * states the grading contract in prose: "only a move beyond sector and market
 * counts". Two surfaces drifting on the shape of a card is a design
 * inconsistency; two surfaces drifting on that sentence is the product
 * describing its own grader two different ways. This repo has paid for
 * one-rule-many-implementations at least five times (PR 713, PR 721, PR 736,
 * PR 738, and four copies of `slugToCompanyName`), and the copies were always
 * cheaper to write than the shared module was.
 *
 * PURE. No React, no DOM, no fetch, no Supabase. Every function here is a
 * function of its arguments, which is what lets
 * `tests/unit/radar-calls-model.test.ts` hold the grouping rule without a
 * browser and without a database.
 *
 * WHAT DID NOT MOVE. The desk's heroes (`RecordHero`, `PinnedHero`,
 * `ResolvingHero`), its authoring flow and its adopt path stay exactly where
 * they are. They are not shared, because the phone does not draw them, and
 * lifting a component nobody else calls is indirection rather than reuse.
 * `RecordHero` in particular must NOT be lifted: it renders an aggregate figure
 * as a percentage, and that figure may not cross to a mobile surface.
 */

/** A claim the reader owns: authored in their own words, or adopted. */
export interface UserClaim {
  id: string;
  user_claim: string;
  evidence_entities?: string[] | null;
  claim_type: string;
  target_symbol: string | null;
  expected_direction: string | null;
  resolution_window_start: string | null;
  resolution_window_end: string | null;
  gradeable: boolean;
  gradeability_note: string | null;
  status: string;
  source: "authored" | "adopted";
  adopted_from_call_id: string | null;
  created_at: string;
}

/** A call the desk published in a brief. */
export interface BriefCallRow {
  id: string;
  claim_text: string;
  claim_type: string | null;
  target_symbol: string | null;
  brief_date: string | null;
  /** Set at creation from the fixed horizon map. NULL on pre-migration-0014 calls. */
  resolve_on: string | null;
  created_at: string | null;
  confidence: number | null;
}

export interface BriefGroup {
  id: string;
  label: string;
  calls: BriefCallRow[];
}

export function groupSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Group brief calls by what they are ABOUT: single-name calls under
 * their company's real sector (from the companies table), then sector
 * calls, indices, and macro. A ticker with no resolved sector lands in
 * an honest "Single names" bucket rather than a guessed sector.
 */
export function groupBriefCalls(
  calls: BriefCallRow[],
  tickerSectors: Record<string, string>,
): BriefGroup[] {
  const groups = new Map<string, BriefCallRow[]>();
  const push = (label: string, c: BriefCallRow) => {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(c);
  };
  for (const c of calls) {
    const type = c.claim_type ?? "";
    if (type === "ticker") {
      push((c.target_symbol && tickerSectors[c.target_symbol]) || "Single names", c);
    } else if (type === "sector") push("Sector calls", c);
    else if (type === "index") push("Indices", c);
    else if (type === "aggregate") push("Macro", c);
    else push("Other", c);
  }
  return [...groups.entries()]
    .map(([label, groupCalls]) => ({ id: groupSlug(label), label, calls: groupCalls }))
    .sort((a, b) => b.calls.length - a.calls.length);
}

/** A plain sentence for what a call is watching for and how it
 *  resolves, derived from its resolution method. Informative, never
 *  decorative; context-only claims state their honest note. */
export function resolutionSentence(c: UserClaim): string {
  if (!c.gradeable) {
    return c.gradeability_note ?? "Tracked as context only; no price resolution.";
  }
  const dir =
    c.expected_direction === "bearish"
      ? "to the downside"
      : c.expected_direction === "neutral"
        ? "by staying flat"
        : "to the upside";
  const windowText =
    c.resolution_window_start && c.resolution_window_start !== c.resolution_window_end
      ? `over ${c.resolution_window_start} to ${c.resolution_window_end}`
      : `against the ${c.resolution_window_end ?? "session"} close`;
  if (c.claim_type === "index") {
    return `Watching whether ${c.target_symbol} moves ${dir} on its own, ${windowText}; indices are graded on their absolute move.`;
  }
  if (c.claim_type === "sector") {
    return `Watching whether ${c.target_symbol} beats SPY ${dir} ${windowText}.`;
  }
  return `Watching whether ${c.target_symbol} beats its sector ETF and SPY ${dir} ${windowText}; a move the market explains is not credited.`;
}

export function briefResolutionSentence(c: BriefCallRow): string {
  const h = horizonFromDates(c.brief_date, c.resolve_on);
  // A horizon-bearing call states its real window. A pre-horizons call (NULL
  // resolve_on) keeps the old sentence rather than implying a window it does
  // not have.
  if (h && h.days > 0) {
    return `Resolves over ${c.brief_date} to ${c.resolve_on} with benchmark attribution: only a move beyond sector and market counts.`;
  }
  return `Resolves against the ${c.brief_date ?? "session"} market close with benchmark attribution: only a move beyond sector and market counts.`;
}
