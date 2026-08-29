/**
 * DeskRecordLine - the one line /morning-brief shows for the desk's own record.
 *
 * Split out of BriefCallsSection for two reasons.
 *
 * 1. It shipped a house-rule violation: a summary rate figure, and W/L
 *    shorthand beside it. Both halves are banned.
 *    `design_handoff_signalera_mobile/README.md:316` allows counts and forbids
 *    rates anywhere in the repo, and the shorthand is sports vocabulary that
 *    `src/components/dashboard/call-record.tsx` was deleted for. The counts
 *    survive. The summary does not.
 *
 * 2. It could not be tested where it was. BriefCallsSection reads Supabase in
 *    an effect, so static rendering leaves it in its unavailable state and the
 *    string never appears. A presentational component with the counts as a
 *    REQUIRED prop renders under `react-dom/server`, which is how
 *    tests/unit/reader-output-honesty.test.ts asserts over what a reader sees
 *    rather than over what a module happens to author.
 *
 * Neither the words NOR the buckets are decided here. The words come from
 * DESK_RECORD_COPY.bucketLabel and the order from RESOLUTION_ORDER, the same
 * table and the same order /dashboard's record and the user's own record read.
 * The counts arrive already bucketed by buildDeskRecord. A hand-typed second
 * copy of a vocabulary is how this line drifted from desk-record.ts once
 * already; a hand-rolled second bucketing is how it drifted a second time.
 */
import { Fragment } from "react";
import { DESK_RECORD_COPY, RESOLUTION_ORDER } from "@/lib/desk-record";
import type { DeskRecord, Resolution } from "@/lib/desk-record";

/**
 * Bucket counts, exactly the shape `buildDeskRecord` produces.
 *
 * This prop used to be a shape of its own, keyed by the values the grader
 * stores rather than by the resolution buckets every other surface counts. So
 * a row whose attribution the grader could not separate from its sector still
 * carried a directional grade, and this line filed it under Supported while
 * /dashboard filed the same row under No clean read. Attribution beats raw
 * direction, and the mapping that enforces that lives in scored-object-map.ts.
 * Taking the shared model's own type means this surface cannot re-derive it.
 */
export type DeskResolutionCounts = DeskRecord["byResolution"];

/** The eyebrow: the monospace ledger line, the one place capitals survive. */
const EYEBROW = "font-data text-[10px] tracking-[0.12em] uppercase text-text-faint mr-2";

const L = DESK_RECORD_COPY.bucketLabel;

/** The buckets this line names, in the shared order. `notGraded` is an absence
 *  rather than a resolution: the full record surface explains it at length, and
 *  a single line in a brief states the three that resolved. It is excluded from
 *  the roll-up for the same reason, so the noun stays true. */
const SHOWN: Resolution[] = RESOLUTION_ORDER.filter((r) => r !== "notGraded");

/** Data is a required prop. There is no default and no fallback content: a
 *  caller with nothing to show renders its own unavailable line instead. */
export function DeskRecordLine({ record }: { record: DeskResolutionCounts }) {
  // Deliberately not on one line with the word `graded`: the counted buckets
  // and the noun they roll up to are separate statements.
  const counted = SHOWN.reduce((n, r) => n + record[r], 0);
  return (
    <p className="font-sans text-[11px] text-text-muted">
      <span className={EYEBROW}>Desk record</span>
      {SHOWN.map((r, i) => (
        <Fragment key={r}>
          {i > 0 ? " · " : ""}
          {record[r]} {L[r]}
        </Fragment>
      ))}
      {counted > 0 ? ` · ${counted} graded calls` : ""}
      {" · "}graded by price attribution
    </p>
  );
}
