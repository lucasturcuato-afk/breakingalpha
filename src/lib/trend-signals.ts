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
  /* Read only so `trendTitle` can reproduce the protected route's middle two
     fallback branches. Nothing on the card renders it directly. */
  top_companies: string[];
  created_at: string | null;
}

/**
 * The select list and the fetch predicate, verbatim from the protected route
 * (`:452-457`). These are not a preference. They define which clusters count
 * as worth showing, so the two surfaces have to agree or "N active" means two
 * different things on two screens of the same product.
 */
export const TREND_SELECT =
  "id, label, headline, tagline, article_count, source_count, strength_score, top_themes, top_sectors, top_companies, created_at";
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
  if (Number.isNaN(new Date(dateStr).getTime())) return "";
  /* Floored at zero. `now` is the reader's clock and `dateStr` is the
     server's; a phone running a few minutes behind would otherwise render
     "-3m ago" on a cluster written seconds ago. */
  const diff = Math.max(0, now - new Date(dateStr).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Card title, reproducing all four branches of the protected route's
 * `getDisplayTitle` (`src/app/trends/page.tsx:134-147`) in order: the headline,
 * then a theme-and-company phrase, then a theme-only phrase, then the label.
 *
 * An earlier version of this function implemented the first and last branches
 * only, and described the last one as the whole fallback. That was wrong twice
 * over. It also diverged: a cluster with no headline but with a theme and a
 * company read as its raw label here and as a composed phrase on the desktop
 * route, on the same rows, which is exactly the drift this module exists to
 * prevent. The middle branches need `top_companies`, so `TREND_SELECT` fetches
 * it now.
 *
 * ONE DELIBERATE DIFFERENCE, in the last branch only. The route joins the
 * label's colons on a space-padded U+2014. That em dash is user-facing copy,
 * which the handoff README forbids outright, so this joins on a comma. Branches
 * one to three are character-for-character identical to the route's.
 */
export function trendTitle(signal: TrendSignal): string {
  if (signal.headline) return signal.headline;

  const themes = signal.top_themes.filter((t) => t.length > 1);
  const companies = signal.top_companies.map((c) =>
    c
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" "),
  );

  if (themes.length > 0 && companies.length > 0) {
    return `${upperFirst(themes[0])} Activity Around ${companies[0]}`;
  }
  if (themes.length > 0) return `${upperFirst(themes[0])} Trend Detected`;
  return signal.label.replace(/:\s*/g, ", ");
}

/** Capitalise the first character and leave the rest alone, as the route does. */
function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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

/**
 * The lens values the chip row offers.
 *
 * Every severity `strengthToLevel` can return is a member, plus "all" and the
 * profile lens. That is not a style choice. The four severity chips are the
 * control set over the level taxonomy this screen renders on every card, so a
 * missing member is a level the reader can read off a badge and cannot find
 * above, and the chips stop summing to the total.
 *
 * "low" was the missing one: `strengthToLevel` has returned it since day one
 * for anything under 0.4, `LEVEL_TONES.low` draws it, and the card prints the
 * word, while the chip row offered three tiers against a total that counted
 * four. Adding the member is what makes `Critical + High + Medium + Low` equal
 * `All` again.
 */
export type TrendLens = "all" | "critical" | "high" | "medium" | "low" | "mine";

/**
 * The counts the chip row and the subhead render.
 *
 * Every figure on this screen is derived here and never typed. The prototype
 * writes "All 34", "Critical 2", "High 5", "Medium 11" as literals in markup,
 * which the README's State section forbids ("Any figure that describes state
 * must be read from that state, never typed").
 *
 * All four severities are counted, so the four tier figures sum to `total`.
 * They did not before: `low` went uncounted while `total` stayed
 * `signals.length`, so the chip row read "All 462 / Critical 109 / High 17 /
 * Medium 302" and left 34 clusters with no chip, each one printing the word
 * "Low" on its own card. Every level `strengthToLevel` returns gets a counter
 * here, and the tally is keyed by the level type so the compiler enforces it.
 *
 * `newThisWeek` counts clusters created inside seven days. The prototype's
 * subhead says "3 moved this week"; `trend_clusters` has no field for movement
 * of any kind, so the word is changed to one the data can carry.
 */
export function trendCounts(signals: TrendSignal[], now: number = Date.now()) {
  const week = now - 7 * 24 * 60 * 60 * 1000;
  /* Keyed by the level type rather than four loose counters, so the tally is
     exhaustive by construction: a fifth member on `AnomalyLevel` fails to
     compile here instead of going uncounted, which is precisely how `low` was
     lost. */
  const byLevel: Record<AnomalyLevel, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let newThisWeek = 0;
  for (const s of signals) {
    byLevel[strengthToLevel(s.strength_score)] += 1;
    if (s.created_at && new Date(s.created_at).getTime() >= week) newThisWeek += 1;
  }
  return { total: signals.length, ...byLevel, newThisWeek };
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
