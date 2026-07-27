"use client";

/**
 * useExposure - was it seen, where in the list, and for how long.
 *
 * Without exposure, a user who read a call and declined and a user who never
 * scrolled that far are the same row in the database, which is to say the same
 * as no row at all. Exposure is what makes non-action interpretable.
 *
 * Shape of the signal, and why it is one event rather than two:
 *
 *   An element qualifies when it is at least half visible for at least a beat
 *   (both configurable). It emits ONCE per element per session, at the moment
 *   the qualifying visible run ends: scrolled away, tab hidden, unmounted, or a
 *   hard cap reached. Emitting at the end is what lets a single row carry the
 *   duration; emitting at the start would ship a row that says "seen" and can
 *   never say for how long. The pagehide beacon in track-event covers the
 *   elements still on screen when the user leaves.
 *
 * Time in view is visibility-gated through the shared dwell accumulator, so a
 * backgrounded tab accrues nothing.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  createDwellState,
  finalize,
  setInView,
  setPageVisible,
  type DwellState,
} from "@/lib/dwell-accumulator";
import { isPageVisible, onPageVisibilityChange } from "@/lib/page-visibility";
import { noteObjectInView, secondsSinceSurfaceOpen } from "@/lib/attention-context";
import { getSessionId, trackClientEvent } from "@/lib/track-event";

export interface ExposureTarget {
  /** Entity class: "story", "brief_call", "deal". Lands in entity_type. */
  entityType: string;
  /** Entity key. Null when the DOM cannot supply one; position still counts. */
  entityId: string | null;
  /** Zero-based rendered position within its list. */
  rank?: number | null;
  /** Which list, when a surface renders more than one. */
  listKey?: string;
  /** Rendered length of that list, for a rank-relative read. */
  listLength?: number | null;
}

export interface UseExposureOptions {
  /** Event name. Must match surface.object.action. */
  eventName: string;
  /** Off until the surface has real content, so nothing fires against a skeleton. */
  enabled?: boolean;
  /** Visible fraction that counts as meaningfully visible. */
  threshold?: number;
  /** How long it must stay that visible before it counts as seen at all. */
  minVisibleMs?: number;
  /**
   * Emit and stop accruing after this much continuous visible time. A card left
   * on screen while the user reads elsewhere on the page is not more read at
   * ten minutes than at one, and the cap guarantees the row lands even if the
   * teardown beacon is lost.
   */
  maxVisibleMs?: number;
  /** Feed the last-object-in-view slot used for action provenance. */
  updatesFocus?: boolean;
  /** Extra payload merged into every exposure event from this hook. */
  extra?: Record<string, unknown>;
}

interface Record_ {
  target: ExposureTarget;
  /** Identity key, stable across re-renders and re-sorts. */
  key: string;
  dedupeKey: string;
  dwell: DwellState;
  /** Timer that decides whether a visible run qualifies as an exposure. */
  qualifyTimer: ReturnType<typeof setTimeout> | null;
  /** Timer for the hard cap. */
  capTimer: ReturnType<typeof setTimeout> | null;
  qualified: boolean;
  emitted: boolean;
  cappedAt: number | null;
  firstQualifiedAtS: number | null;
}

/**
 * Per-session dedupe. In memory so a client-side route change does not re-emit,
 * mirrored into sessionStorage so a hard reload inside the same tab does not
 * either. Capped, because an unbounded set in storage is a leak.
 */
const SEEN_KEY = "ba_exposure_seen";
const SEEN_CAP = 800;
let seen: Set<string> | null = null;

function seenSet(): Set<string> {
  if (seen) return seen;
  seen = new Set<string>();
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) for (const k of parsed) if (typeof k === "string") seen.add(k);
    }
  } catch {
    // Storage blocked or corrupt. In-memory dedupe still holds for this load.
  }
  return seen;
}

function markSeen(key: string): void {
  const s = seenSet();
  s.add(key);
  try {
    const arr = Array.from(s);
    window.sessionStorage.setItem(
      SEEN_KEY,
      JSON.stringify(arr.length > SEEN_CAP ? arr.slice(arr.length - SEEN_CAP) : arr),
    );
  } catch {
    // ignore
  }
}

