/**
 * desk-record - the pure model behind Signalera's own call record.
 *
 * Signalera grades its own morning-brief calls against real price benchmarks
 * (backend/grading) and stores the result in morning_brief_call_outcomes. This
 * module turns those rows into the exact strings the record surface renders,
 * so the presentation layer is a 1:1 map with no decisions of its own and the
 * whole thing is testable under `node --test` (the .tsx cannot load there).
 *
 * HONESTY RULES, enforced here rather than in the view:
 *  - Nothing is filtered. Every graded row lands in exactly one bucket, and
 *    the buckets sum to the row count. There is no "wins only" view.
 *  - Bucketing is derived from scoredCallProps, the same mapper the live
 *    scored objects use, so the counts can never drift from the cards.
 *  - A confounded move is NEVER a hit. Attribution beats raw direction: if
 *    the grader could not separate the move from its sector or the market,
 *    the call reads "No clean read" whatever direction prices went.
 *  - Legacy rows from the pre-attribution grader (attribution null) are not
 *    counted as anything; they are an explicit "not graded" absence.
 *
 * COMPLIANCE: this is a record of the desk's own analytical calls, never a
 * performance or return claim. Vocabulary is observational only (supported,
 * challenged, no clean read, awaiting). Nothing here aggregates into a
 * profit-shaped number, and DESK_RECORD_COPY is asserted clean of
 * investment-result vocabulary by tests/unit/desk-record.test.ts.
 *
 * The grader's free-text verdict_notes are deliberately not carried into the
 * record entries: they are model prose written in market-move vocabulary. The
 * benchmark evidence itself still renders, via the mapper's attribution line.
 */

import {
  scoredCallProps,
  type CallOutcomeRow,
  type OpenCallInput,
} from "./scored-object-map.ts";
import type { ScoredObjectProps, ScoredState } from "@/components/scored-object/ScoredObject";
// The single vocabulary table. It used to live here as two private constants,
// which is why ScoredObject could not reach it and defaulted to Right/Wrong.
import {
  RESOLUTION_BY_STATE,
  VERDICT_WORD,
  type Resolution,
} from "./verdict-vocabulary.ts";

export type { Resolution };

/** A morning_brief_calls row joined to its morning_brief_call_outcomes row. */
export interface DeskCallRow {
  call: OpenCallInput & { id: string };
  outcome: CallOutcomeRow;
}

// Re-exported so the user's own record (src/lib/your-record.ts, PR #542) buckets
// through exactly this shared table rather than growing a parallel one that could
// drift. The definitions now live in verdict-vocabulary.ts (PR #543); #542
// originally declared them locally here, which this rebase drops in favor of the
// shared source.
export { RESOLUTION_BY_STATE, VERDICT_WORD };

/** All copy the record surface authors itself. Every user-visible string on
 *  the surface that is not verbatim call text lives here so the compliance
 *  test can assert over the whole of it. */
export const DESK_RECORD_COPY = {
  title: "How the desk's calls resolved",
  intro:
    "Every predictive call in the morning brief is graded against real prices, and the grade stands whichever way it went. This is the whole record, misses included.",
  // Derived, not retyped: the bucket heading and the word on a card are the
  // same vocabulary, and a second literal copy is how they drift apart.
  // notGraded has no verdict word (an absence is not a verdict), so the
  // heading supplies its own.
  bucketLabel: {
    supported: VERDICT_WORD.supported!,
    challenged: VERDICT_WORD.challenged!,
    noCleanRead: VERDICT_WORD.noCleanRead!,
    notGraded: "Not graded",
  } as Record<Resolution, string>,
  bucketNote: {
    supported: "The call's direction held, and the move was attributable to it.",
    challenged: "The evidence challenged the call's direction. It stays on the record.",
    noCleanRead:
      "The move could not be separated from the sector or the wider market, or it sat under the attribution bar.",
    notGraded:
      "No credible grade exists: no price data, no mappable symbol, or a call graded before benchmark attribution existed.",
  } as Record<Resolution, string>,
  attributionLabel: {
    clean: "Clean",
    confounded: "Confounded",
    inconclusive: "Inconclusive",
    unattributed: "Not attributed",
  },
  attributionHeading: "What clean and confounded mean",
  attributionExplainer:
    "A call is only credited when the grader can tell the move apart from its sector and the market. That is a clean read. If the name moved because everything moved, the read is confounded and the call is never counted as supported, even when the direction matched. Under the attribution bar the read is inconclusive. Confounded and inconclusive calls sit in No clean read.",
  emptyTitle: "No graded calls yet",
  emptyBody:
    "Calls appear here once their window closes and the grader has real prices to check them against. Nothing is shown before then.",
  errorTitle: "The record could not be loaded",
  errorBody:
    "The graded-call record is temporarily unavailable. Nothing is estimated in its place.",
  awaitingNote: "Calls still inside their window are awaiting a grade and are not shown here.",
  listHeading: "Most recently resolved",
  countsHeading: "The whole record",
  attributionCountsHeading: "Attribution of every graded call",
} as const;

