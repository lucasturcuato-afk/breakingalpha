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
  /**
   * Emit at most once per UTC day for this key, per reader, per browser.
   *
   * The key is scoped by event_type internally, so two different event names
   * may pass the SAME key and each still emits once. That is what keeps the
   * dotted and legacy brief-open names paired 1:1 rather than one suppressing
   * the other.
   *
   * WHY THIS EXISTS. A `useRef` guard inside a component body lives exactly as
   * long as one mount, so a remount, a client route re-entry or a reload resets
   * it and the event fires again. Measured consequence on the brief-open event:
   * one account produced 195 of 215 counted opens across 125 sessions but only
   * 5 distinct briefings, one of them 84 times in a day.
   *
   * Backed by localStorage, deliberately, because sessionStorage dies with the
   * tab and would still let every reload and every second tab re-fire. Fails
   * OPEN: if storage throws, which it does in some privacy modes, the event is
   * emitted rather than dropped. Losing a duplicate is cheap; losing a real
   * open is not.
   */
  once?: string;
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

// ---------------------------------------------------------------------------
// Once-per-day emission guard
//
// Split from the storage it uses so it can be tested without a browser. The
// pure half takes a store; the impure half hands it localStorage.
// ---------------------------------------------------------------------------

/** One namespaced key holds the whole map, so cleanup is a single write. */
export const ONCE_STORAGE_KEY = "ba_telemetry_once";
/** Entries older than this are pruned on every claim, so the map cannot grow. */
export const ONCE_RETENTION_DAYS = 2;

/** The minimum surface of Storage this needs. Lets a test pass a plain object. */
export interface OnceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** UTC day stamp. UTC, not local, so the key matches the SQL dedupe key. */
export function onceDayStamp(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Claim `key` for the UTC day containing `at`.
 *
 * True when this is the FIRST claim, meaning the caller should emit,
 * and false when the key was already claimed today. Prunes entries older than
 * ONCE_RETENTION_DAYS on every call.
 *
 * Throws nothing of its own; a store that throws is the caller's to handle.
 */
export function claimOnce(store: OnceStore, key: string, at: Date): boolean {
  const today = onceDayStamp(at);
  const cutoff = onceDayStamp(new Date(at.getTime() - ONCE_RETENTION_DAYS * 86400000));

  let map: Record<string, string> = {};
  const raw = store.getItem(ONCE_STORAGE_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      // A corrupted or hand-edited value must not wedge telemetry forever.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        map = parsed as Record<string, string>;
      }
    } catch {
      map = {};
    }
  }

  const already = map[key] === today;

  const pruned: Record<string, string> = {};
  for (const [k, day] of Object.entries(map)) {
    if (typeof day === "string" && day >= cutoff) pruned[k] = day;
  }
  if (!already) pruned[key] = today;
  store.setItem(ONCE_STORAGE_KEY, JSON.stringify(pruned));

  return !already;
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
// Ambient payload enrichment
// ---------------------------------------------------------------------------

/**
 * An enricher contributes ambient context to every event emitted while it is
 * registered. It exists so provenance (which brief, which story was in view,
 * how long the user had been reading) rides along on events emitted by
 * components that know nothing about attention tracking, without every call
 * site having to thread it through.
 *
 * Contract: pure read, never throws, returns a flat object. Caller-supplied
 * payload keys always win, so an enricher can never overwrite a fact the call
 * site actually measured.
 */
export type EventEnricher = (
  eventType: string,
) => Record<string, unknown> | null | undefined;

const enrichers = new Set<EventEnricher>();

/** Register an enricher. Returns the unregister function. Never throws. */
export function registerEventEnricher(fn: EventEnricher): () => void {
  try {
    enrichers.add(fn);
  } catch {
    return () => {};
  }
  return () => {
    try {
      enrichers.delete(fn);
    } catch {
      // ignore
    }
  };
}

/** Merge every registered enricher's output beneath `payload`. Never throws. */
function enrich(
  eventType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (enrichers.size === 0) return payload;
  let base: Record<string, unknown> = {};
  for (const fn of enrichers) {
    try {
      const extra = fn(eventType);
      if (extra && typeof extra === "object" && !Array.isArray(extra)) {
        base = { ...base, ...extra };
      }
    } catch {
      // A broken enricher degrades provenance. It never drops the event.
    }
  }
  return { ...base, ...payload };
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

    // Once-per-day guard. Scoped by event_type so two names may share a key.
    // FAILS OPEN: any storage error falls through and the event is emitted.
    if (opts.once) {
      try {
        if (!claimOnce(window.localStorage, `${event_type}:${opts.once}`, new Date())) {
          return;
        }
      } catch {
        // Storage unavailable or blocked. Emit rather than drop.
      }
    }

    const own = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const event: QueuedEvent = {
      event_type,
      payload: enrich(event_type, own),
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
