/**
 * page-visibility.ts - one document visibility listener, many subscribers.
 *
 * Every attention primitive needs the same signal, and each of them binding its
 * own listener on every observed element would be a listener per card. One
 * shared listener, fanned out.
 */

import { flushClientEvents } from "./track-event";

type Subscriber = (visible: boolean) => void;

const subscribers = new Set<Subscriber>();
let bound = false;

export function isPageVisible(): boolean {
  try {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  } catch {
    return true;
  }
}

function broadcast(): void {
  const visible = isPageVisible();
  for (const fn of subscribers) {
    try {
      fn(visible);
    } catch {
      // A broken subscriber never breaks the others.
    }
  }
}

/** Subscribe to visibility changes. Returns the unsubscribe function. */
export function onPageVisibilityChange(fn: Subscriber): () => void {
  try {
    if (typeof document === "undefined") return () => {};
    subscribers.add(fn);
    if (!bound) {
      bound = true;
      document.addEventListener("visibilitychange", broadcast);
      // pagehide is the reliable teardown signal on mobile Safari, where
      // visibilitychange can be skipped entirely.
      window.addEventListener("pagehide", () => {
        for (const s of subscribers) {
          try {
            s(false);
          } catch {
            // ignore
          }
        }
        // Subscribers emit their final rows inside that loop, which lands them
        // in the queue AFTER track-event's own pagehide flush has already run.
        // Flush again, on the beacon, or every teardown row is lost.
        try {
          flushClientEvents(true);
        } catch {
          // ignore
        }
      });
    }
  } catch {
    return () => {};
  }
  return () => {
    try {
      subscribers.delete(fn);
    } catch {
      // ignore
    }
  };
}
