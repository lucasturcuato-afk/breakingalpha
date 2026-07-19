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

// ============================================================
// Fixed-window limiter for unauthenticated entry points (auth).
// ============================================================
// The per-user sliding limiter above needs a userId. Auth entry points are
// pre-session, so we throttle by a coarse client key (IP) over a short fixed
// window instead. Same HONEST caveat applies: this Map is PER SERVERLESS
// INSTANCE. On Vercel Fluid Compute each cold start gets a fresh Map and
// concurrent instances do not share counters, so this raises the cost of a
// naive single-connection flood but is NOT a durable, globally consistent
// limiter. For real abuse protection wire a shared store (Vercel KV / Upstash
// Redis) behind checkFixedWindow(), or configure Vercel WAF rate limiting at
// the edge. Zero new dependencies on purpose.

interface FixedWindow {
  count: number;
  resetAt: number;
}

const fixedStore = new Map<string, FixedWindow>();

export interface FixedWindowResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/**
 * Check and consume one hit against a fixed-window limit.
 * @param key       Client key (e.g. IP) namespaced by caller, e.g. "auth-cb:1.2.3.4"
 * @param limit     Max hits allowed inside the window
 * @param windowMs  Window length in milliseconds
 */
export function checkFixedWindow(
  key: string,
  limit: number,
  windowMs: number,
): FixedWindowResult {
  const now = Date.now();
  const existing = fixedStore.get(key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    fixedStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, limit, resetAt, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    limit,
    resetAt: existing.resetAt,
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Best-effort client key from request headers. Falls back to a shared constant
 * so a missing IP still shares one bucket rather than bypassing the limiter.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown-client';
}
