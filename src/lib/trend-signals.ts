/**
 * Trend cluster derivations, in one place.
 *
 * `src/app/trends/page.tsx` is a propose-only file under CLAUDE.md and is
 * never edited by the mobile build. Everything the mobile Trends screen needs
 * from it is pure, so it is re-derived here rather than imported: the row
 * shape, the fetch predicate, the level derivation and the relative clock.
 * Nothing in this module imports that route, and that route does not import
 * this module, so there is no edge in either direction.
 *
 * The one exception is the LEVEL TYPE. `AnomalyLevel` is exported from
 * `src/components/trends/anomaly-badge.tsx`, and while the component beside it
 * is dead code with no consumer, the type is live: the protected route imports
 * it at :15, narrows it at :61 and produces it at :128. Re-declaring the union
 * here would give the level two definitions that could drift, so this module
 * re-exports the existing one. The type is the single home; the badge is not.
 *
 * Batch-9's "How Trends lands without editing src/app/trends/page.tsx" and
 * batch-6's equivalent section both call for exactly one home for the level
 * derivation. This is it. The Signal detail screen imports from here when it
 * is built; it does not make a second copy.
 */

export type { AnomalyLevel } from "@/components/trends/anomaly-badge";
import type { AnomalyLevel } from "@/components/trends/anomaly-badge";

/**
 * The `trend_clusters` columns the mobile list reads.
 *
 * Re-declared from `src/app/trends/page.tsx:41-59` rather than imported. The
 * desktop route selects seventeen columns for a modal this screen does not
 * have; the fields below are the subset the mobile card renders or filters on,
 * against the same table.
 */
export interface TrendSignal {
  id: string;
  label: string;
  headline: string | null;
  tagline: string | null;
  article_count: number;
  source_count: number;
  strength_score: number;
  top_themes: string[];
  top_sectors: string[];
  created_at: string | null;
}

/**
 * The select list and the fetch predicate, verbatim from the protected route
 * (`:452-457`). These are not a preference. They define which clusters count
 * as worth showing, so the two surfaces have to agree or "N active" means two
 * different things on two screens of the same product.
 */
export const TREND_SELECT =
  "id, label, headline, tagline, article_count, source_count, strength_score, top_themes, top_sectors, created_at";
export const TREND_MIN_ARTICLES = 3;
export const TREND_MIN_SOURCES = 2;
export const TREND_LIMIT = 500;

/**
 * Level from strength. Cutoffs 0.8 / 0.6 / 0.4, matching
 * `strengthToAnomaly` at `src/app/trends/page.tsx:128-133`.
 */
export function strengthToLevel(score: number): AnomalyLevel {
  if (score >= 0.8) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

/**
 * Relative clock, matching `timeAgo` at `src/app/trends/page.tsx:87-95`, which
 * is also the exact shape the prototype draws at `:2145`, `:2164` and `:2182`.
 * `now` is a parameter so the caller owns the clock and a test does not need
 * one.
 */
export function timeAgo(dateStr: string | null, now: number = Date.now()): string {
  if (!dateStr) return "";
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Card title. The protected route's `getDisplayTitle` (`:146`) falls back to
 * the raw label with its colons swapped for a space-padded U+2014. That em
 * dash is user-facing copy, which the handoff README forbids outright, so the
 * fallback here joins on a comma instead. Recorded as a copy change rather
 * than reproduced.
 */
export function trendTitle(signal: TrendSignal): string {
  if (signal.headline) return signal.headline;
  return signal.label.replace(/:\s*/g, ", ");
}

/**
 * Up to three tag chips per card, matching the prototype's row at
 * `:2148-2150`: sector first, then themes, deduplicated case-insensitively.
 * Read from the row, never authored.
 */
export function trendTags(signal: TrendSignal, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...signal.top_sectors, ...signal.top_themes]) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value.charAt(0).toUpperCase() + value.slice(1));
    if (out.length === max) break;
  }
  return out;
}

export type TrendLens = "all" | "critical" | "high" | "medium" | "mine";

/**
 * The counts the chip row and the subhead render.
 *
 * Every figure on this screen is derived here and never typed. The prototype
 * writes "All 34", "Critical 2", "High 5", "Medium 11" as literals in markup,
 * which the README's State section forbids ("Any figure that describes state
 * must be read from that state, never typed").
 *
 * `newThisWeek` counts clusters created inside seven days. The prototype's
 * subhead says "3 moved this week"; `trend_clusters` has no field for movement
 * of any kind, so the word is changed to one the data can carry.
 */
export function trendCounts(signals: TrendSignal[], now: number = Date.now()) {
  const week = now - 7 * 24 * 60 * 60 * 1000;
  let critical = 0;
  let high = 0;
  let medium = 0;
  let newThisWeek = 0;
  for (const s of signals) {
    const level = strengthToLevel(s.strength_score);
    if (level === "critical") critical += 1;
    else if (level === "high") high += 1;
    else if (level === "medium") medium += 1;
    if (s.created_at && new Date(s.created_at).getTime() >= week) newThisWeek += 1;
  }
  return { total: signals.length, critical, high, medium, newThisWeek };
}

/**
 * The lens. One exclusive value, matching the prototype's `trLens` at
 * `:3143-3150`, where "My sectors" replaces the severity choice rather than
 * composing with it. The desktop route models the same control as an
 * independent boolean; the two disagree and the design wins on the surface the
 * design draws (batch-9 deviation 18).
 *
 * `sectors` is the reader's own profile sectors, lowercased. With none set the
 * "mine" lens matches nothing, which the screen states as its own empty state
 * rather than silently falling back to everything.
 */
export function applyLens(
  signals: TrendSignal[],
  lens: TrendLens,
  sectors: string[],
): TrendSignal[] {
  if (lens === "all") return signals;
  if (lens === "mine") {
    if (sectors.length === 0) return [];
    return signals.filter((s) =>
      s.top_sectors.some((ts) => {
        const t = ts.toLowerCase();
        return sectors.some((ps) => t.includes(ps) || ps.includes(t));
      }),
    );
  }
  return signals.filter((s) => strengthToLevel(s.strength_score) === lens);
}

/**
 * Freshness, derived rather than stamped. The newest cluster's age in whole
 * hours, or null when the list is empty or carries no date.
 *
 * The design specifies no stale treatment for Trends at all, so the floor
 * below is this screen's own rather than a ported one. 48 hours, not 24: the
 * pipeline runs daily, so measured against production the newest cluster is
 * routinely a little over a day old and a 24 hour floor fires on a healthy
 * list. Two days means a run was missed, which is worth saying.
 */
export const TREND_STALE_AFTER_HOURS = 48;

export function newestAgeHours(signals: TrendSignal[], now: number = Date.now()): number | null {
  let newest: number | null = null;
  for (const s of signals) {
    if (!s.created_at) continue;
    const t = new Date(s.created_at).getTime();
    if (Number.isNaN(t)) continue;
    if (newest === null || t > newest) newest = t;
  }
  if (newest === null) return null;
  return Math.floor((now - newest) / 3600000);
}
