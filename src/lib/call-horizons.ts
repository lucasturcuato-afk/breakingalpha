/**
 * call-horizons.ts - shared resolution-horizon vocabulary for the frontend.
 *
 * Mirrors backend/call_horizons.py. The backend map decides what a brief call's
 * resolve_on is at creation; this module decides what a user's adopted window
 * is, and how any horizon renders. The three buckets the Python extractor emits
 * (session/week/multiweek) carry identical day counts on both sides, so a chip
 * on a brief call and a chip on an adopted claim mean the same thing. This
 * module additionally offers longer adopt-only windows; see HORIZON_DAYS.
 *
 * Everything here is pure: no fetch, no React, no DOM. Importable from a route
 * handler, a client component, and a test.
 */

export type HorizonType = "session" | "week" | "multiweek" | "month" | "quarter";

/**
 * Calendar days added to the anchor date.
 *
 * session/week/multiweek MUST match HORIZON_DAYS in backend/call_horizons.py:
 * those three are the vocabulary the Python claims extractor emits when it
 * sets a brief call's resolve_on.
 *
 * month/quarter are FRONTEND-ONLY adopt/author windows. The adopt route
 * (src/app/api/radar/claims/adopt/route.ts) resolves windows through this
 * module, not through Python, so a longer bucket needs no backend change. A
 * real thesis can be long-dated, and forcing "three weeks" onto a structural
 * call is the same category error as grading a thesis on one afternoon's
 * close. quarter lands exactly on MAX_WINDOW_DAYS, the server-enforced clamp.
 *
 * GRADING SUPPORT VERIFIED, not assumed. backend/grading/price_attribution.py
 * fetches Tiingo daily bars over an arbitrary range (no cap), counts real
 * sessions, and scales the attribution bars by sqrt(sessions), so a quarter's
 * single-stock excess bar rises from 0.75% to about 5.95%. Prices are ADJUSTED
 * (adjOpen/adjClose in backend/market_data.py), so splits and dividends cannot
 * corrupt a multi-month comparison.
 */
export const HORIZON_DAYS: Record<HorizonType, number> = {
  session: 0,
  week: 7,
  multiweek: 21,
  month: 30,
  quarter: 90,
};

export const HORIZON_TYPES: HorizonType[] = [
  "session",
  "week",
  "multiweek",
  "month",
  "quarter",
];

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
  month: "1 month",
  quarter: "1 quarter",
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
  month: "resolves in about a month",
  quarter: "resolves in about a quarter",
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
  if (days >= 75) return "resolves in about a quarter";
  if (days >= 28 && days <= 31) return "resolves in about a month";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "resolves in about a week" : `resolves in about ${weeks} weeks`;
  }
  return `resolves in ${days} days`;
}

/**
 * When a STORED window resolves, said relative to the reader's today.
 *
 * horizonPhraseForDays takes a DURATION and horizonPhraseForDays is correct for
 * one job: a selector, where the reader is choosing a length and "resolves in
 * about a week" means seven days from the tap. It is wrong for a window that
 * already exists, because its vocabulary is deictic. "Tomorrow" and "one day
 * long" are the same thing only on the day the window opened.
 *
 * The live defect: a claim logged 2026-08-01 resolving 2026-08-02 has a one-day
 * span, so a card read on 2026-08-02 said "resolves tomorrow" about a window
 * closing that same day. Nothing in the path consulted today's date at all.
 *
 * So this one takes the END DATE and today, never a span. `todayIso` must be
 * the reader's session date; pass it in rather than reading a clock here, so
 * the function stays pure and a server render cannot disagree with the client.
 *
 * Returns null when there is no date to speak about, so a caller renders
 * nothing rather than a wrong phrase.
 */
export function resolutionPhrase(
  resolveOnIso: string | null | undefined,
  todayIso: string | null | undefined,
): string | null {
  if (!resolveOnIso || !todayIso) return null;
  const days = daysBetween(todayIso, resolveOnIso);
  if (days === null) return null;
  if (days < 0) return "resolved";
  if (days === 0) return "resolves at today's close";
  if (days === 1) return "resolves tomorrow";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "resolves in about a week" : `resolves in about ${weeks} weeks`;
  }
  return `resolves in ${days} days`;
}

/**
 * The date a claim was logged, as it can honestly be shown.
 *
 * A log date is a fact about the past and can never be in the future. The live
 * data has some anyway: /api/radar/claims/adopt stamps the window with
 * `new Date().toISOString().slice(0, 10)`, which is UTC, while every other date
 * in the product is the US-Pacific session date. Between 17:00 and 24:00 PT,
 * UTC has already rolled over, so a claim adopted at 20:22 PT on 2026-08-02 was
 * written with resolution_window_start 2026-08-03 and rendered a log date one
 * day in the reader's future.
 *
 * The real repair is in the write path, which is out of scope here. This is the
 * display-side containment: a stored start ahead of today is a frame artifact,
 * and the session date the reader is actually in is the closest honest value.
 * Clamping only ever moves the date backwards, so a correctly stamped claim is
 * returned untouched.
 */
