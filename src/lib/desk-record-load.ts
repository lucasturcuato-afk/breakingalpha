import { createClient } from "@supabase/supabase-js";
import type { DeskStage } from "@/components/desk-record";
import type { DeskRecordData } from "@/components/desk-record/fixture";
import { deskRecordToScreenData } from "@/components/desk-record/from-record";
import { fetchDeskRecord } from "./desk-record-query.ts";

/**
 * desk-record-load - the ONE path from the desk's graded record to the props
 * the mobile record screen draws.
 *
 * WHY IT IS A MODULE AND NOT A FUNCTION IN A PAGE. The record is now reachable
 * from two places on a phone: the Ledger's tail action opens `/desk-record`,
 * and Radar's fourth section is `/watch/desk-record`. The standing constraint
 * on that is exact:
 *
 *   Two entrances to one record is acceptable. Two records is not.
 *
 * Two entrances become two records the moment the second one re-queries
 * `morning_brief_call_outcomes`, re-buckets the rows, or reaches for
 * `DESK_FIXTURE`. All three have shipped in this repo before. The header of
 * `src/app/desk-record/page.tsx` records the worst of them: that route once had
 * the sample record as a default parameter and no gate in its path, so
 * production drew an invented SUPPORTED 64 / CHALLENGED 39 under copy promising
 * "Every call the desk has published since June 2 is here", while
 * `/radar/desk-record` drew the true counts on the same deployment.
 *
 * The obvious way to add the second entrance is to copy the twenty lines that
 * were in that page into the new one. That copy is how the two would drift: one
 * limit changes, one branch gets an extra state, and the product has two track
 * records again with nothing red anywhere. So the twenty lines moved here and
 * both routes call this. `src/lib/desk-record-query.ts` already did exactly
 * this one level down, for exactly this reason, and its header says so.
 *
 * WHAT IS NOW SHARED, end to end, by both entrances:
 *
 *   fetchDeskRecord        the two selects and the latest-outcome-per-call rule
 *   buildDeskRecord        the bucketing and the list truncation
 *   deskRecordToScreenData the map from model to props, counts only
 *   DeskRecordScreen       the view
 *
 * Nothing is left for a caller to get wrong except which navigation element to
 * draw above the title, which is the one thing that legitimately differs.
 *
 * READ ONLY. Two selects through `fetchDeskRecord`, no writes, no schema
 * dependency beyond columns the brief already reads.
 */

/**
 * How many resolved calls are READ INTO the list. An upper bound on rows read,
 * not on rows shown: `buildDeskRecord` truncates here, and
 * `deskRecordToScreenData` then drops the not-graded rows, which have no
 * verdict word, so the rendered list is shorter than this by however many of
 * the newest rows were not graded.
 *
 * Counts always cover every row the read returned, never just the listed ones.
 * ONE constant, because a limit that differed between two entrances would make
 * their lists differ while their counts agreed, which is the most confusing
 * shape this defect could take. `/radar/desk-record` passes the same 40.
 */
export const DESK_LIST_LIMIT = 40;

export interface DeskRecordRead {
  stage: DeskStage;
  data: DeskRecordData | null;
}

/**
 * The real read.
 *
 * Errors and empties are kept apart on purpose: a failed query that renders as
 * "no graded calls yet" is the defect `supabase-query.ts` exists to name, and it
 * is worse here than anywhere, because the reader would take an outage as the
 * desk having no record at all.
 */
export async function loadDeskRecord(): Promise<DeskRecordRead> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { stage: "error", data: null };

  try {
    // Both tables are public-readable, so this needs no session. Same client
    // shape /share/brief/[id] already uses for an anonymous server read.
    const record = await fetchDeskRecord(createClient(url, anonKey), DESK_LIST_LIMIT);
    // A null answer from fetchDeskRecord means a failed select, never an
    // empty one. The two are kept apart deliberately.
    if (!record) return { stage: "error", data: null };
    if (record.total === 0) return { stage: "empty", data: null };
    return { stage: "ready", data: deskRecordToScreenData(record) };
  } catch {
    return { stage: "error", data: null };
  }
}
