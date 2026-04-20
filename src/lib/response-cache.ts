/**
 * In-memory response cache with TTL and LRU eviction.
 * Used to avoid re-generating identical intelligence responses.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  key: string;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_ENTRIES = 200;

const cache = new Map<string, CacheEntry<unknown>>();
const accessOrder: string[] = []; // most-recently-used at end

function touch(key: string) {
  const idx = accessOrder.indexOf(key);
  if (idx !== -1) accessOrder.splice(idx, 1);
  accessOrder.push(key);
}

function evictIfNeeded() {
  while (cache.size > MAX_ENTRIES && accessOrder.length > 0) {
    const oldest = accessOrder.shift()!;
    cache.delete(oldest);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    const idx = accessOrder.indexOf(key);
    if (idx !== -1) accessOrder.splice(idx, 1);
    return undefined;
  }
  touch(key);
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs, key });
  touch(key);
  evictIfNeeded();
}

/**
 * Build a deterministic cache key from a user message.
 * Normalizes whitespace and lowercases for better hit rate.
 */
export function buildCacheKey(userId: string, message: string): string {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return `intel:${userId}:${normalized}`;
}