export function displayLoggedDate(
  windowStartIso: string | null | undefined,
  todayIso: string | null | undefined,
): string | null {
  const start = windowStartIso ? windowStartIso.slice(0, 10) : null;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const today = todayIso ? todayIso.slice(0, 10) : null;
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return start;
  return start > today ? today : start;
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
 * horizonTypeFromDates returns null for any span that is not exactly one of the
 * named bucket day counts. Before variable horizons that was harmless: no call had any other
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
 * entry, so a genuine 7-day call shows one option per bucket and no duplicate. A call with
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
 * is off-bucket, then every named alternative.
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

/**
 * The day count a window spans.
 *
 * The commit sheet draws its date line from this and the adopt route resolves
 * the stored window from `resolveAdoptWindow`; both live here so the sentence
 * a reader agrees to and the row that is written cannot come apart. That is
 * the promise `src/components/commit/commit-target.ts` makes in prose, and
 * `call-horizons.test.ts` asserts it over every horizon.
 */
export function adoptWindowDays(w: AdoptWindow): number {
  return w.kind === "as-called" ? w.days : HORIZON_DAYS[w.type];
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

/**
 * How much of a stored window has elapsed, 0 to 1, for a progress ring or bar.
 *
 * A SAME-SESSION WINDOW HAS NO SPAN TO DIVIDE BY: it opens and closes on one
 * date, which is what "resolves at today's close" means. The caller this was
 * lifted out of answered 1 for that case, so a window that had not run yet drew
 * a completed ring. Unreachable while resolveAdoptWindow floored every window
 * at one day forward; removing that floor is what exposes it.
 *
 * On the session's own date the window is live and nothing of it has measurably
 * elapsed, so this is 0. Once that date is behind the reader it is 1. No
 * fraction is invented in between: there is no intraday clock here, only
 * session dates.
 *
 * 0 when any of the three dates is absent or unparseable, so a caller draws an
 * empty ring rather than a wrong one.
 */
export function windowElapsed(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  todayIso: string | null | undefined,
): number {
  if (!startIso || !endIso || !todayIso) return 0;
  const start = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endIso.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(now)) return 0;
  if (end <= start) return now > end ? 1 : 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
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
 * number, capped at MAX_WINDOW_DAYS. Otherwise the horizon bucket decides, and
 * the session bucket is a ZERO-day window: it opens and closes on the same
 * session, which is exactly what the sheet already tells the reader when it
 * says "resolves at today's close".
 *
 * THE ONE-DAY FLOOR THAT USED TO SIT HERE WAS THE DEFECT. It made the sheet
 * and the stored row disagree about a single commitment: the reader agreed to
 * today's close, the row was written for tomorrow, and the card read that back
 * as "resolves tomorrow". Three strings, one claim.
 *
 * A zero-day window grades. backend/grading/price_attribution.py's
 * `_grading_window` collapses an equal window_start onto window_end and grades
 * that one session open to close, the same branch every brief call already
 * takes, with `candle_count: 1` and no bar scaling. The floor was introduced
 * beside a backdated anchor and a fixed `gradeable: false`; both of those were
 * repaired on their own, and the floor was the only part still doing harm.
 *
 * A zero-day window also makes `windowEnd > todayIso` false, which is why
 * /api/radar/claims/adopt compares with `>=`. Change one of the two without
 * the other and every same-session adopt is written ungradeable and nothing
 * ever closes it.
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
  // Floor of ZERO, ceiling unchanged. The ceiling is a separate rule (the
  // server-enforced MAX_WINDOW_DAYS) and is not what was lying to the reader.
  days = Math.min(Math.max(days, 0), MAX_WINDOW_DAYS);
  return addCalendarDays(todayIso, days);
}

/** The fields the adopt gradeability rule reads off a brief call. */
export interface AdoptGradeableCall {
  target_symbol?: unknown;
  expected_direction?: unknown;
  claim_type?: unknown;
}

/**
 * Whether an adopted claim can be price-graded. THE rule, not a copy of it.
 *
 * /api/radar/claims/adopt calls this and nothing else, so there is no second
 * implementation to drift from. It used to be inline in the route, and
 * call-horizons.test.ts carried a hand-written mirror of it under a comment
 * claiming to be "the exact predicate the route applies". The mirror went stale
 * the moment the route's compare changed, and the suite stayed green because
 * its cases only exercised `week`. That is the exact failure this PR exists to
 * close, so the mirror is deleted rather than repaired.
 *
 * `windowEndIso >= todayIso`, not `>`. A same-session adopt is a real claim:
 * the window opens and closes on today's session and the grader resolves it
 * open to close. See resolveAdoptWindow for why, and for what a strict compare
 * costs.
 *
 * The AUTHORING path (claims/route.ts, author/route.ts) deliberately keeps a
 * strict compare and does NOT call this. Its prompt requires a window end
 * strictly after today and compose-data.ts filters `session` out of the offered
 * set, so a zero-day window is unreachable there. Widening it would be a
 * different decision than this one.
 */
export function isAdoptGradeable(
  call: AdoptGradeableCall,
  todayIso: string,
  windowEndIso: string,
): boolean {
  const symbol = typeof call.target_symbol === "string" ? call.target_symbol.trim() : "";
  if (!symbol) return false;
  if (!call.expected_direction) return false;
  if (!isPriceableClaimType(call.claim_type)) return false;
  if (windowEndIso < todayIso) return false;
  const span = daysBetween(todayIso, windowEndIso);
  if (span === null || span > MAX_WINDOW_DAYS) return false;
  return true;
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
  if (days >= 75) return "1 quarter";
  if (days >= 28 && days <= 31) return "1 month";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  return `${days} days`;
}
