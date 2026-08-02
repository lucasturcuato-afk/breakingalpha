/**
 * attention-context.ts - the ambient provenance every event on a reading
 * surface should carry.
 *
 * The question this exists to answer: when a user commits to a claim, was that
 * ninety seconds of reading or a reflex tap? That is a fact about the quality
 * of their reasoning, and it is computable only if it is captured at the moment
 * of the action. After the fact there is nothing in the row to recover it from.
 *
 * So a page opens a context (which brief, when), the exposure primitive keeps
 * the last content object in view up to date, and an enricher registered on
 * trackClientEvent folds both onto every event emitted while the context is
 * open. Components that know nothing about attention tracking, including ones
 * being edited in a parallel branch, get provenance without a line of change.
 *
 * Fail-open throughout. Every export swallows its own errors, and the enricher
 * contributes nothing rather than throwing if the context is unset.
 */

import { registerEventEnricher } from "./track-event";

export type EntryPoint = "email" | "deep_link" | "direct" | "internal";

interface PageContext {
  /** entity_id of the surface: the briefing id for a brief page. */
  surfaceId: string;
  /** "briefing" for a brief. Kept generic so other surfaces can reuse this. */
  surfaceType: string;
  /** performance-clock ms at which the surface became readable. */
  openedAt: number;
  /**
   * The horizon the UI offered before the user touched anything. Lets an
   * adoption event record accepted-as-offered vs edited as a fact, rather than
   * leaving it to be re-derived later against a default constant that may have
   * changed in the meantime.
   */
  offeredHorizon?: string | null;
}

interface FocusRecord {
  entityType: string;
  entityId: string | null;
  /** Zero-based rendered position within its list. */
  rank: number | null;
  /** performance-clock ms at which this object came into view. */
  since: number;
}

let pageContext: PageContext | null = null;
/** Last content object of any kind to come into view. */
let lastFocus: FocusRecord | null = null;
/** Last object with entityType === "story". Kept apart so a call card in view
 *  does not erase which story the user had just been reading. */
let lastStory: FocusRecord | null = null;
/**
 * When each object first entered view, keyed `${type}:${id}`.
 *
 * `lastFocus` answers "what was on screen most recently", which is the wrong
 * question when the user taps the third card after the fifth scrolled past. An
 * action knows which object it is about, so it can ask about that one directly.
 * First write wins: the honest reading of "since it entered view".
 */
const objectFirstSeen = new Map<string, number>();
/** Bound on the per-object clock. One reading surface never holds this many. */
const MAX_TRACKED_OBJECTS = 500;

function now(): number {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {
    // fall through
  }
  return Date.now();
}

