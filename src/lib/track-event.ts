/**
 * track-event.ts - client-side helper for behavioral event telemetry.
 *
 * Queues events in memory and flushes a batched POST to /api/user-events on a
 * 3s interval, on pagehide, and on visibilitychange->hidden (the one that
 * actually fires on mobile Safari). The server-side handler soft-fails when a
 * column or the table is missing, so this is safe to call from any client
 * component.
 *
 * Fail-open is the hard contract: nothing here throws, awaits, or blocks a
 * render. Every public entry point is wrapped in try/catch, the flush is
 * fire-and-forget, and a full queue drops the oldest event rather than growing
 * without bound. Losing telemetry is acceptable. Breaking a render is not.
 *
 * Event naming: new events use surface.object.action (see EVENT_NAME_RE in
 * src/app/api/user-events/route.ts). The 12 legacy snake_case names still
 * validate and still write the same event_type value, so the five live
 * consumers of user_events keep working unchanged.
 */

/** The 12 legacy event names. Still accepted; prefer surface.object.action. */
export type ClientEventType =
  | "thesis_viewed"
  | "thesis_dismissed"
  | "thesis_approved"
  | "memo_generated"
  | "morning_brief_opened"
  | "evening_wrap_opened"
  | "pattern_clicked"
  | "watchlist_added"
  | "watchlist_removed"
  | "sector_filter_applied"
  | "onboarding_completed"
  | "brief_section_rated";

/** A legacy name, or a three-segment surface.object.action name. */
export type ClientEventName =
  | ClientEventType
  | `${string}.${string}.${string}`;

export interface TrackOptions {
  /** Entity class the event is about: "briefing", "story", "thesis", "ticker". */
  entity_type?: string;
  /** Entity key. Free text, not necessarily a uuid (tickers, section keys). */
  entity_id?: string;
  /**
   * Flush immediately instead of waiting for the interval. Use for moat events
   * (call authored, call adopted, thesis tracked) where a dropped event
   * corrupts the dataset rather than just adding noise.
   */
  immediate?: boolean;
}

interface QueuedEvent {
  event_type: string;
  payload: Record<string, unknown>;
  session_id: string | null;
  entity_type?: string;
  entity_id?: string;
  client_ts: string;
}

const ENDPOINT = "/api/user-events";
const FLUSH_INTERVAL_MS = 3000;
/** Matches the server-side batch cap in the route handler. */
const MAX_BATCH = 50;
/** Hard ceiling on the in-memory queue. Oldest events are dropped past this. */
const MAX_QUEUE = 200;
const SESSION_STORAGE_KEY = "ba_telemetry_session_id";

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersBound = false;

// ---------------------------------------------------------------------------
// Session id
// ---------------------------------------------------------------------------

let cachedSessionId: string | null = null;

function randomId(): string {
  // crypto.randomUUID is undefined on non-secure origins and in older Safari.
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  // Not cryptographically meaningful, and it does not need to be. This id only
  // groups events within one tab.
  return `s-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Per-tab, stable for the life of the tab. sessionStorage (not localStorage)
 * so it never joins activity across tabs or survives a close, and never
 * becomes a cross-session identifier. Throws in some privacy modes, hence the
 * try/catch and the in-memory fallback.
 */
export function getSessionId(): string | null {
  if (cachedSessionId) return cachedSessionId;
  if (typeof window === "undefined") return null;
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      cachedSessionId = existing;
      return cachedSessionId;
    }
    const fresh = randomId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);
    cachedSessionId = fresh;
    return cachedSessionId;
  } catch {
    // sessionStorage blocked. Keep an in-memory id so batching still groups.
    cachedSessionId = cachedSessionId || randomId();
    return cachedSessionId;
  }
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

/**
 * Send whatever is queued. `useBeacon` switches to navigator.sendBeacon, which
 * is the only transport guaranteed to survive page teardown.
 */
function flush(useBeacon = false): void {
  try {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (queue.length === 0) return;

    const batch = queue.slice(0, MAX_BATCH);
    queue = queue.slice(MAX_BATCH);

    const body = JSON.stringify(batch);

    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      } catch {
        // Beacon refused (payload too large, or blocked). Drop it.
      }
    } else {
      void fetch(ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      })
        .then((res) => {
          if (!res.ok) {
            console.warn(`[track-event] flush failed: HTTP ${res.status}`);
          }
        })
        .catch((err) => {
          console.warn("[track-event] flush network error:", err);
        });
    }

    // More than one batch was queued. Drain the rest on the next tick.
    if (queue.length > 0) {
      scheduleFlush();
    }
  } catch {
    // Telemetry must never surface an error to the caller.
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  try {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush(false);
    }, FLUSH_INTERVAL_MS);
  } catch {
    flushTimer = null;
  }
}

function bindLifecycleListeners(): void {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;
  try {
    // pagehide covers bfcache and normal unload. visibilitychange->hidden is
    // the one that reliably fires when a mobile browser is backgrounded.
    window.addEventListener("pagehide", () => flush(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush(true);
    });
  } catch {
    // Listener binding failed. Interval flushing still works.
  }
}

/** Force a flush. Exported for tests and for callers that know they are done. */
export function flushClientEvents(useBeacon = false): void {
  flush(useBeacon);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a behavioral event. Returns void, never throws, never blocks.
 *
 * Prefer opts.entity_type / opts.entity_id over stuffing ids into the payload:
 * they land in dedicated columns and stay queryable across event names.
 */
export function trackClientEvent(
  event_type: ClientEventName,
  payload: Record<string, unknown> = {},
  opts: TrackOptions = {},
): void {
  try {
    if (typeof window === "undefined") return;

    bindLifecycleListeners();

    const event: QueuedEvent = {
      event_type,
      payload: payload && typeof payload === "object" ? payload : {},
      session_id: getSessionId(),
      client_ts: new Date().toISOString(),
    };
    if (opts.entity_type) event.entity_type = String(opts.entity_type);
    if (opts.entity_id) event.entity_id = String(opts.entity_id);

    queue.push(event);

    // Bound the queue. Drop the oldest, since recent behavior is worth more.
    if (queue.length > MAX_QUEUE) {
      queue = queue.slice(queue.length - MAX_QUEUE);
    }

    if (opts.immediate) {
      flush(false);
    } else {
      scheduleFlush();
    }
  } catch {
    // ignore
  }
}