export interface DeskRecordEntry {
  id: string;
  /** Verbatim claim text as the desk published it. Never rewritten. */
  claim: string;
  /** Ticker, sector proxy, or "Macro" - whatever the card's eyebrow shows. */
  entity: string;
  resolution: Resolution;
  /** Observational verdict word, or undefined for the not-graded absence. */
  verdictLabel?: string;
  /** The grader's benchmark evidence line, or the not-graded reason. */
  attributionNote?: string;
  briefDate: string | null;
  /** Props handed straight to ScoredObject. The component is not forked. */
  props: ScoredObjectProps;
}

export interface DeskRecord {
  total: number;
  /** Raw verdict counts, exactly as stored. */
  byVerdict: Record<string, number>;
  /** Raw attribution counts; null attribution counts as "unattributed". */
  byAttribution: Record<string, number>;
  /** Bucket counts. Sums to total, always. */
  byResolution: Record<Resolution, number>;
  /** Reverse-chronological, unfiltered. */
  entries: DeskRecordEntry[];
  /** Earliest / latest brief_date present, for an honest window label. */
  firstBriefDate: string | null;
  lastBriefDate: string | null;
  /**
   * When the grader last wrote an outcome in this read, as the newest
   * `graded_at` across every row. Null only when no row carries one.
   *
   * IT IS NOT A COLUMN THAT WAS MISSING. A previous pass recorded that no
   * grader-run timestamp exists here, and that was only half true.
   * `graded_at` is non-null on every outcome row and `fetchDeskRecord` already
   * selects it. It was the FIELD on this model that did not exist, so the
   * mapper had nothing to read and set the screen's `lastGradedOn` to null,
   * which in turn made the stale state unreachable by construction.
   *
   * A maximum, never the first row's value. `byRecencyDesc` sorts on brief_date
   * first, so the newest brief is not necessarily the most recently graded
   * call: a late grade against an older brief is exactly the case this answers.
   */
  lastGradedAt: string | null;
}

const EMPTY_RESOLUTIONS: Record<Resolution, number> = {
  supported: 0,
  challenged: 0,
  noCleanRead: 0,
  notGraded: 0,
};

/** Reverse chronological: newest brief first, newest grade breaking ties. */
function byRecencyDesc(a: DeskCallRow, b: DeskCallRow): number {
  const ad = a.call.brief_date ?? "";
  const bd = b.call.brief_date ?? "";
  if (ad !== bd) return ad < bd ? 1 : -1;
  const ag = a.outcome.graded_at ?? "";
  const bg = b.outcome.graded_at ?? "";
  if (ag !== bg) return ag < bg ? 1 : -1;
  return 0;
}

/**
 * Build the whole record model from real joined rows.
 *
 * `todayPtDate` is today's US-Pacific session date, passed through to the
 * mapper only to distinguish a live window from a closed one. It never
 * influences a verdict. `limit` caps the rendered LIST only; the counts are
 * always over every row passed in, so the headline can never disagree with
 * the data by showing a filtered subset.
 */
