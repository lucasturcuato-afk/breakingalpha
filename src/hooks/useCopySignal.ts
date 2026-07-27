"use client";

/**
 * useCopySignal - copying a passage is the strongest usefulness signal a
 * reading surface produces. Nobody copies a sentence they did not find worth
 * carrying somewhere else.
 *
 * What is recorded: which entity the selection came out of, and how long it
 * was. What is never recorded: the text. The character count says the user took
 * something; the text itself would be content the user chose, which is not ours
 * to store. Selections that originate inside an input, textarea, or
 * contenteditable are dropped entirely, not truncated, because a copy out of a
 * field is the user handling their own data.
 */

import { useEffect, useRef } from "react";

import { trackClientEvent } from "@/lib/track-event";

export interface UseCopySignalOptions {
  /** Event name. Must match surface.object.action. */
  eventName: string;
  enabled?: boolean;
  /** Fallback entity when the selection is not inside a marked element. */
  entityType?: string;
  entityId?: string | null;
  extra?: Record<string, unknown>;
}

/** Marks a region as attributable. Read off the nearest ancestor. */
export const ATTN_TYPE_ATTR = "data-attn-type";
export const ATTN_ID_ATTR = "data-attn-id";

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when the node sits inside anything the user types into. */
function insideEditable(node: Node | null): boolean {
  let el: Element | null =
    node && node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);
  while (el) {
    if (FIELD_TAGS.has(el.tagName)) return true;
    if ((el as HTMLElement).isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

function nearestMarked(node: Node | null): { type: string; id: string } | null {
  let el: Element | null =
    node && node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);
  while (el) {
    const type = el.getAttribute?.(ATTN_TYPE_ATTR);
    const id = el.getAttribute?.(ATTN_ID_ATTR);
    if (type && id) return { type, id };
    el = el.parentElement;
  }
  return null;
}

export function useCopySignal<T extends HTMLElement = HTMLElement>(
  options: UseCopySignalOptions,
): React.RefObject<T | null> {
  const { eventName, enabled = true, entityType, entityId, extra } = options;

  const ref = useRef<T | null>(null);
  const cfg = useRef({ eventName, entityType, entityId, extra });
  // Assigned in an effect, not during render. See useExposure.
  useEffect(() => {
    cfg.current = { eventName, entityType, entityId, extra };
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const root = ref.current;
    if (!root) return;

    const onCopy = () => {
      try {
        const selection = window.getSelection?.();
        if (!selection || selection.isCollapsed) return;
        const anchor = selection.anchorNode;
        if (!anchor || !root.contains(anchor)) return;
        if (insideEditable(anchor) || insideEditable(selection.focusNode)) return;

        // Length only. The passage itself is never read into a payload.
        const length = selection.toString().length;
        if (length <= 0) return;

        const marked = nearestMarked(anchor);
        trackClientEvent(
          cfg.current.eventName as `${string}.${string}.${string}`,
          {
            ...(cfg.current.extra ?? {}),
            char_count: length,
            // Whether it came from an attributable object or loose page text.
            attributed: marked !== null,
          },
          {
            entity_type: marked?.type ?? cfg.current.entityType,
            entity_id: marked?.id ?? cfg.current.entityId ?? undefined,
          },
        );
      } catch {
        // Telemetry never surfaces.
      }
    };

    root.addEventListener("copy", onCopy);
    return () => {
      try {
        root.removeEventListener("copy", onCopy);
      } catch {
        // ignore
      }
    };
  }, [enabled]);

  return ref;
}
