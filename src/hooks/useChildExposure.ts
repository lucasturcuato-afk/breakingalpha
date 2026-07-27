"use client";

/**
 * useChildExposure - exposure for a list rendered by a component you do not own.
 *
 * useExposure needs a ref on each card, which needs an edit to the component
 * that renders the cards. When that component is off limits (being edited in a
 * parallel branch, or simply not worth coupling to telemetry), this observes
 * the container from the outside instead: it watches for children appearing,
 * attaches the same exposure machinery to each, and reads identity out of the
 * DOM through a caller-supplied resolver.
 *
 * The tradeoff is explicit. Position and count are always correct because they
 * come from the rendered order. Identity is only as good as the resolver, and a
 * null id is recorded as null rather than guessed. When the owning component
 * later carries a stable data attribute, the resolver becomes a one-liner and
 * this hook stops being a workaround.
 */

import { useEffect, useRef } from "react";

import { useExposure, type UseExposureOptions } from "./useExposure";

export interface UseChildExposureOptions
  extends Omit<UseExposureOptions, "extra"> {
  /** Entity class recorded for every child. */
  entityType: string;
  /** Which list. Recorded on every row. */
  listKey: string;
  /** Selector for the cards, relative to the container. Direct children by default. */
  childSelector?: string;
  /** Pull a stable id out of a rendered card. Return null when there is none. */
  resolveEntityId?: (el: Element) => string | null;
  extra?: Record<string, unknown>;
}

export function useChildExposure(
  containerRef: React.RefObject<HTMLElement | null>,
  options: UseChildExposureOptions,
): void {
  const {
    entityType,
    listKey,
    childSelector = ":scope > *",
    resolveEntityId,
    enabled = true,
    ...exposureOptions
  } = options;

  const exposure = useExposure({ ...exposureOptions, enabled });
  const cfg = useRef({ entityType, listKey, childSelector, resolveEntityId });
  // Assigned in an effect, not during render. See useExposure.
  useEffect(() => {
    cfg.current = { entityType, listKey, childSelector, resolveEntityId };
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const container = containerRef.current;
    if (!container) return;

    /** Attached children, with the cleanup returned by the exposure ref. */
    const attached = new Map<Element, (() => void) | undefined>();

    const scan = () => {
      try {
        const { childSelector: sel, entityType: type, listKey: key, resolveEntityId: resolve } =
          cfg.current;
        const children = Array.from(container.querySelectorAll(sel));
        // Drop rows that are gone. Their cleanup banks any open exposure.
        for (const [el, cleanup] of attached) {
          if (!container.contains(el)) {
            try {
              cleanup?.();
            } catch {
              // ignore
            }
            attached.delete(el);
          }
        }
        children.forEach((el, i) => {
          if (attached.has(el)) return;
          let entityId: string | null = null;
          try {
            entityId = resolve ? resolve(el) : null;
          } catch {
            entityId = null;
          }
          const ref = exposure.observe({
            entityType: type,
            entityId,
            rank: i,
            listKey: key,
            listLength: children.length,
          });
          const cleanup = ref(el as HTMLElement) as unknown as (() => void) | undefined;
          attached.set(el, typeof cleanup === "function" ? cleanup : undefined);
        });
      } catch {
        // A failed scan costs exposure rows, never a render.
      }
    };

    scan();

    let mo: MutationObserver | null = null;
    try {
      // The container is filled in after its own fetch resolves, so a one-shot
      // scan on mount would see an empty grid on every load.
      mo = new MutationObserver(() => scan());
      mo.observe(container, { childList: true, subtree: true });
    } catch {
      mo = null;
    }

    return () => {
      try {
        mo?.disconnect();
      } catch {
        // ignore
      }
      for (const cleanup of attached.values()) {
        try {
          cleanup?.();
        } catch {
          // ignore
        }
      }
      attached.clear();
    };
  }, [containerRef, enabled, exposure]);
}
