/**
 * issue-number.ts   assigns and caches the sequential newsletter issue
 * number on a briefings row.
 *
 * Stored in briefings.issue_number (int, nullable until first send).
 * Migration: sql/brief_email_unsubscribe.sql.
 *
 * Compute strategy:
 *   - If the briefing already has issue_number set, return it (stable).
 *   - Otherwise: SELECT MAX(issue_number) FROM briefings, +1, write back.
 *     Using MAX rather than COUNT means we keep monotonic numbering even
 *     if older briefings get deleted   the unique partial index in the
 *     migration prevents collisions on concurrent first-sends.
 *
 * Soft-fail: if the column does not exist yet (migration not applied),
 * we return null and the email still sends   the header just omits
 * "Issue #N". This keeps email delivery resilient to schema drift.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function ensureIssueNumber(
  supabase: SupabaseClient,
  briefingId: string,
  cachedIssueNumber: number | null | undefined,
): Promise<number | null> {
  if (typeof cachedIssueNumber === "number" && cachedIssueNumber > 0) {
    return cachedIssueNumber;
  }

  // Find the next number.
  const { data: maxRow, error: maxErr } = await supabase
    .from("briefings")
    .select("issue_number")
    .not("issue_number", "is", null)
    .order("issue_number", { ascending: false })
    .limit(1);

  if (maxErr) {
    // Likely "column briefings.issue_number does not exist"   migration
    // not yet applied. Soft-fail: skip issue numbering for this send.
    console.warn(
      "[issue-number] lookup failed (migration likely not applied):",
      maxErr.message,
    );
    return null;
  }

  const next =
    (maxRow && maxRow[0] && typeof maxRow[0].issue_number === "number"
      ? maxRow[0].issue_number
      : 0) + 1;

  const { error: writeErr } = await supabase
    .from("briefings")
    .update({ issue_number: next })
    .eq("id", briefingId)
    .is("issue_number", null);

  if (writeErr) {
    console.warn(
      "[issue-number] write failed; returning computed value anyway:",
      writeErr.message,
    );
    // Still return the number   the unique index would've blocked a
    // collision and surfaced a different error. This path only hits
    // benign races where another sender already wrote a value.
  }

  return next;
}
