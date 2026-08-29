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
 * The words are not typed here. They come from DESK_RECORD_COPY.bucketLabel,
 * the same table /dashboard's record and the user's own record read, because a
 * hand-typed second copy of a vocabulary is exactly how this line drifted from
 * desk-record.ts in the first place.
 */
import { DESK_RECORD_COPY } from "@/lib/desk-record";

/**
 * Counts of morning_brief_call_outcomes rows by stored `verdict`.
 *
 * Field names stay tied to the values backend/grading writes, so the mapping
 * from a stored value to a shown word is visible in one place. `partial` is a
 * graded call with no attributable directional hit, which
 * `scored-object-map.ts` maps to state `inconclusive` and
 * `verdict-vocabulary.ts` maps to resolution `noCleanRead`.
 */
export interface DeskVerdictCounts {
  correct: number;
  wrong: number;
  partial: number;
  ungradable: number;
}

const L = DESK_RECORD_COPY.bucketLabel;

/** The eyebrow: the monospace ledger line, the one place capitals survive. */
const EYEBROW = "font-data text-[10px] tracking-[0.12em] uppercase text-text-faint mr-2";

/** Data is a required prop. There is no default and no fallback content: a
 *  caller with nothing to show renders its own unavailable line instead. */
export function DeskRecordLine({ record }: { record: DeskVerdictCounts }) {
  // Deliberately not on one line with the word `graded`: the counted buckets
  // and the noun they roll up to are separate statements.
  const counted =
    record.correct + record.wrong + record.partial;
  return (
    <p className="font-sans text-[11px] text-text-muted">
      <span className={EYEBROW}>Desk record</span>
      {record.correct} {L.supported} · {record.wrong} {L.challenged} ·{" "}
      {record.partial} {L.noCleanRead}
      {counted > 0 ? ` · ${counted} graded calls` : ""}
      {" · "}graded by price attribution
    </p>
  );
}
