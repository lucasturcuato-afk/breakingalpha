import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { cachedFetch, clearFetchCache } from "../../src/lib/client-fetch-cache";

/**
 * The client fetch cache.
 *
 * Two properties are load-bearing and neither is obvious:
 *   - Every caller must get an UNCONSUMED body. Sharing one Response means the
 *     second reader throws.
 *   - A FAILED response must not be cached. /api/watchlist-quotes was measured
 *     returning 503 intermittently alongside 200s; caching the 503 would
 *     convert a blip into a guaranteed outage for the whole TTL.
 */

let calls: string[] = [];
let nextStatus = 200;
let nextThrow = false;

function installFetch() {
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    calls.push(url);
    if (nextThrow) throw new Error("network down");
    return new Response(JSON.stringify({ n: calls.length }), { status: nextStatus });
  };
}

beforeEach(() => {
  calls = [];
  nextStatus = 200;
  nextThrow = false;
  clearFetchCache();
  installFetch();
});

describe("cachedFetch", () => {
  test("concurrent callers for the same URL share ONE network request", async () => {
    // This is the rotation burst: HeroThread, HeroPeers and SparkLine all fire
    // for the same ticker within the same tick.
    const [a, b, c] = await Promise.all([
      cachedFetch("/api/watchlist-quotes?symbols=YPF"),
      cachedFetch("/api/watchlist-quotes?symbols=YPF"),
      cachedFetch("/api/watchlist-quotes?symbols=YPF"),
    ]);
    assert.equal(calls.length, 1, "three callers must produce one request");
    // All three must be independently readable.
    assert.deepEqual(await a.json(), { n: 1 });
    assert.deepEqual(await b.json(), { n: 1 });
    assert.deepEqual(await c.json(), { n: 1 });
  });

  test("a later caller inside the TTL is served without a new request", async () => {
    await cachedFetch("/api/stock-chart?ticker=YPF&range=1mo");
    const second = await cachedFetch("/api/stock-chart?ticker=YPF&range=1mo");
    assert.equal(calls.length, 1);
    assert.deepEqual(await second.json(), { n: 1 }, "body must still be readable");
  });

  test("distinct URLs are not conflated", async () => {
    await cachedFetch("/api/watchlist-quotes?symbols=YPF");
    await cachedFetch("/api/watchlist-quotes?symbols=AAPL");
    assert.equal(calls.length, 2);
  });

  test("an expired entry refetches", async () => {
    await cachedFetch("/api/watchlist-quotes?symbols=YPF", 0);
    await cachedFetch("/api/watchlist-quotes?symbols=YPF", 0);
    assert.equal(calls.length, 2, "ttl of 0 must never serve from cache");
  });

  test("a 503 is NOT cached, so the next caller retries", async () => {
    nextStatus = 503;
    const bad = await cachedFetch("/api/watchlist-quotes?symbols=YPF");
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 503, "the caller still sees the real status");

    nextStatus = 200;
    const good = await cachedFetch("/api/watchlist-quotes?symbols=YPF");
    assert.equal(good.ok, true);
    assert.equal(calls.length, 2, "a failure must not be remembered for the TTL");
  });

  test("a network throw is evicted rather than poisoning the URL", async () => {
    nextThrow = true;
    await assert.rejects(() => cachedFetch("/api/watchlist-quotes?symbols=YPF"));

    nextThrow = false;
    const good = await cachedFetch("/api/watchlist-quotes?symbols=YPF");
    assert.equal(good.ok, true);
    assert.equal(calls.length, 2);
  });

  test("res.ok and res.json() behave as with a bare fetch", async () => {
    // The equivalence that lets call sites swap fetch( for cachedFetch(
    // without touching their error handling.
    const res = await cachedFetch("/api/watchlist-quotes?symbols=YPF");
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { n: 1 });
  });
});