function keyFor(t: ExposureTarget): string {
  return `${t.entityType}:${t.entityId ?? `rank${t.rank ?? "?"}@${t.listKey ?? ""}`}`;
}

export interface ExposureHandle {
  /** Ref callback factory. Pass the descriptor, attach the result as a ref. */
  observe: (target: ExposureTarget) => (el: HTMLElement | null) => void;
  /** Bank and emit everything still open. Called on unmount; exposed for callers. */
  flushAll: () => void;
}

export function useExposure(options: UseExposureOptions): ExposureHandle {
  const {
    eventName,
    enabled = true,
    threshold = 0.5,
    minVisibleMs = 1000,
    maxVisibleMs = 60_000,
    updatesFocus = true,
    extra,
  } = options;

  const records = useRef(new Map<Element, Record_>());
  const observer = useRef<IntersectionObserver | null>(null);
  /**
   * Stable ref callback per target key. A fresh callback identity on every
   * render would make React detach and re-attach the ref each time, which would
   * end the visible run and emit a truncated exposure on every re-render.
   */
  const refCache = useRef(new Map<string, (el: HTMLElement | null) => void>());
  /** Latest descriptor per key: rank and list length move as a list re-sorts. */
  const latestTargets = useRef(new Map<string, ExposureTarget>());
  // Read inside callbacks without making them dependencies.
  const cfg = useRef({ eventName, threshold, minVisibleMs, maxVisibleMs, updatesFocus, extra });
  // Synced in an effect, never assigned during render: the React Compiler
  // treats a ref write in the render body as an impure side effect, and it is
  // right to. Declared before the effects that read it, so it is current by the
  // time they run.
  useEffect(() => {
    cfg.current = { eventName, threshold, minVisibleMs, maxVisibleMs, updatesFocus, extra };
  });

  const emit = useCallback((rec: Record_) => {
    try {
      if (rec.emitted || !rec.qualified) return;
      rec.emitted = true;
      // Dedupe is marked here, not at registration: an element that mounted and
      // was never scrolled to has not been exposed, and must stay eligible.
      markSeen(rec.dedupeKey);
      const visibleMs = Math.round(finalize(rec.dwell, Date.now()));
      const t = latestTargets.current.get(rec.key) ?? rec.target;
      trackClientEvent(
        cfg.current.eventName as `${string}.${string}.${string}`,
        {
          ...(cfg.current.extra ?? {}),
          // NOT "position": that key is on the route's denied list (it reads
          // as a portfolio position) and would be stripped at the boundary.
          rendered_rank: t.rank ?? null,
          list_key: t.listKey ?? null,
          list_length: t.listLength ?? null,
          visible_ms: visibleMs,
          view_runs: rec.dwell.runs,
          seconds_to_first_view: rec.firstQualifiedAtS,
          // True when the element was still on screen at the cap. The row is a
          // floor on time in view, not a measurement of it.
          capped: rec.cappedAt !== null,
        },
        { entity_type: t.entityType, entity_id: t.entityId ?? undefined },
      );
    } catch {
      // Telemetry never surfaces.
    }
  }, []);

  const clearTimers = useCallback((rec: Record_) => {
    if (rec.qualifyTimer) {
      clearTimeout(rec.qualifyTimer);
      rec.qualifyTimer = null;
    }
    if (rec.capTimer) {
      clearTimeout(rec.capTimer);
      rec.capTimer = null;
    }
  }, []);

  const qualify = useCallback((rec: Record_) => {
    if (rec.qualified || rec.emitted) return;
    rec.qualified = true;
    rec.firstQualifiedAtS = secondsSinceSurfaceOpen();
    if (cfg.current.updatesFocus) {
      noteObjectInView({
        entityType: rec.target.entityType,
        entityId: rec.target.entityId,
        rank: rec.target.rank ?? null,
      });
    }
    // Hard cap on a single continuous run.
    try {
      rec.capTimer = setTimeout(() => {
        rec.cappedAt = Date.now();
        emit(rec);
      }, cfg.current.maxVisibleMs);
    } catch {
      // ignore
    }
  }, [emit]);

  const setVisible = useCallback(
    (rec: Record_, visible: boolean) => {
      const t = Date.now();
      setInView(rec.dwell, visible, t);
      if (visible) {
        if (!rec.qualified && !rec.qualifyTimer && !rec.emitted) {
          try {
            rec.qualifyTimer = setTimeout(() => {
              rec.qualifyTimer = null;
              // Re-check: a run that ended before the timer fired must not count.
              if (rec.dwell.inView && rec.dwell.pageVisible) qualify(rec);
            }, cfg.current.minVisibleMs);
          } catch {
            // ignore
          }
        }
      } else {
        clearTimers(rec);
        // The qualifying run ended. This is the moment the row is complete.
        emit(rec);
      }
    },
    [clearTimers, emit, qualify],
  );

  // Intersection.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") return;
    const map = records.current;
    let io: IntersectionObserver;
    try {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const rec = map.get(entry.target);
            if (!rec || rec.emitted) continue;
            const visible = entry.isIntersecting && entry.intersectionRatio >= cfg.current.threshold;
            setVisible(rec, visible);
          }
        },
        { threshold: [0, threshold, 1] },
      );
    } catch {
      return;
    }
    observer.current = io;
    for (const el of map.keys()) {
      try {
        io.observe(el);
      } catch {
        // ignore
      }
    }
    return () => {
      try {
        io.disconnect();
      } catch {
        // ignore
      }
      observer.current = null;
    };
  }, [enabled, threshold, setVisible]);

  // Visibility gate. A hidden tab stops the clock on every open record, and a
  // record that already qualified emits, because the run genuinely ended.
  useEffect(() => {
    if (!enabled) return;
    return onPageVisibilityChange((visible) => {
      const t = Date.now();
      for (const rec of records.current.values()) {
        if (rec.emitted) continue;
        setPageVisible(rec.dwell, visible, t);
        if (!visible) {
          clearTimers(rec);
          emit(rec);
        }
      }
    });
  }, [enabled, clearTimers, emit]);

  const flushAll = useCallback(() => {
    for (const rec of records.current.values()) {
      clearTimers(rec);
      emit(rec);
    }
  }, [clearTimers, emit]);

  // Unmount: bank whatever is open. Route changes are the common case.
  useEffect(() => {
    return () => {
      flushAll();
    };
  }, [flushAll]);

  const observe = useCallback(
    (target: ExposureTarget) => {
      const key = keyFor(target);
      latestTargets.current.set(key, target);
      const cached = refCache.current.get(key);
      if (cached) return cached;

      // React 19 ref cleanup: the returned function runs when the node detaches,
      // which is where a still-open exposure gets banked and the record dropped.
      const refCallback = (el: HTMLElement | null) => {
        try {
          const map = records.current;
          if (!el) return;
          if (map.has(el)) return;
          const current = latestTargets.current.get(key) ?? target;
          const sessionId = getSessionId();
          const dedupeKey = `${sessionId ?? "nosess"}|${key}`;
          if (seenSet().has(dedupeKey)) return;

          const dwell = createDwellState();
          setPageVisible(dwell, isPageVisible(), Date.now());
          const rec: Record_ = {
            target: current,
            key,
            dedupeKey,
            dwell,
            qualifyTimer: null,
            capTimer: null,
            qualified: false,
            emitted: false,
            cappedAt: null,
            firstQualifiedAtS: null,
          };
          map.set(el, rec);
          observer.current?.observe(el);

          return () => {
            try {
              observer.current?.unobserve(el);
              clearTimers(rec);
              setInView(rec.dwell, false, Date.now());
              emit(rec);
              map.delete(el);
            } catch {
              // ignore
            }
          };
        } catch {
          // A failed registration costs one exposure row, never a render.
        }
      };

      refCache.current.set(key, refCallback);
      return refCallback;
    },
    [clearTimers, emit],
  );

  return useMemo(() => ({ observe, flushAll }), [observe, flushAll]);
}
