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

/**
 * The same horizon said in words.
 *
 * "3 weeks" in a monospace chip reads as a system token, which is the wrong
 * register for the thing a reader is deciding to commit to. Monospace is
 * reserved for the ledger line, where it signals a record entry. Everywhere a
 * horizon is being CHOSEN or previewed, it reads as a sentence fragment.
 *
 * Presentation only: no arithmetic here, and the day counts in HORIZON_DAYS are
 * untouched.
 */
export const HORIZON_PHRASE: Record<HorizonType, string> = {
  session: "resolves at today's close",
  week: "resolves in about a week",
  multiweek: "resolves in about three weeks",
};

/**
 * Plain-language phrase for an arbitrary day count, mirroring
 * horizonLabelForDays. A custom window states its real length rather than being
 * rounded into a named bucket.
 */
export function horizonPhraseForDays(days: number): string {
  if (days <= 0) return HORIZON_PHRASE.session;
  for (const t of HORIZON_TYPES) {
    if (HORIZON_DAYS[t] === days) return HORIZON_PHRASE[t];
  }
  if (days === 1) return "resolves tomorrow";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "resolves in about a week" : `resolves in about ${weeks} weeks`;
  }
  return `resolves in ${days} days`;
}

/**
 * The bucket a stored window falls in, so a card's selector can DEFAULT to the
 * call's own horizon instead of offering one week on every card. Exact matches
 * only; anything else returns null and the caller keeps its own default rather
 * than snapping a custom window into a bucket it is not.
 */
export function horizonTypeFromDates(
  anchorIso: string | null | undefined,
  resolveOnIso: string | null | undefined,
): HorizonType | null {
  if (!anchorIso || !resolveOnIso) return null;
  const days = daysBetween(anchorIso, resolveOnIso);
  if (days === null || days < 0) return null;
  for (const t of HORIZON_TYPES) {
    if (HORIZON_DAYS[t] === days) return t;
  }
  return null;
}

/**
 * The window a card's selector is currently set to.
 *
 * horizonTypeFromDates returns null for any span that is not exactly 0, 7, or
 * 21 days. Before variable horizons that was harmless: no call had any other
 * span. The moment a call can resolve in 13 days, every caller that fell back
 * to DEFAULT_ADOPT_HORIZON on null would silently offer "1 week" for a call
 * that is not a week, which is precisely the defect #535 shipped to fix.
 *
 * So the selection is a union, not a bucket. "as-called" carries the call's own
 * day count and is what an off-bucket call preselects; "bucket" is one of the
 * three named alternatives a reader may pick instead. There is no date picker:
 * a calendar widget asks the reader to do arithmetic at the exact moment they
 * are deciding whether to put their name on a claim.
 */
export type AdoptWindow =
  | { kind: "as-called"; days: number }
  | { kind: "bucket"; type: HorizonType };

/**
 * The window a card should preselect: the call's OWN span whenever it has one.
 *
 * An exact bucket match returns that bucket rather than a duplicate "as-called"
 * entry, so a genuine 7-day call shows three options and not four. A call with
 * no resolve_on (every row written before migration 0014) has no span to
 * preselect and falls back to the shared default.
 */
export function adoptWindowForCall(
  anchorIso: string | null | undefined,
  resolveOnIso: string | null | undefined,
): AdoptWindow {
  const bucket = horizonTypeFromDates(anchorIso, resolveOnIso);
  if (bucket) return { kind: "bucket", type: bucket };
  const h = horizonFromDates(anchorIso, resolveOnIso);
  if (h && h.days >= 0 && h.days <= MAX_WINDOW_DAYS) {
    return { kind: "as-called", days: h.days };
  }
  return { kind: "bucket", type: DEFAULT_ADOPT_HORIZON };
}

/** One entry in the selector: a stable value, the label, and the span. */
export interface AdoptWindowOption {
  value: string;
  label: string;
  window: AdoptWindow;
}

/**
 * What the selector offers. The call's own window first and preselected when it
 * is off-bucket, then the three named alternatives.
 */
export function adoptWindowOptions(current: AdoptWindow): AdoptWindowOption[] {
  const options: AdoptWindowOption[] = [];
  if (current.kind === "as-called") {
    options.push({
      value: `as-called:${current.days}`,
      // The existing phrase formatter already states the real number for an
      // off-bucket span ("resolves in 13 days"). No new copy function.
      label: `${horizonPhraseForDays(current.days)} (as called)`,
      window: current,
    });
  }
  for (const t of HORIZON_TYPES) {
    options.push({ value: `bucket:${t}`, label: HORIZON_PHRASE[t], window: { kind: "bucket", type: t } });
  }
  return options;
}

/** The stable select value for a window. Pairs with adoptWindowOptions. */
export function adoptWindowValue(w: AdoptWindow): string {
  return w.kind === "as-called" ? `as-called:${w.days}` : `bucket:${w.type}`;
}

/**
 * The window said in words, for the default-shown-as-text presentation.
 *
 * The horizon is SYSTEM-inferred (a call's own resolve_on, set at creation by
 * the claims extractor's per-claim day count), so the reader is told what it
 * is rather than asked to pick one. The selector still exists behind a
 * "change" affordance for anyone who wants a different window.
 */
export function adoptWindowPhrase(w: AdoptWindow): string {
  return w.kind === "as-called"
    ? horizonPhraseForDays(w.days)
    : HORIZON_PHRASE[w.type];
}

/**
 * The adopt-route body for a window.
 *
 * /api/radar/claims/adopt already accepts an arbitrary `window_days` alongside
 * `horizon` (see resolveAdoptWindow's explicitDays), so an off-bucket window
 * needs no API change: it sends the count and a horizon that is only a fallback
 * if the count is ever dropped.
 */
export function adoptWindowRequest(w: AdoptWindow): {
  horizon: HorizonType;
  window_days?: number;
} {
  if (w.kind === "bucket") return { horizon: w.type };
  return { horizon: DEFAULT_ADOPT_HORIZON, window_days: w.days };
}

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