export function buildDeskRecord(
  rows: DeskCallRow[],
  todayPtDate: string,
  limit = 40,
): DeskRecord {
  const byVerdict: Record<string, number> = {};
  const byAttribution: Record<string, number> = {};
  const byResolution: Record<Resolution, number> = { ...EMPTY_RESOLUTIONS };
  let firstBriefDate: string | null = null;
  let lastBriefDate: string | null = null;
  let lastGradedAt: string | null = null;

  const sorted = [...rows].sort(byRecencyDesc);

  for (const row of sorted) {
    const verdict = row.outcome.verdict ?? "unknown";
    byVerdict[verdict] = (byVerdict[verdict] ?? 0) + 1;

    const attribution = row.outcome.attribution ?? "unattributed";
    byAttribution[attribution] = (byAttribution[attribution] ?? 0) + 1;

    const props = scoredCallProps(row.call, row.outcome, todayPtDate);
    byResolution[RESOLUTION_BY_STATE[props.state]] += 1;

    const d = row.call.brief_date ?? null;
    if (d) {
      if (!firstBriefDate || d < firstBriefDate) firstBriefDate = d;
      if (!lastBriefDate || d > lastBriefDate) lastBriefDate = d;
    }

    /* Over every row read, not over the listed page. The list is truncated
       below and the counts are not, and a "last checked" that moved when the
       list limit changed would be a second figure describing the same read. */
    const g = row.outcome.graded_at ?? null;
    if (g && (!lastGradedAt || g > lastGradedAt)) lastGradedAt = g;
  }

  const entries = sorted.slice(0, limit).map((row): DeskRecordEntry => {
    const mapped = scoredCallProps(row.call, row.outcome, todayPtDate);
    const resolution = RESOLUTION_BY_STATE[mapped.state];
    const verdictLabel = VERDICT_WORD[resolution];
    // calibration carries the grader's free-text notes; see the file header.
    const props: ScoredObjectProps = {
      ...mapped,
      calibration: undefined,
      verdict: verdictLabel,
    };
    return {
      id: row.call.id,
      claim: row.call.claim_text,
      entity: mapped.sector,
      resolution,
      verdictLabel,
      attributionNote: mapped.attribution ?? mapped.notGradedReason,
      briefDate: row.call.brief_date ?? null,
      props,
    };
  });

  return {
    total: rows.length,
    byVerdict,
    byAttribution,
    byResolution,
    entries,
    firstBriefDate,
    lastBriefDate,
    lastGradedAt,
  };
}

/** Bucket render order. Misses are not pushed to the end: challenged and no
 *  clean read sit immediately beside supported, at the same size. */
export const RESOLUTION_ORDER: Resolution[] = [
  "supported",
  "challenged",
  "noCleanRead",
  "notGraded",
];

export const ATTRIBUTION_ORDER = [
  "clean",
  "confounded",
  "inconclusive",
  "unattributed",
] as const;

/**
 * Every component-authored string the surface can render for a given model.
 * Used by the compliance test; the view renders exactly these plus verbatim
 * call text and the mapper's attribution lines.
 */
export function deskRecordAuthoredStrings(record: DeskRecord | null): string[] {
  const copy = DESK_RECORD_COPY;
  const out: string[] = [
    copy.title,
    copy.intro,
    copy.attributionHeading,
    copy.attributionExplainer,
    copy.emptyTitle,
    copy.emptyBody,
    copy.errorTitle,
    copy.errorBody,
    copy.awaitingNote,
    copy.listHeading,
    copy.countsHeading,
    copy.attributionCountsHeading,
    ...Object.values(copy.bucketLabel),
    ...Object.values(copy.bucketNote),
    ...Object.values(copy.attributionLabel),
  ];
  for (const r of RESOLUTION_ORDER) {
    out.push(String(record?.byResolution[r] ?? 0));
  }
  for (const entry of record?.entries ?? []) {
    if (entry.verdictLabel) out.push(entry.verdictLabel);
  }
  return out;
}
