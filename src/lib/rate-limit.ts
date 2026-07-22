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
// window instead.
//
// DURABILITY: the counter lives in Upstash Redis (via its REST API) so it is
// shared across every serverless instance and cold start. On Vercel each
// serverless instance kept its OWN in-memory Map before, which made the old
// limiter decorative: a flood spread across instances never shared a counter.
// The Redis-backed path fixes that.
//
// FALLBACK BY DESIGN:
//   1. Env vars ABSENT (local dev, previews before the vars are set): fall back
//      to the in-memory Map below and log ONCE that it is running undurable, so
//      dev still works and nobody is surprised in prod by a silent no-op.
//   2. Store UNREACHABLE (env set, but Redis errors/timeouts): FAIL OPEN. Allow
//      the request and log loudly. This is deliberately the OPPOSITE of the beta
//      allowlist check, which fails CLOSED. Rationale: a rate limiter protects
//      against abuse; if it breaks it must never lock every legitimate user out
//      of sign-in. The allowlist is an authorization gate; if IT breaks it must
//      never let an unapproved user in. Different jobs, opposite safe defaults.
//
// Dependency choice: a direct fetch to the Upstash REST pipeline endpoint, no
// @upstash/redis / @upstash/ratelimit packages. The fixed-window algorithm is a
// trivial INCR + PEXPIRE(NX) + PTTL in one round trip, so a hand-rolled call
// keeps the supply-chain surface and bundle minimal and makes the fail-open
// path easy to reason about. Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.

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

let warnedUndurable = false;

function upstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

/**
 * In-memory fixed-window fallback. PER SERVERLESS INSTANCE, so NOT durable.
 * Used only when the Upstash env vars are absent (local dev / early preview).
 */
function checkFixedWindowInMemory(
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
 * Check and consume one hit against a durable fixed-window limit.
 *
 * Backed by Upstash Redis (shared across all serverless instances). Falls back
 * to an in-memory Map when the env vars are absent, and FAILS OPEN when the
 * store is set but unreachable. See the block comment above for the full policy.
 *
 * @param key       Client key (e.g. IP) namespaced by caller, e.g. "auth-cb:1.2.3.4"
 * @param limit     Max hits allowed inside the window
 * @param windowMs  Window length in milliseconds
 */
export async function checkFixedWindow(
  key: string,
  limit: number,
  windowMs: number,
): Promise<FixedWindowResult> {
  const cfg = upstashConfig();

  if (!cfg) {
    if (!warnedUndurable) {
      warnedUndurable = true;
      console.warn(
        '[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set; ' +
          'fixed-window limiter is running UNDURABLE (in-memory, per-instance). ' +
          'Set both vars in Vercel (Production + Preview) for a shared counter.',
      );
    }
    return checkFixedWindowInMemory(key, limit, windowMs);
  }

  const now = Date.now();
  const redisKey = `rl:${key}`;

  try {
    // One round trip: INCR the counter, set the window TTL only on the first hit
    // (PEXPIRE ... NX), then read the remaining TTL to compute reset / retry.
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['PEXPIRE', redisKey, String(windowMs), 'NX'],
        ['PTTL', redisKey],
      ]),
      // Never let a slow store hang an auth request; a timeout fails open below.
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`Upstash REST returned HTTP ${res.status}`);
    }

    const parsed = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const incrErr = parsed[0]?.error;
    if (incrErr) throw new Error(`Upstash INCR error: ${incrErr}`);

    const count = Number(parsed[0]?.result);
    const pttlRaw = Number(parsed[2]?.result);
    if (!Number.isFinite(count)) {
      throw new Error('Upstash INCR returned a non-numeric count');
    }

    // PTTL returns -1 (no expiry) or -2 (no key) in edge/race cases; treat those
    // as a full window so reset math never goes negative.
    const pttl = Number.isFinite(pttlRaw) && pttlRaw >= 0 ? pttlRaw : windowMs;
    const resetAt = now + pttl;
    const allowed = count <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      limit,
      resetAt,
      retryAfterSeconds: allowed ? 0 : Math.ceil(pttl / 1000),
    };
  } catch (err) {
    // FAIL OPEN. A Redis outage must not lock users out of sign-in. Log loudly.
    console.error(
      '[rate-limit] Upstash unreachable, FAILING OPEN (request allowed). ' +
        'This is intentional; the limiter degrades to no-op rather than denying ' +
        'legitimate auth traffic during a store outage.',
      err,
    );
    return {
      allowed: true,
      remaining: limit - 1,
      limit,
      resetAt: now + windowMs,
      retryAfterSeconds: 0,
    };
  }
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
