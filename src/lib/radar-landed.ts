/**
 * radar-landed.ts - the peripheral confirmation that a call landed in Radar.
 *
 * The commit already confirms itself in place: the button collapses, the edge
 * takes gold, the ledger writes. What is missing is the sense that it went
 * SOMEWHERE. A banner or a toast would say so loudly and interrupt the reading;
 * a brief pulse on the Radar nav row says it in the periphery, where the eye
 * catches it and the reader does not have to dismiss anything.
 *
 * Deliberately NOT a count increment. The badge on the Radar row is the
 * watchlist count (see sidebar.tsx: isWatchlist is the /radar item), so bumping
 * it for a tracked call would put a wrong number on screen. The pulse is the
 * signal; the number stays true.
 *
 * Fail-open like every other side channel: nothing here throws, and a subscriber
 * that throws never breaks the publisher.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Announce that something was just committed to Radar. Never throws. */
export function notifyRadarLanded(): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn();
    } catch {
      // A broken subscriber never breaks the commit.
    }
  }
}

/** Subscribe. Returns the unsubscribe function. Never throws. */
export function onRadarLanded(fn: Listener): () => void {
  try {
    listeners.add(fn);
  } catch {
    return () => {};
  }
  return () => {
    try {
      listeners.delete(fn);
    } catch {
      // ignore
    }
  };
}
