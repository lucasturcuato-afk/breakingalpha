"use client";

/**
 * useSectionDwell - how long a region was actually read.
 *
 * One event per section per mount, emitted at teardown, carrying visibility-
 * gated time in view and the number of separate visits. Sections a user never
 * reached emit nothing, which is the honest reading: absence of a row means the
 * region was never in view, not that it was in view for zero seconds.
 *
 * The gate lives in dwell-accumulator and is proved in its test. Everything
 * here is plumbing: an IntersectionObserver for in-view, a shared listener for
 * page visibility, and a single emit.
 */

import { useEffect, useRef } from "react";

import {
  createDwellState,
  finalize,
  readMs,
  setInView,
  setPageVisible,
} from "@/lib/dwell-accumulator";
import { isPageVisible, onPageVisibilityChange } from "@/lib/page-visibility";
import { trackClientEvent } from "@/lib/track-event";

export interface UseSectionDwellOptions {
  /** Stable key for the region. Lands in entity_id. */
  sectionKey: string;
  /** Event name. Must match surface.object.action. */
  eventName: string;
  enabled?: boolean;
  /** Visible fraction of the section that counts as in view. */
  threshold?: number;
  /** Below this, the region was passed over rather than read. No row. */
  minReportMs?: number;
  extra?: Record<string, unknown>;
}

export function useSectionDwell<T extends HTMLElement = HTMLElement>(
  options: UseSectionDwellOptions,
): React.RefObject<T | null> {
  const {
    sectionKey,
    eventName,
    enabled = true,
    threshold = 0.25,
    minReportMs = 400,
    extra,
  } = options;

  const ref = useRef<T | null>(null);
  const stateRef = useRef(createDwellState());
  const emittedRef = useRef(false);
  const cfg = useRef({ sectionKey, eventName, minReportMs, extra });
  // Assigned in an effect, not during render. See useExposure.
  useEffect(() => {
    cfg.current = { sectionKey, eventName, minReportMs, extra };
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const state = stateRef.current;
    emittedRef.current = false;
    setPageVisible(state, isPageVisible(), Date.now());

    const emit = () => {
      try {
        if (emittedRef.current) return;
        const totalMs = Math.round(finalize(state, Date.now()));
        if (totalMs < cfg.current.minReportMs) return;
        emittedRef.current = true;
        trackClientEvent(
          cfg.current.eventName as `${string}.${string}.${string}`,
          {
            ...(cfg.current.extra ?? {}),
            section_key: cfg.current.sectionKey,
            dwell_ms: totalMs,
            visits: state.runs,
          },
          { entity_type: "brief_section", entity_id: cfg.current.sectionKey },
        );
      } catch {
        // Telemetry never surfaces.
      }
    };

    let io: IntersectionObserver | null = null;
    try {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            setInView(
              state,
              entry.isIntersecting && entry.intersectionRatio >= threshold,
              Date.now(),
            );
          }
        },
        { threshold: [0, threshold, 1] },
      );
      io.observe(el);
    } catch {
      io = null;
    }

    const unsubscribe = onPageVisibilityChange((visible) => {
      setPageVisible(state, visible, Date.now());
      // Leaving the tab ends the reading session for this region. Emit now: the
      // user may never come back, and a row that never ships is no row.
      if (!visible && readMs(state, Date.now()) > 0) emit();
    });

    return () => {
      try {
        io?.disconnect();
      } catch {
        // ignore
      }
      unsubscribe();
      setInView(state, false, Date.now());
      emit();
    };
  }, [enabled, threshold]);

  return ref;
}
