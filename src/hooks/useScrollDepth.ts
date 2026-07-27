"use client";

/**
 * useScrollDepth - how far down the page the user got, and where they stopped.
 *
 * Emits exactly ONE event, at teardown. Scroll fires tens of times a second on
 * a trackpad; a per-event emit would flood the route with rows that say nothing
 * individually. The listener does no work beyond reading two numbers and
 * keeping a max, and even that is coalesced onto an animation frame, so the
 * cost on the scroll path is a comparison.
 *
 * Max depth and abandonment depth are different questions and both are kept:
 * the max says how much of the brief was reachable enough to reach, the
 * abandonment point says where attention actually ran out.
 */

import { useEffect, useRef } from "react";

import { onPageVisibilityChange } from "@/lib/page-visibility";
import { trackClientEvent } from "@/lib/track-event";

export interface UseScrollDepthOptions {
  /** Event name. Must match surface.object.action. */
  eventName: string;
  enabled?: boolean;
  /** entity_type / entity_id for the row. */
  entityType?: string;
  entityId?: string | null;
  extra?: Record<string, unknown>;
}

/** Depth as a whole percent of the scrollable document, clamped to [0, 100]. */
function currentDepthPct(): number {
  try {
    const doc = document.documentElement;
    const viewport = window.innerHeight || doc.clientHeight || 0;
    const total = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0);
    const scrollable = total - viewport;
    // A page shorter than the viewport is fully seen by definition.
    if (scrollable <= 0) return 100;
    const y = window.scrollY || doc.scrollTop || 0;
    return Math.max(0, Math.min(100, Math.round(((y + viewport) / total) * 100)));
  } catch {
    return 0;
  }
}

export function useScrollDepth(options: UseScrollDepthOptions): void {
  const { eventName, enabled = true, entityType, entityId, extra } = options;

  const maxRef = useRef(0);
  const lastRef = useRef(0);
  const eventsRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const emittedRef = useRef(false);
  const cfg = useRef({ eventName, entityType, entityId, extra });
  // Assigned in an effect, not during render. See useExposure.
  useEffect(() => {
    cfg.current = { eventName, entityType, entityId, extra };
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    maxRef.current = 0;
    lastRef.current = 0;
    eventsRef.current = 0;
    emittedRef.current = false;

    const sample = () => {
      const pct = currentDepthPct();
      lastRef.current = pct;
      if (pct > maxRef.current) maxRef.current = pct;
    };

    // Initial read: a short brief may never fire a scroll event at all, and
    // "never scrolled" is a real answer, not a missing one.
    sample();

    const onScroll = () => {
      eventsRef.current += 1;
      // Coalesce onto the next frame. Many scroll events, one measurement.
      if (rafRef.current !== null) return;
      try {
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          sample();
        });
      } catch {
        rafRef.current = null;
        sample();
      }
    };

    const emit = () => {
      try {
        if (emittedRef.current) return;
        emittedRef.current = true;
        trackClientEvent(
          cfg.current.eventName as `${string}.${string}.${string}`,
          {
            ...(cfg.current.extra ?? {}),
            max_depth_pct: maxRef.current,
            abandon_depth_pct: lastRef.current,
            // Kept so the throttling claim is checkable from the data itself.
            scroll_events_observed: eventsRef.current,
          },
          {
            entity_type: cfg.current.entityType,
            entity_id: cfg.current.entityId ?? undefined,
          },
        );
      } catch {
        // Telemetry never surfaces.
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    const unsubscribe = onPageVisibilityChange((visible) => {
      if (!visible) emit();
    });

    return () => {
      try {
        window.removeEventListener("scroll", onScroll);
        if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      } catch {
        // ignore
      }
      rafRef.current = null;
      unsubscribe();
      sample();
      emit();
    };
  }, [enabled]);
}

/** Test seam: the depth math, without the listener. */
export const __scrollDepthInternals = { currentDepthPct };
