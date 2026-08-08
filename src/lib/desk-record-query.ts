/**
 * desk-record-query - the single read path behind Signalera's own call record.
 *
 * /radar/desk-record and the dashboard's desk-record summary render the SAME
 * numbers because they run the SAME two selects and the same join rule. When
 * this lived inline in the page, a second surface meant a second query and the
 * two could disagree about the total. It does not live in two places now.
 *
 * READ ONLY: two selects, no writes, no schema dependency beyond columns the
 * brief already reads. Both tables are public-readable. Returns null on any
 * error so the caller renders an honest failure instead of a partial count.
 */

import { buildDeskRecord, type DeskCallRow, type DeskRecord } from "./desk-record.ts";
import { todayPt } from "./session-date.ts";
import type { CallOutcomeRow } from "./scored-object-map.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Newest graded calls. Bounds the read; counts are over exactly what is read. */
export const OUTCOME_LIMIT = 500;

interface BriefCallRow {
  id: string;
  claim_text: string;
  claim_type: string | null;
  target_symbol: string | null;
  brief_date: string | null;
  created_at: string | null;
  confidence: number | null;
}

/** Any Supabase client with public read access to the two tables. */
type QueryClient = SupabaseClient;

export { todayPt } from "./session-date.ts";

/**
 * Load the whole desk record. `null` means the read failed and the caller must
 * say so; an empty record (total 0) means there is genuinely nothing graded.
 */
export async function fetchDeskRecord(
  supabase: QueryClient,
  listLimit: number,
): Promise<DeskRecord | null> {
  const { data: outcomeData, error: outcomeError } = await supabase
    .from("morning_brief_call_outcomes")
    .select(
      "call_id, verdict, attribution, actual_pct_change, actual_direction, verdict_notes, graded_at, metadata",
    )
    .order("graded_at", { ascending: false })
    .limit(OUTCOME_LIMIT);
  if (outcomeError) return null;

  // Latest outcome per call (no unique constraint on call_id in the DB).
  const byCall = new Map<string, CallOutcomeRow>();
  for (const o of (outcomeData as CallOutcomeRow[] | null) ?? []) {
    const prev = byCall.get(o.call_id);
    if (!prev || (o.graded_at ?? "") > (prev.graded_at ?? "")) byCall.set(o.call_id, o);
  }

  const today = todayPt();
  if (byCall.size === 0) return buildDeskRecord([], today, listLimit);

  const { data: callData, error: callError } = await supabase
    .from("morning_brief_calls")
    .select("id, claim_text, claim_type, target_symbol, brief_date, created_at, confidence")
    .in("id", [...byCall.keys()]);
  if (callError) return null;

  // Only calls whose text we actually have. A grade with no claim behind it is
  // dropped rather than rendered as an anonymous verdict.
  const rows: DeskCallRow[] = [];
  for (const c of (callData as BriefCallRow[] | null) ?? []) {
    const outcome = byCall.get(c.id);
    if (!outcome || !c.claim_text) continue;
    rows.push({ call: c, outcome });
  }

  return buildDeskRecord(rows, today, listLimit);
}
