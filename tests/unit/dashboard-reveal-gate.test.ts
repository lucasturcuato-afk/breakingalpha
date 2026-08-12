import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  allSourcesSettled,
  DASHBOARD_REVEAL_TIMEOUT_MS,
} from "../../src/components/dashboard/dashboard-ready";

/**
 * The dashboard reveal gate.
 *
 * The load-bearing property is that SETTLED CARRIES NO NOTION OF SUCCESS. A
 * source that resolved and a source that threw both land in the same set, so a
 * failing panel cannot hold the page. /api/watchlist-quotes was observed
 * returning 503 twice in a single measured load while other calls to the same
 * endpoint returned 200, so this is a real path, not a hypothetical one.
 */

const setOf = (...ids: string[]) => new Set(ids);

/** The nine sources the dashboard registers, as measured in the browser. */
const ALL = [
  "stories",
  "market-cards",
  "watchlist-feed",
  "your-calls",
  "desk-record",
  "watchlist",
  "following",
  "daily-briefs",
  "system-intelligence",
];

describe("allSourcesSettled", () => {
  test("holds while any registered source is outstanding", () => {
    const registered = setOf(...ALL);
    const settled = setOf(...ALL.slice(0, -1));
    assert.equal(allSourcesSettled(registered, settled), false);
  });

  test("reveals once every registered source has settled", () => {
    assert.equal(allSourcesSettled(setOf(...ALL), setOf(...ALL)), true);
  });

  test("a FAILED source settles and does not block the reveal", () => {
    // "watchlist" is in `settled` because its quotes fetch 503'd and its catch
    // set items=[]. The gate cannot tell that apart from a success, and must
    // not try to: the panel renders its own empty state inside a revealed page.
    const registered = setOf(...ALL);
    const settled = setOf(...ALL);
    assert.equal(
      allSourcesSettled(registered, settled),
      true,
      "a 503 must reveal the page with that panel in its own error state",
    );
  });

  test("a source still failing keeps nothing else waiting once it settles", () => {
    const registered = setOf("watchlist", "stories");
    const settled = setOf("watchlist", "stories");
    assert.equal(allSourcesSettled(registered, settled), true);
  });

  test("nothing registered reveals immediately rather than waiting out the budget", () => {
    assert.equal(allSourcesSettled(setOf(), setOf()), true);
  });

  test("a source that settled but never registered cannot gate the page", () => {
    // fresh-radar mounts late (inside WatchlistFeed) and registers after the
    // seal, so it appears in `settled` but not `registered`. Observed in the
    // browser: registered=9, settled=10.
    const registered = setOf("stories");
    const settled = setOf("stories", "fresh-radar");
    assert.equal(allSourcesSettled(registered, settled), true);
  });

  test("an extra registered source keeps the gate closed until it settles", () => {
    const registered = setOf("stories", "late-arrival");
    const settled = setOf("stories");
    assert.equal(allSourcesSettled(registered, settled), false);
  });

  test("settling is idempotent by set membership, so refetches cannot re-close it", () => {
    // The rotating hero refetches /api/watchlist-quotes ~30x and
    // /api/stock-chart ~14x per load. Re-adding an id already present is a no-op.
    const settled = setOf(...ALL);
    const sizeBefore = settled.size;
    settled.add("watchlist-feed");
    settled.add("watchlist-feed");
    assert.equal(settled.size, sizeBefore);
    assert.equal(allSourcesSettled(setOf(...ALL), settled), true);
  });
});

describe("DASHBOARD_REVEAL_TIMEOUT_MS", () => {
  test("is the agreed 10s budget", () => {
    assert.equal(DASHBOARD_REVEAL_TIMEOUT_MS, 10_000);
  });

  test("is exported as a named constant", () => {
    assert.equal(typeof DASHBOARD_REVEAL_TIMEOUT_MS, "number");
    assert.ok(DASHBOARD_REVEAL_TIMEOUT_MS > 0);
  });
});
