/**
 * Today's Stories rail: session-window partitioning and heading label.
 *
 * Root cause this fixes (defect #1, cross-brief duplication): both the
 * morning-brief and evening-wrap pages ran an identical rolling now()-24h
 * ingested_at query ordered by relevance_score only. At morning generation
 * time the rolling 24h window fully contains the prior evening's window, so
 * yesterday's evening top stories re-surface in today's morning brief.
 *
 * Fix: anchor each rail on the brief's own created_at and floor the ingest
 * window at the OTHER session's last generation boundary, read live from the
 * briefings table (no hardcoded cron times, no snapshot, no migration). The
 * two session windows are then disjoint, so the rails cannot share rows.
 *
 * Also owns defect #3 (heading): the label is derived from the brief's
 * created_at vs now in PT, not a frozen "Today's" literal.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPTDateLong, ptDateSlug } from "@/lib/format-pt";

export type BriefingType = "morning" | "evening";

// Fallback ingest span used only when the opposite session's briefing row
// cannot be read (first-ever brief, or a Supabase blip). Wide enough to fill
// the rail, narrow enough to stay same-session on a normal cadence.
const FALLBACK_SPAN_MS = 18 * 60 * 60 * 1000;

/**
 * Lower bound (ISO) for a rail's ingested_at window: the most recent
 * opposite-session briefing generated strictly before the anchor. Falls back
 * to anchor - FALLBACK_SPAN_MS when no such row exists or the read fails.
 */
export async function sessionIngestFloor(
  supabase: SupabaseClient,
  briefingType: BriefingType,
  anchorIso: string,
): Promise<string> {
  const opposite: BriefingType = briefingType === "morning" ? "evening" : "morning";
  try {
    const { data } = await supabase
      .from("briefings")
      .select("created_at")
      .eq("briefing_type", opposite)
      .lt("created_at", anchorIso)
      .order("created_at", { ascending: false })
      .limit(1);
    const floor = (data?.[0] as { created_at?: string } | undefined)?.created_at;
    if (floor) return floor;
  } catch {
    /* soft-fail to the default span below */
  }
  return new Date(new Date(anchorIso).getTime() - FALLBACK_SPAN_MS).toISOString();
}

/** Published-date floor for the rail, keyed to the brief's anchor (not now). */
export function publishedFloor(anchorIso: string, days = 7): string {
  return new Date(new Date(anchorIso).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Heading label. Returns the same-day label when the brief's created_at is
 * the same PT calendar day as now; otherwise a dated label so a day-old brief
 * never claims "Today's". `quiet` (fewer than 3 in-window rows) always wins
 * and relabels to "Recent Stories".
 */
export function storiesHeadingLabel(
  createdAt: string | null | undefined,
  sameDayLabel: string,
  quiet: boolean,
): string {
  if (quiet) return "Recent Stories";
  if (!createdAt) return sameDayLabel;
  const sameDay = ptDateSlug(createdAt) === ptDateSlug();
  if (sameDay) return sameDayLabel;
  const dated = formatPTDateLong(createdAt); // "Wednesday, July 1"
  return dated ? `Stories from ${dated}` : sameDayLabel;
}
