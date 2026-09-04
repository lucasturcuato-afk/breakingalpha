/**
 * The redirect table's rules, pinned.
 *
 * Three of these exist because the behaviour they describe is a DECISION that
 * looks identical to an accident from the outside, and a future edit that
 * reverses one would otherwise pass every gate:
 *
 *   the query drop   `resolveTwinPath` answers with a bare path. Nothing in the
 *                    app relies on that today, which is exactly why it needs a
 *                    test: the next route added here may well carry a
 *                    parameter, and the drop must be something that author
 *                    steps over rather than something they never see.
 *   the exemption    `/radar/following` is absent on an owner ruling, not
 *                    because anybody forgot it.
 *   exact matching   `/company` redirects and `/company/<id>` must not. A
 *                    prefix match would take every company screen with it and
 *                    would look like a tidy simplification in review.
 *
 * Run: npm run test:unit
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { DESK_TO_TWIN, PHONE_WIDTH, resolveTwinPath } from "./desk-redirect-map";

describe("desk redirect table", () => {
  test("the five desk routes resolve to their twins", () => {
    assert.equal(resolveTwinPath("/morning-brief"), "/ledger");
    assert.equal(resolveTwinPath("/trends"), "/trends-mobile");
    assert.equal(resolveTwinPath("/radar/desk-record"), "/desk-record");
    assert.equal(resolveTwinPath("/radar/watchlist"), "/watch/watchlist");
    assert.equal(resolveTwinPath("/company"), "/ask");
  });

  test("there are exactly five, so a sixth cannot arrive unnoticed", () => {
    assert.equal(Object.keys(DESK_TO_TWIN).length, 5);
  });

  test("the watchlist twin is /watch/watchlist and NOT /watch", () => {
    /* PR #790 split mobile Radar into four sections and the bare path kept
       Following. Sending a watchlist reader to /watch lands them on the wrong
       section, which is a wrong screen rather than a missing one and would not
       look like a bug. An earlier survey got this wrong. */
    assert.equal(resolveTwinPath("/radar/watchlist"), "/watch/watchlist");
    assert.notEqual(resolveTwinPath("/radar/watchlist"), "/watch");
  });

  test("/radar/following is exempt, deliberately, on the ruling of 2026-09-03", () => {
    /* It is the only surface in the app that writes a follow, and no per-object
       follow toggle exists anywhere, so redirecting it removes the capability
       rather than moving it to a smaller screen. Re-adding it is a product
       decision and becomes correct only once a mobile follow control ships. */
    assert.equal(resolveTwinPath("/radar/following"), null);
    assert.equal("/radar/following" in DESK_TO_TWIN, false);
  });
});

describe("the query string is dropped, and that is deliberate", () => {
  /*
   * A twin is a different screen with its own parameter vocabulary, so
   * forwarding blindly would carry a parameter onto a screen that never agreed
   * to honour it. That failure is worse than a drop: a dropped parameter
   * renders the twin's honest default, a misread one renders a wrong screen
   * that looks like a working one.
   *
   * Verified on `beca56cf` that none of the five reads `searchParams` and that
   * nothing links to them with a query, so this is inert today. These tests
   * exist so it stays a choice. If a route ever needs its query to survive, the
   * TWIN has to implement the parameter; changing these assertions instead
   * would forward a parameter nobody has agreed to read.
   */

  test("a path carrying a query does not resolve, rather than resolving and silently discarding it", () => {
    assert.equal(resolveTwinPath("/trends?severity=high"), null);
    assert.equal(resolveTwinPath("/radar/desk-record?stage=error"), null);
    assert.equal(resolveTwinPath("/morning-brief?adopt=abc123"), null);
  });

  test("every twin is a bare path, so no route can smuggle a parameter into the table", () => {
    for (const [desk, twin] of Object.entries(DESK_TO_TWIN)) {
      assert.equal(twin.includes("?"), false, `${desk} -> ${twin} carries a query`);
      assert.equal(twin.includes("#"), false, `${desk} -> ${twin} carries a fragment`);
      assert.equal(twin.startsWith("/"), true, `${desk} -> ${twin} is not an app path`);
    }
  });
});

describe("matching is exact, never by prefix", () => {
  test("a company screen is not swept up by the /company directory", () => {
    assert.equal(resolveTwinPath("/company"), "/ask");
    assert.equal(resolveTwinPath("/company/AAPL"), null);
    assert.equal(resolveTwinPath("/company/some-private-name"), null);
  });

  test("the other four do not catch anything below themselves", () => {
    assert.equal(resolveTwinPath("/radar/watchlist/export"), null);
    assert.equal(resolveTwinPath("/trends-mobile"), null);
    assert.equal(resolveTwinPath("/morning-brief/archive"), null);
  });

  test("an unknown, empty or absent path resolves to null", () => {
    assert.equal(resolveTwinPath("/dashboard"), null);
    assert.equal(resolveTwinPath("/"), null);
    assert.equal(resolveTwinPath(""), null);
    assert.equal(resolveTwinPath(null), null);
    assert.equal(resolveTwinPath(undefined), null);
  });

  test("a twin never resolves to a further twin, so no redirect can chain", () => {
    for (const twin of Object.values(DESK_TO_TWIN)) {
      assert.equal(resolveTwinPath(twin), null, `${twin} is itself redirected`);
    }
  });
});

describe("the breakpoint is shared with the stylesheet", () => {
  test("PHONE_WIDTH is the md breakpoint and must match desk-redirect.module.css", () => {
    /* The stylesheet repeats this width. A width where the stylesheet hides the
       desk screen but the component declines to navigate is a blank page with
       no way off it. */
    assert.equal(PHONE_WIDTH, "(max-width: 767.98px)");
  });
});