/** Seconds between two clock readings, one decimal. Null-safe. */
function secondsSince(from: number | null | undefined): number | null {
  if (from === null || from === undefined) return null;
  const delta = (now() - from) / 1000;
  if (!Number.isFinite(delta) || delta < 0) return null;
  return Math.round(delta * 10) / 10;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const ENTRY_POINT_KEY = "ba_entry_point";

/**
 * How the user arrived. Resolved once per tab and cached, because after the
 * first client-side navigation the referrer and the query string no longer say
 * anything about how the session started.
 *
 * "email" wins on an explicit campaign marker. A referrer from another origin
 * is a deep link. Anything else on this origin is internal navigation, and no
 * referrer at all is a direct open.
 */
export function getEntryPoint(): EntryPoint {
  if (typeof window === "undefined") return "direct";
  try {
    const cached = window.sessionStorage.getItem(ENTRY_POINT_KEY);
    if (cached) return cached as EntryPoint;
  } catch {
    // sessionStorage blocked. Resolve fresh every time; still correct on the
    // first read, which is the one that matters.
  }

  let resolved: EntryPoint = "direct";
  try {
    const params = new URLSearchParams(window.location.search);
    const src = (params.get("utm_source") || params.get("src") || "").toLowerCase();
    const medium = (params.get("utm_medium") || "").toLowerCase();
    const ref = document.referrer || "";

    if (src.includes("email") || src === "resend" || medium.includes("email")) {
      resolved = "email";
    } else if (!ref) {
      resolved = "direct";
    } else {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(ref).origin === window.location.origin;
      } catch {
        sameOrigin = false;
      }
      resolved = sameOrigin ? "internal" : "deep_link";
    }
  } catch {
    resolved = "direct";
  }

  try {
    window.sessionStorage.setItem(ENTRY_POINT_KEY, resolved);
  } catch {
    // ignore
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Context lifecycle
// ---------------------------------------------------------------------------

/**
 * Open a reading context. Call once the surface is genuinely readable, not when
 * the request is fired: the elapsed-time numbers are only honest if the clock
 * starts when there was something to read.
 */
export function openAttentionContext(ctx: {
  surfaceId: string;
  surfaceType?: string;
  offeredHorizon?: string | null;
}): void {
  try {
    if (!ctx?.surfaceId) return;
    if (pageContext?.surfaceId === ctx.surfaceId) return;
    pageContext = {
      surfaceId: ctx.surfaceId,
      surfaceType: ctx.surfaceType ?? "briefing",
      openedAt: now(),
      offeredHorizon: ctx.offeredHorizon ?? null,
    };
    lastFocus = null;
    lastStory = null;
    objectFirstSeen.clear();
  } catch {
    // ignore
  }
}

export function closeAttentionContext(): void {
  pageContext = null;
  lastFocus = null;
  lastStory = null;
  objectFirstSeen.clear();
}

/** Seconds since the surface opened, or null when no context is open. */
export function secondsSinceSurfaceOpen(): number | null {
  return secondsSince(pageContext?.openedAt ?? null);
}

/** Record that a content object came into view. Called by the exposure hook. */
export function noteObjectInView(rec: {
  entityType: string;
  entityId: string | null;
  rank?: number | null;
}): void {
  try {
    if (!pageContext) return;
    const focus: FocusRecord = {
      entityType: rec.entityType,
      entityId: rec.entityId ?? null,
      rank: rec.rank ?? null,
      since: now(),
    };
    lastFocus = focus;
    if (rec.entityType === "story") lastStory = focus;
    if (rec.entityId) {
      const key = `${rec.entityType}:${rec.entityId}`;
      if (!objectFirstSeen.has(key) && objectFirstSeen.size < MAX_TRACKED_OBJECTS) {
        objectFirstSeen.set(key, focus.since);
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Seconds since a SPECIFIC object entered view, or null if it never did.
 *
 * An action call site passes the identity it already holds as a prop, so this
 * never depends on which card happened to be on screen last.
 */
export function secondsSinceObjectFirstInView(
  entityType: string,
  entityId: string | null | undefined,
): number | null {
  try {
    if (!entityId) return null;
    return secondsSince(objectFirstSeen.get(`${entityType}:${entityId}`) ?? null);
  } catch {
    return null;
  }
}

/**
 * The provenance block. Exported separately from the enricher so a call site
 * that wants these fields explicitly (or a test) can read them directly.
 */
export function readProvenance(): Record<string, unknown> {
  if (!pageContext) return {};
  const out: Record<string, unknown> = {
    attn_surface_id: pageContext.surfaceId,
    attn_surface_type: pageContext.surfaceType,
    attn_entry_point: getEntryPoint(),
    seconds_since_surface_open: secondsSince(pageContext.openedAt),
  };
  if (pageContext.surfaceType === "briefing") {
    // The name the rest of the codebase already queries brief events by.
    out.briefing_id = pageContext.surfaceId;
  }
  if (lastStory) {
    out.preceding_story_id = lastStory.entityId;
    out.preceding_story_rank = lastStory.rank;
    out.seconds_since_story_in_view = secondsSince(lastStory.since);
  }
  if (lastFocus && lastFocus !== lastStory) {
    out.preceding_object_type = lastFocus.entityType;
    out.preceding_object_id = lastFocus.entityId;
    out.seconds_since_object_in_view = secondsSince(lastFocus.since);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Enricher
// ---------------------------------------------------------------------------

/** Adoption events, whatever surface prefix they carry. */
const ADOPTION_EVENT_RE = /\.call\.(tracked|adopted)$/;

function attentionEnricher(eventType: string): Record<string, unknown> | null {
  if (!pageContext) return null;
  const out = readProvenance();
  if (ADOPTION_EVENT_RE.test(eventType) && pageContext.offeredHorizon) {
    // The value offered before the user touched the control. Paired with the
    // `horizon` the call site records, this is what makes accepted-as-offered
    // vs deliberately-edited a stored fact instead of a later guess.
    out.horizon_offered = pageContext.offeredHorizon;
  }
  return out;
}

let installed = false;

/**
 * Install the enricher. Idempotent, safe to call from any client component.
 * Deliberately not auto-run on import: a module-load side effect would fire
 * during SSR bundling too.
 */
export function installAttentionEnricher(): void {
  if (installed) return;
  installed = true;
  try {
    registerEventEnricher(attentionEnricher);
  } catch {
    installed = false;
  }
}
