/**
 * The shapes and the pure rules behind the phone layout of /cross-source.
 *
 * Nothing here renders. It is separate from the screen so the four decisions
 * that fail without a symptom are testable without a browser: which panel a
 * pair of (fault, rows) resolves to, how a lag reads, when a panel is behind,
 * and what a row's outcome split is called.
 *
 * THE TYPES ARE STRUCTURAL SUBSETS of the rows `/api/source-reliability` and
 * `/api/cross-source` already return, and of the interfaces the desk layout in
 * `src/app/cross-source/page.tsx` already declares over them. They name only
 * the fields the phone draws, so a field this surface deliberately does not
 * draw cannot reach it by accident. The route's own arrays assign to them
 * without a mapping step, because a wider object is assignable to a narrower
 * one everywhere except a fresh object literal.
 */

/** A row of `source_reliability`, narrowed to what a phone draws. */
export interface SourceStanding {
  identity: string;
  n_clean_outcomes: number;
  n_correct: number;
  n_wrong: number;
  confidence: string;
  is_syndicator: boolean;
  last_outcome_at: string | null;
}

/** One article inside a same-event cluster. */
export interface ClusterMemberStanding {
  article_id: string;
  identity: string;
  title: string | null;
  role: string;
  lag_minutes: number | null;
  is_syndicator: boolean;
  timestamp_basis: string;
}

export interface FigureFindingStanding {
  kind: string;
  detail: string;
  members: { id: string; label: string; figures: { raw: string }[] }[];
}

export interface ClusterStanding {
  cluster_key: string;
  base_key: string;
  article_count: number;
  distinct_identities: number;
  distinct_non_syndicators: number;
  window_start: string | null;
  members: ClusterMemberStanding[];
  figure_findings: FigureFindingStanding[];
}

/** What the route already builds when a read fails. */
export interface PanelFault {
  error: string;
  code?: string | null;
  detail?: string;
  hint?: string | null;
}

export type PanelStage = "loading" | "error" | "empty" | "ready";

/**
 * A FAILED READ IS NOT AN EMPTY ONE, and this function is the only place that
 * ordering is decided for the phone layout.
 *
 * The fault is tested FIRST and the row count second. Written the other way
 * round, a read that threw and left the rows null would fall through to a
 * count of zero and borrow the empty panel's sentence, which is issue 839's
 * whole shape. `loading` is checked only after the fault, so a refresh that
 * has already failed keeps saying so rather than flickering back to a
 * skeleton.
 */
export function panelStage(
  fault: PanelFault | null,
  rows: readonly unknown[] | null,
  loading: boolean,
): PanelStage {
  if (fault) return "error";
  if (rows === null) return loading ? "loading" : "error";
  if (loading && rows.length === 0) return "loading";
  return rows.length === 0 ? "empty" : "ready";
}

/**
 * How far behind the lead an item was, as a reader reads it.
 *
 * ONE OWNER. The desk layout in `src/app/cross-source/page.tsx` imports this
 * rather than keeping its own copy. A second implementation of one rule is the
 * shape this repo has paid for at least six times over (see the note in
 * `src/components/mobile/tab-bar-clearance.tsx`), and the phone and the desk
 * must not be able to read one cluster two different ways.
 */
export function formatLag(minutes: number | null): string {
  if (minutes === null) return "unknown";
  if (minutes < 1) return "same minute";
  if (minutes < 60) return `+${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `+${hours.toFixed(1)}h`;
  return `+${(hours / 24).toFixed(1)}d`;
}

/**
 * The word the role pill carries. `lead_tied` is the ordering saying two items
 * share the earliest timestamp, so no lead is named and the pill says so.
 */
export function roleWord(role: string): string {
  if (role === "lead_tied") return "tied";
  return role;
}

/**
 * The outcome split, in the sanctioned vocabulary.
 *
 * The stored columns are the price-attribution grader's own: an outcome counts
 * only when the named entity moved beyond both its sector ETF and SPY in the
 * predicted direction. That is evidence for or against the call, which is
 * supported and challenged, and those are two of the four outcome words this
 * product is allowed to use. The desk layout keeps the column heading it has.
 */
export function outcomeSplit(row: SourceStanding): {
  supported: number;
  challenged: number;
} {
  return { supported: row.n_correct, challenged: row.n_wrong };
}

/**
 * The confidence band's ink. DELIBERATELY MONOCHROME.
 *
 * The desk layout paints the four bands amber, sky and emerald. On a phone,
 * beside a supported / challenged split and nothing else, a green band reads
 * as a verdict on the source rather than as what it is, which is a statement
 * about how many outcomes are behind the row. The scale here is weight and
 * ink only: the more there is to stand on, the darker the word.
 */
export function confidenceInk(confidence: string): string {
  if (confidence === "high") return "var(--c-ink)";
  if (confidence === "moderate") return "var(--c-body)";
  return "var(--c-muted)";
}

/**
 * A clean outcome resolves against a catalyst, so a fortnight between two of
 * them is an ordinary quiet run rather than a broken job.
 */
export const SOURCE_STALE_AFTER_DAYS = 14;

/**
 * A cluster window is a same-event window measured in hours. Three days with
 * no new one means the cross-source pass has not written, not that the news
 * stopped.
 */
export const CLUSTER_STALE_AFTER_DAYS = 3;

/**
 * The newest of a set of timestamps, or null when none of them parses. Nulls
 * and unparseable strings are skipped rather than treated as the epoch, which
 * would report every panel as behind the moment one row lost its date.
 */
export function newestIso(values: readonly (string | null)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = v;
    }
  }
  return best;
}

/**
 * Whether the newest write is further back than `days`.
 *
 * A panel with NOTHING dated is not behind: it is a panel with no dates, and
 * saying "behind" there would be a claim with no source. False, and the empty
 * or ready state speaks instead.
 */
export function isBehind(newest: string | null, now: Date, days: number): boolean {
  if (!newest) return false;
  const ms = Date.parse(newest);
  if (Number.isNaN(ms)) return false;
  return now.getTime() - ms > days * 24 * 60 * 60 * 1000;
}

/** `12 Mar 2026`, or a dash when nothing parses. */
export function shortDate(iso: string | null): string {
  if (!iso) return "unknown";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "unknown";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
