/**
 * call-horizons.ts - shared resolution-horizon vocabulary for the frontend.
 *
 * Mirrors backend/call_horizons.py. The backend map decides what a brief call's
 * resolve_on is at creation; this module decides what a user's adopted window
 * is, and how any horizon renders. Both use the same three buckets and the same
 * day counts so a chip on a brief call and a chip on an adopted claim mean the
 * same thing.
 *
 * Everything here is pure: no fetch, no React, no DOM. Importable from a route
 * handler, a client component, and a test.
 */

export type HorizonType = "session" | "week" | "multiweek";

/** Calendar days added to the anchor date. Must match HORIZON_DAYS in backend/call_horizons.py. */
export const HORIZON_DAYS: Record<HorizonType, number> = {
  session: 0,
  week: 7,
  multiweek: 21,
};

export const HORIZON_TYPES: HorizonType[] = ["session", "week", "multiweek"];

/** Ceiling on any user-chosen window. Matches MAX_WINDOW_DAYS in claims/author/route.ts. */
export const MAX_WINDOW_DAYS = 90;

/**
 * Adopting defaults to a week, not a session. A user tapping "track this" is
 * taking a forward view; a same-day window would resolve before they looked
 * again, which is the behavior this whole change exists to fix.
 */
export const DEFAULT_ADOPT_HORIZON: HorizonType = "week";

/** Short label for the chip. */
export const HORIZON_LABEL: Record<HorizonType, string> = {
  session: "Same session",
  week: "1 week",
  multiweek: "3 weeks",
};

export function isHorizonType(v: unknown): v is HorizonType {
  return typeof v === "string" && (HORIZON_TYPES as string[]).includes(v);
}

export function normalizeAdoptHorizon(raw: unknown, fallback: HorizonType): HorizonType {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim().toLowerCase();
  return isHorizonType(v) ? v : fallback;
}

/** ISO date + n calendar days, as an ISO date. UTC arithmetic, no local drift. */
export function addCalendarDays(isoDate: string, days: number): string {
  const t = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return isoDate.slice(0, 10);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole calendar days between two ISO dates (b - a). Negative if b precedes a. */
export function daysBetween(aIso: string, bIso: string): number | null {
  const a = Date.parse(`${aIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${bIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The window end for an adopted claim.
 *
 * `explicitDays` (an optional raw override) wins when it is a positive finite
 * number; it is clamped to [1, MAX_WINDOW_DAYS]. Otherwise the horizon bucket
 * decides. A session bucket still yields at least one day forward, because a
 * zero-length adopted window is precisely the bug being fixed: a claim that can
 * never stay open.
 */
export function resolveAdoptWindow(
  todayIso: string,
  horizon: HorizonType,
  explicitDays?: unknown,
): string {
  let days = HORIZON_DAYS[horizon];
  if (typeof explicitDays === "number" && Number.isFinite(explicitDays) && explicitDays > 0) {
    days = Math.floor(explicitDays);
  }
  days = Math.min(Math.max(days, 1), MAX_WINDOW_DAYS);
  return addCalendarDays(todayIso, days);
}

/** Claim types the price-attribution grader can actually resolve. */
export function isPriceableClaimType(claimType: unknown): boolean {
  return claimType === "ticker" || claimType === "sector" || claimType === "index";
}

/**
 * Derive the horizon of a call from its dates. NEVER hardcode a chip label:
 * a call's horizon is whatever its stored resolve_on says, so a map change or
 * a user-chosen window renders correctly without touching the UI.
 *
 * Returns null when there is no resolve_on to derive from (every call written
 * before migration 0014), so the chip is simply absent rather than lying.
 */
export function horizonFromDates(
  anchorIso: string | null | undefined,
  resolveOnIso: string | null | undefined,
): { days: number; label: string } | null {
  if (!anchorIso || !resolveOnIso) return null;
  const days = daysBetween(anchorIso, resolveOnIso);
  if (days === null || days < 0) return null;
  return { days, label: horizonLabelForDays(days) };
}

/**
 * Label for an arbitrary day count. Snaps to the named buckets when it matches
 * one exactly, otherwise states the real number, so a custom 12-day window
 * reads honestly instead of being rounded into "3 weeks".
 */
export function horizonLabelForDays(days: number): string {
  if (days <= 0) return HORIZON_LABEL.session;
  for (const t of HORIZON_TYPES) {
    if (HORIZON_DAYS[t] === days) return HORIZON_LABEL[t];
  }
  if (days === 1) return "1 day";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  return `${days} days`;
}
