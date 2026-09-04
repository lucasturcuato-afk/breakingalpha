import type { DeskRecord, DeskRecordEntry } from "@/lib/desk-record.ts";
import { RESOLUTION_ORDER, type Resolution } from "@/lib/desk-record.ts";
import type { OutcomeState } from "@/components/ledger";
import type { DeskEntryFixture, DeskRecordData } from "./fixture";

/**
 * The real desk record, in the shape this screen draws.
 *
 * WHY THIS EXISTS. `/desk-record` shipped with no loader and no gate, so it
 * painted an invented record while `/radar/desk-record` painted the true one
 * on the same deployment. There was never a reason for that: the loader
 * already exists, the tables are public-readable, and the desktop route has
 * been calling it since it was written. This module is the map between the
 * model and the view, and nothing else. No fetch, no React, no decisions of
 * its own beyond the two documented below.
 *
 * The two surfaces now run the SAME query through the SAME
 * `src/lib/desk-record-query.ts`, so they cannot disagree about a count.
 *
 * COUNTS ONLY. Nothing here divides, and nothing here may. A graded record is
 * the most likely place in the product to reach for an aggregate figure, which
 * is why it is the one place the rule is absolute.
 */

/**
 * Model bucket to the four closed outcome words.
 *
 * `noCleanRead` reads Developing because the shipped Ledger already renders a
 * confounded call that way and `OutcomeLead` can render no other word for it.
 *
 * `notGraded` is DELIBERATELY ABSENT. There is no honest word for it in a
 * four-word set: Awaiting means a call still inside its window, and the
 * model's own copy says a not-graded call is one where "no credible grade
 * exists" and never will. Labelling it Awaiting would tell a reader a verdict
 * is coming for a call that can never get one. So those rows are counted in
 * the strip and left off the list, and `hasUnlistedNotGraded` makes the screen
 * say so.
 */
const LISTABLE: Partial<Record<Resolution, OutcomeState>> = {
  supported: "supported",
  challenged: "challenged",
  noCleanRead: "developing",
};

/** "2026-06-02" to "June 2". Parsed by parts, never through Date's ISO path,
 *  which reads a bare date as UTC and can render the previous day west of
 *  Greenwich. */
function longDate(iso: string | null): string | null {
  const parts = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!parts) return null;
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

/** "2026-08-27" to "AUG 27", for the trailing edge of the state row. */
function stampDate(iso: string | null): string | null {
  const parts = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!parts) return null;
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toLocaleUpperCase("en-US");
}

/** Entity and brief date, in the fixture's own "CEG · AUG 27" shape. Either
 *  half may be missing, and a lone separator is not drawn. */
function instrumentOf(entry: DeskRecordEntry): string | undefined {
  const stamp = stampDate(entry.briefDate);
  const halves = [entry.entity, stamp].filter((x): x is string => Boolean(x));
  return halves.length > 0 ? halves.join(" · ") : undefined;
}

export function deskRecordToScreenData(record: DeskRecord): DeskRecordData {
  const entries: DeskEntryFixture[] = [];

  for (const entry of record.entries) {
    const state = LISTABLE[entry.resolution];
    if (!state) continue;
    entries.push({
      id: entry.id,
      state,
      /* The model's own bucket, carried rather than re-derived. See the field
         note in fixture.ts. */
      bucket: entry.resolution,
      instrument: instrumentOf(entry),
      /* Verbatim, as the desk published it. Never rewritten and never
         truncated: the row clamps in CSS, which is reversible, and a
         truncation here would not be. */
      claim: entry.claim,
      result: entry.attributionNote,
    });
  }

  return {
    since: longDate(record.firstBriefDate),
    /* Read straight off the model in the model's own order. The view does not
       sort and does not total. */
    counts: RESOLUTION_ORDER.map((bucket) => ({
      bucket,
      count: record.byResolution[bucket],
    })),
    /* No source. See the field's note in fixture.ts. */
    weaknessHeading: null,
    weaknessProse: null,
    listHeading: "recent",
    /* Off the SAME source as the count in the strip, never off `entries`.
       `buildDeskRecord` truncates `record.entries` to its list limit before
       this function ever sees it, so counting not-graded rows in the loop
       above described the truncated page rather than the record. The moment
       the newest page happened to carry no not-graded row, the strip would
       still have shown its NOT GRADED count and the line explaining why those
       calls are missing from the list would have silently disappeared. That is
       the exact "a count against a shorter list, unexplained" failure the line
       exists to prevent, so the flag and the count now cannot disagree. */
    hasUnlistedNotGraded: record.byResolution.notGraded > 0,
    /* The other reason the list is shorter than the strip, and the bigger one.
       `buildDeskRecord` slices `entries` to the caller's limit while
       `byResolution` counts every row read, so with 99 rows read and a limit
       of 40 the strip counted 99 over a list of 40, of which the not-graded
       rows are then dropped again. Two of the three reasons were on the
       screen and the largest was not.

       Both numbers are read off the model. `record.entries.length` is how many
       rows the list was given, NOT how many render: `entries` above is shorter
       still, and the not-graded line is what accounts for that step. Null when
       the limit did not bite, so the screen says nothing about a cap that did
       not happen. */
    listCap:
      record.total > record.entries.length
        ? { read: record.entries.length, counted: record.total }
        : null,
    entries,
    /* CORRECTED. This read "the record model carries no grader-run timestamp",
       and that was only half true. `graded_at` is non-null on every outcome
       row and `fetchDeskRecord` has always selected it. What was missing was a
       field on the model, which `buildDeskRecord` now folds as a maximum over
       every row read. So the screen can answer "when was this last checked", which is the
       question a record invites and the one it could not answer.

       THIS DOES NOT SWITCH THE STAGE. `loadDeskRecord` still never yields
       `stale` and nothing here decides it should: the stale notice is a claim
       that calls closed after the last run are missing, and there is no
       condition in this read that establishes that. What changes is that the
       branch now has a real value to name if it is ever reached, instead of
       being unreachable by construction. Both entrances get the same field off
       the same read, so it is one record with one answer, not a second one. */
    lastGradedOn: longDate(record.lastGradedAt),
  };
}
