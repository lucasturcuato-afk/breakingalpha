"use client";

/**
 * cachedFetch — in-flight dedupe + short TTL for repeated client GETs.
 *
 * THE PROBLEM. One dashboard load issued 30x /api/watchlist-quotes and 14x
 * /api/stock-chart, overwhelmingly the SAME URLs. RotatingLeadHero remounts its
 * children on every rotation tick; each child (HeroThread, HeroPeers, SparkLine)
 * refetches quotes and charts for tickers it already asked about seconds ago.
 * Nothing between the ticks remembered the answer.
 *
 * THE FIX, and its limits. This is a cache keyed on the request URL. It does two
 * distinct things:
 *
 *   1. IN-FLIGHT DEDUPE. Concurrent callers asking for the same URL share one
 *      network request. This is the half that fixes the burst: on a rotation the
 *      three children fire near-simultaneously for the same ticker.
 *   2. SHORT TTL. A completed response is reused for TTL_MS. This is the half
 *      that fixes rotation-over-time, where the same ticker comes back around.
 *
 * WHY RESPONSES ARE CLONED. A Response body is a stream and can only be read
 * once. Handing the same object to two callers means the second gets a consumed
 * body and throws on .json(). Every caller gets its own clone, so `res.ok` and
 * `res.json()` behave exactly as with a bare fetch -- that equivalence is what
 * lets call sites swap `fetch(` for `cachedFetch(` without touching their error
 * handling.
 *
 * FAILURES ARE NOT CACHED. /api/watchlist-quotes was measured returning 503
 * intermittently while sibling calls to the same endpoint returned 200. Caching
 * a 503 for the TTL would turn a blip into a guaranteed 30s outage for that
 * ticker. A non-ok response is returned to the caller and evicted, so the next
 * caller retries. The in-flight entry is likewise dropped on a network throw.
 *
 * SCOPE. Deliberately GET-only and process-local. It is not a data layer and
 * holds no notion of staleness beyond wall-clock age.
 */

/**
 * 30s. Long enough to span several hero rotations (the source of the
 * duplication), short enough that a quote is never meaningfully stale on a page
 * whose own panels refresh on the order of minutes.
 */
const TTL_MS = 30_000;

interface CacheEntry {
  /** Resolves to the response that must be cloned before handing out. */
  promise: Promise<Response>;
  /** When the response completed. Absent while still in flight. */
  completedAt?: number;
}

const cache = new Map<string, CacheEntry>();

/** Test seam. Also worth calling on sign-out, when responses become another user's. */
export function clearFetchCache(): void {
  cache.clear();
}

/**
 * True when an entry may still be served. An in-flight entry (no completedAt)
 * is always reusable -- that is the dedupe -- regardless of age.
 */
export function isEntryFresh(entry: CacheEntry, now: number, ttlMs = TTL_MS): boolean {
  if (entry.completedAt === undefined) return true;
  return now - entry.completedAt < ttlMs;
}

/**
 * Drop-in for `fetch(url)` on idempotent GETs.
 *
 * Returns a fresh clone each call, so callers read `.ok` and `.json()` normally.
 */
export function cachedFetch(url: string, ttlMs = TTL_MS): Promise<Response> {
  const now = Date.now();
  const existing = cache.get(url);

  if (existing && isEntryFresh(existing, now, ttlMs)) {
    return existing.promise.then((res) => res.clone());
  }

  const promise = fetch(url).then((res) => {
    if (!res.ok) {
      // An intermittent 503 must not be remembered. Evict so the next caller
      // goes back to the network.
      cache.delete(url);
      return res;
    }
    const entry = cache.get(url);
    if (entry) entry.completedAt = Date.now();
    return res;
  });

  // Evict on rejection too, otherwise one offline blip poisons the URL for the
  // rest of the page's life -- the promise stays in the map and every later
  // caller re-awaits the same rejection.
  const tracked: CacheEntry = {
    promise: promise.catch((err) => {
      cache.delete(url);
      throw err;
    }),
  };
  cache.set(url, tracked);

  return tracked.promise.then((res) => res.clone());
}
