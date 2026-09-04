// Every filter state on /radar/calls survives the phone redirect, proved one
// param at a time.
//
// WHY PER-PARAM AND NOT IN AGGREGATE. The redirect that already ships for five
// desk routes navigates with a bare path literal and drops the query, and it
// has no test of any kind. That drop is invisible on those five because none of
// their source routes reads a param. `/radar/calls` reads four, so an aggregate
// assertion ("it goes to the twin") would pass while three of the four intents
// were silently on the floor. Each param gets its own case, and each case names
// the screen that intent lands on.
//
// WHAT THIS FILE CANNOT SEE, stated so nobody reads more into a green run than
// is here: it proves the DESTINATION is built. It does not prove the
// destination honours what it was handed. Two of the four are proved further
// down the file by reading the receiving source, the same way
// `src/lib/auth-redirect.test.ts` reads `/radar/calls/page.tsx`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { callsDeskDestination, CALLS_TWIN } from "../../src/lib/calls-desk-destination";

const CALL_ID = "8f14e45f-ceea-467a-9d1a-3c2a3f1a0b77";

describe("the four params /radar/calls reads each reach a phone screen", () => {
  test("no query goes to the section itself", () => {
    assert.equal(callsDeskDestination(""), CALLS_TWIN);
    assert.equal(callsDeskDestination("?"), CALLS_TWIN);
  });

  test("?adopt reaches the one call, which is where the commit sheet is", () => {
    assert.equal(callsDeskDestination(`?adopt=${CALL_ID}`), `/claim/${CALL_ID}`);
  });

  test("?draft reaches the composer with the words intact", () => {
    const words = "Constellation runs ahead of the utilities into the AI power bid";
    assert.equal(
      callsDeskDestination(`?draft=${encodeURIComponent(words)}`),
      `/compose?draft=${encodeURIComponent(words)}`,
    );
  });

  test("?draft is truncated at the desk's own 400, not at some other number", () => {
    const long = "a".repeat(500);
    const got = new URL(`http://x${callsDeskDestination(`?draft=${long}`)}`);
    assert.equal(got.searchParams.get("draft")?.length, 400);
  });

  test("?thesis is carried to the twin rather than dropped", () => {
    assert.equal(
      callsDeskDestination(`?thesis=${CALL_ID}`),
      `${CALLS_TWIN}?thesis=${CALL_ID}`,
    );
  });

  test("?views=open is carried to the twin rather than dropped", () => {
    assert.equal(callsDeskDestination("?views=open"), `${CALLS_TWIN}?views=open`);
  });

  test("a views value that is not open is not treated as open", () => {
    assert.equal(callsDeskDestination("?views=shut"), CALLS_TWIN);
    assert.equal(callsDeskDestination("?views="), CALLS_TWIN);
  });
});

describe("nothing arbitrary reaches a path or a query we build", () => {
  test("a malformed adopt id degrades to the section, never to /claim/<junk>", () => {
    for (const bad of ["", "x", "../../etc", "<script>", "a b"]) {
      assert.equal(callsDeskDestination(`?adopt=${encodeURIComponent(bad)}`), CALLS_TWIN);
    }
  });

  test("a malformed thesis id degrades the same way", () => {
    for (const bad of ["x", "../../etc", "<script>"]) {
      assert.equal(callsDeskDestination(`?thesis=${encodeURIComponent(bad)}`), CALLS_TWIN);
    }
  });

  test("draft text is encoded, so an ampersand cannot forge a second param", () => {
    const got = callsDeskDestination(`?draft=${encodeURIComponent("a&views=open")}`);
    const url = new URL(`http://x${got}`);
    assert.equal(url.searchParams.get("draft"), "a&views=open");
    assert.equal(url.searchParams.get("views"), null);
  });

  test("whitespace-only draft is not a draft", () => {
    assert.equal(callsDeskDestination("?draft=%20%20"), CALLS_TWIN);
  });
});

describe("precedence is fixed, because a phone gives each intent its own screen", () => {
  test("adopt wins over every other param", () => {
    assert.equal(
      callsDeskDestination(`?adopt=${CALL_ID}&draft=hello&views=open&thesis=${CALL_ID}`),
      `/claim/${CALL_ID}`,
    );
  });

  test("draft wins over the two tracked-views params", () => {
    assert.equal(
      callsDeskDestination(`?draft=hello&views=open&thesis=${CALL_ID}`),
      "/compose?draft=hello",
    );
  });

  test("thesis wins over views, being the more specific of the two", () => {
    assert.equal(
      callsDeskDestination(`?views=open&thesis=${CALL_ID}`),
      `${CALLS_TWIN}?thesis=${CALL_ID}`,
    );
  });
});

describe("the receiving screens are wired for what they are handed", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  test("/compose reads the draft off its searchParams", () => {
    const page = read("src/app/compose/page.tsx");
    assert.ok(page.includes("params.draft"), "compose/page.tsx must read ?draft=");
  });

  test("the composer opens on a draft it was handed", () => {
    const screen = read("src/components/compose/compose-screen.tsx");
    assert.ok(screen.includes("draftSeed"), "compose-screen.tsx must accept a seeded draft");
  });

  test("/watch/calls reads the tracked-views params off its searchParams", () => {
    const page = read("src/app/watch/calls/page.tsx");
    assert.ok(page.includes('params.views') && page.includes("params.thesis"));
    assert.ok(page.includes("viewsRequested"));
  });

  test("the section names the absence when it is asked for tracked views", () => {
    const screen = read("src/components/radar-mobile/calls-screen.tsx");
    assert.ok(screen.includes("viewsRequested"));
  });

  test("/claim/[id] takes a morning_brief_calls id, which is what adopt carries", () => {
    const page = read("src/app/claim/[id]/page.tsx");
    assert.ok(page.includes("morning_brief_calls id"));
  });
});

describe("the redirect cannot bounce a reader back and forth", () => {
  test("no /watch screen links at a desk route the redirect sends back here", () => {
    const screen = readFileSync(
      join(process.cwd(), "src/components/radar-mobile/calls-screen.tsx"),
      "utf8",
    );
    // An href of /radar/calls inside the phone section is a round trip: the
    // redirect below md would send it straight back to this screen.
    assert.ok(
      !/href:\s*"\/radar\/calls/.test(screen) && !/href=\{?"\/radar\/calls/.test(screen),
      "calls-screen must not link at /radar/calls; the redirect sends it back here",
    );
  });

  test("the twin the redirect names is the route this section is served at", () => {
    assert.equal(CALLS_TWIN, "/watch/calls");
  });
});
