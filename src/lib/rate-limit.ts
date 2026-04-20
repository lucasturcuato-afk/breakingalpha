/**
 * In-memory rate limiter.
 * Tracks usage per `${userId}:${bucket}` key with a sliding 24-hour window.
 * No external dependencies — state resets on server restart.
 */

interface Entry {
  timestamps: number[];
}

const store = new Map<string, Entry>();

// Prune stale keys every 10 minutes
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

let lastPrune = Date.now();

function pruneIfNeeded() {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // epoch ms when oldest request expires
}

/**
 * Check and consume one request against the rate limit.
 * @param userId  Authenticated user ID
 * @param bucket  Namespace (e.g. "chat", "memo")
 * @param maxPerDay  Maximum requests per 24-hour window
 */
export function checkRateLimit(
  userId: string,
  bucket: string,
  maxPerDay: number,
): RateLimitResult {
  pruneIfNeeded();

  const key = `${userId}:${bucket}`;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);

  if (entry.timestamps.length >= maxPerDay) {
    const oldest = entry.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      limit: maxPerDay,
      resetAt: oldest + WINDOW_MS,
    };
  }

  // Consume
  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxPerDay - entry.timestamps.length,
    limit: maxPerDay,
    resetAt: entry.timestamps[0] + WINDOW_MS,
  };
}
