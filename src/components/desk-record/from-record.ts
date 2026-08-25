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
  let unlisted = false;

  for (const entry of record.entries) {
    const state = LISTABLE[entry.resolution];
    if (!state) {
      unlisted = true;
      continue;
    }
    entries.push({
      id: entry.id,
      state,
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
    hasUnlistedNotGraded: unlisted,
    entries,
    /* The record model carries no grader-run timestamp, so the stale state has
       nothing to name and the wired path never selects it. */
    lastGradedOn: null,
  };
}
