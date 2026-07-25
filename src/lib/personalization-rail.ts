/**
 * personalization-rail.ts - Layer 1 of brief personalization.
 *
 * A PURE, read-time, zero-Gemini per-user reorder of the Today's Stories rail.
 * Two users with the same shared rail get a different ORDER based on their
 * watchlist tickers and followed sectors. Reorder only: never drops, adds, or
 * mutates items. Architecture A holds (no I/O, no model call, no DB write in the
 * reorder itself).
 *
 * Gated by PERSONALIZATION_MODE (three-state, mirrors MATERIALITY_RANK_MODE in
 * backend/synthesize.py):
 *   off    -> applyRailPersonalization returns the input order unchanged
 *             (byte-identical to no-personalization). This is the DEFAULT.
 *   shadow -> the personalized order is computed and a compact id-order diff is
 *             LOGGED, but the ORIGINAL order is returned (served output unchanged,
 *             prod-neutral).
 *   active -> the personalized order is returned.
 *
 * Fail-closed: any error, a missing profile, or an empty rail returns the input
 * order unchanged. This module never throws.
 *
 * NOTE (wiring): the rail is currently reordered client-side in the brief pages
 * via sortByRelevance (src/lib/personalization.ts). This module is the isolated,
 * flag-gated rail scorer; wiring it into the render seam is a follow-up that
 * touches the brief pages (Lucas visual-swept, coordinate) and is intentionally
 * out of scope for this Layer 1 lib PR.
 */
export type PersonalizationMode = "off" | "shadow" | "active";

/** The per-user signals the rail reorder reads. Both fields are optional and
 * nullable; a null/empty profile yields no personalization (fail-closed). */
export interface RailProfile {
  watchlist_tickers?: string[] | null;
  sectors?: string[] | null;
}

/** Minimal structural shape a rail item must satisfy to be scored. Real rail
 * rows (StoryData) carry more fields; only these are read. `adjustedScore` is the
 * base impact/relevance score; when absent the original position is the base. */
export interface RailItem {
  id: string;
  sector?: string | null;
  tags?: string[] | null;
  adjustedScore?: number | null;
}

/** Additive bonus applied when an item names a watchlisted ticker. Larger than
 * the sector bonus: a direct name match is a stronger personal signal. */
export const WATCHLIST_BONUS = 5;
/** Additive bonus applied when an item's sector is one the user follows. */
export const SECTOR_BONUS = 2;

/** Coerce any raw value to a valid mode; anything unrecognized falls back to the
 * prod-neutral "off" (mirrors the MATERIALITY_RANK_MODE unknown-value guard). */
export function resolvePersonalizationMode(raw: string | undefined | null): PersonalizationMode {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "shadow" || v === "active" ? v : "off";
}

/** Read the mode from the environment. Supports a server var and a client
 * (NEXT_PUBLIC_) var so the same flag name works on both sides. Default off. */
export function getPersonalizationMode(): PersonalizationMode {
  const env = typeof process !== "undefined" ? process.env : undefined;
  return resolvePersonalizationMode(
    env?.PERSONALIZATION_MODE ?? env?.NEXT_PUBLIC_PERSONALIZATION_MODE,
  );
}

function normalizeTickers(values: string[] | null | undefined): Set<string> {
  return new Set((values ?? []).map((t) => (t ?? "").trim().toUpperCase()).filter(Boolean));
}

function normalizeSectors(values: string[] | null | undefined): string[] {
  return (values ?? []).map((s) => (s ?? "").trim().toLowerCase()).filter(Boolean);
}

/** True when the item names any of the user's watchlisted tickers. Pure. Exposed
 * so a follow-up can light up matched rows in the UI without re-deriving it. */
export function itemMatchesWatchlist(item: RailItem, profile: RailProfile): boolean {
  const watchlist = normalizeTickers(profile.watchlist_tickers);
  if (watchlist.size === 0) return false;
  return (item.tags ?? []).some((t) => watchlist.has((t ?? "").trim().toUpperCase()));
}

function itemMatchesSector(item: RailItem, sectors: string[]): boolean {
  if (sectors.length === 0) return false;
  const s = (item.sector ?? "").trim().toLowerCase();
  if (!s) return false;
  return sectors.some((ps) => s.includes(ps) || ps.includes(s));
}

/**
 * PURE per-user reorder. score = base (adjustedScore, or a descending value
 * derived from the original index when absent) + watchlist bonus + sector bonus.
 * Stable-sort by score descending, using the original position as an explicit
 * tiebreak so equal-score items keep their shared-rail order across JS engines.
 * Returns a NEW array with the same items, reordered only. Never drops or adds.
 */
export function personalizeRailOrder<T extends RailItem>(items: T[], profile: RailProfile): T[] {
  const sectors = normalizeSectors(profile.sectors);
  const n = items.length;
  const decorated = items.map((item, index) => {
    // Base: prefer the item's own score; else a strictly-descending value from
    // the original position so the shared order is the neutral starting point.
    const base = typeof item.adjustedScore === "number" ? item.adjustedScore : n - index;
    let score = base;
    if (itemMatchesWatchlist(item, profile)) score += WATCHLIST_BONUS;
    if (itemMatchesSector(item, sectors)) score += SECTOR_BONUS;
    return { item, index, score };
  });
  decorated.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return decorated.map((d) => d.item);
}

/** Compact id-order diff for shadow logging: original vs personalized. */
function railOrderDiff(original: RailItem[], personalized: RailItem[]): string {
  return JSON.stringify({
    original: original.map((i) => i.id),
    personalized: personalized.map((i) => i.id),
  });
}

/**
 * Flag-gated entry point. off -> input order unchanged; shadow -> compute +
 * log the diff, return the input order; active -> return the personalized order.
 * Fail-closed: no/empty profile, empty rail, or any thrown error returns the
 * input order unchanged. Never throws.
 *
 * `log` is injectable for testability; defaults to console.log. In shadow it is
 * the only side effect, and it never runs in off/active.
 */
export function applyRailPersonalization<T extends RailItem>(
  items: T[],
  profile: RailProfile | null | undefined,
  mode: PersonalizationMode = getPersonalizationMode(),
  log: (message: string) => void = (m) => console.log(m),
): T[] {
  if (mode === "off") return items;
  if (!items || items.length === 0) return items;
  const hasSignal =
    !!profile &&
    ((profile.watchlist_tickers?.length ?? 0) > 0 || (profile.sectors?.length ?? 0) > 0);
  if (!hasSignal) return items;

  try {
    const personalized = personalizeRailOrder(items, profile as RailProfile);
    if (mode === "shadow") {
      log(`[personalization-rail] shadow ${railOrderDiff(items, personalized)}`);
      return items;
    }
    return personalized;
  } catch (e) {
    // Fail-closed: any error serves the shared rail order unchanged.
    log(`[personalization-rail] error, serving shared order: ${String(e)}`);
    return items;
  }
}
