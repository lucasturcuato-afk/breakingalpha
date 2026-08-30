// Unit tests for where the company directory's search box sends a query that
// matched nothing.
//
// WHY A UNIT TEST AND NOT A BROWSER SPEC. The decision is a NAVIGATION GATE on
// the zero-match path, and reproducing it end to end means landing on
// `/company/BRK.B`, which mounts `CompanyAutoResolve` and POSTs
// `/api/company/resolve`, a route that inserts a `companies` row through the
// service-role client. The browser run that proves the reader's side of this is
// in the PR body and it has to stub that POST to stay read-only. The assertion
// that matters here -- "this query does not navigate" -- needs none of it.
//
// WHAT THE PREVIOUS VERSION OF THIS FILE GOT WRONG, because it is the reason
// the gate now lives in a module. It RESTATED the rule in a local
// `navigatesTo()` helper and asserted against the restatement, so four of its
// five tests passed against `main`, where the gate is a different regex in a
// file this test never loaded. A test that cannot go red on the tree it is
// describing is documentation with an exit code. Every case below imports
// `zeroMatchTarget` itself.
//
// THE CONTRACT LOCKED HERE, and the module header carries the reasoning:
//
//   BRK.B / BF.B / SHELL.AS  -> NO navigation. Nothing reconstructs the dot
//                               away, so the route's ticker branch cannot run
//                               on the slug and the resolve retry pushes the
//                               same slug straight back
//   NVDA / AAPL / A / IBM    -> navigates. The retry's ticker push is a string
//                               the route can look up as a ticker
//   INTC / GOOGLE / TSM / BX -> navigates. CANONICAL rewrites the slug to
//                               Intel / Alphabet / Taiwan Semiconductor /
//                               Blackstone, none of which contain what was
//                               typed, so `q=` never searched for them
//   COIN / SHOP / ARM / HOOD -> NO navigation. Coinbase, Shopify, Arm Holdings
//                               and Robinhood all CONTAIN the typed string, so
//                               the zero match already ruled them out
//   ZZQQXX / ASDFGH          -> NO navigation
//   100% / 50%off / a%b      -> NO navigation, AND NO THROW. See below
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zeroMatchTarget } from "../../src/lib/company-search-target.ts";
import { linkLookups } from "../../src/lib/watch-links.ts";

test("a dotted ticker does not route into a slug the route cannot resolve", () => {
  for (const typed of ["BRK.B", "brk.b", " BRK.B ", "BF.B", "SHELL.AS"]) {
    assert.equal(zeroMatchTarget(typed), null, `${typed} must not navigate`);
  }
});

test("a plain ticker still opens the on-demand mint path", () => {
  assert.equal(zeroMatchTarget("NVDA"), "/company/NVDA");
  assert.equal(zeroMatchTarget("aapl"), "/company/AAPL");
  assert.equal(zeroMatchTarget("A"), "/company/A");
  assert.equal(zeroMatchTarget("GOOGL"), "/company/GOOGL");
  assert.equal(zeroMatchTarget("IBM"), "/company/IBM");
});

test("a slug CANONICAL rewrites to a name the search never ran navigates", () => {
  // The directory searched `name.ilike.%INTC%`; the route will search the exact
  // string "Intel". A zero match on the first says nothing about the second.
  assert.equal(zeroMatchTarget("INTC"), "/company/INTC");
  assert.equal(linkLookups("INTC")?.name, "Intel");

  assert.equal(zeroMatchTarget("GOOGLE"), "/company/GOOGLE");
  assert.equal(linkLookups("GOOGLE")?.name, "Alphabet");

  assert.equal(zeroMatchTarget("TSM"), "/company/TSM");
  assert.equal(zeroMatchTarget("BX"), "/company/BX");
});

test("a rewrite the search already covered does not navigate", () => {
  // "Coinbase" contains "COIN", so `q=COIN` returning nothing proves no such
  // row. Navigating would land on the miss surface and the resolve retry would
  // push /company/COIN straight back to it.
  for (const typed of ["COIN", "SHOP", "ARM", "HOOD", "ORACLE", "NVIDIA"]) {
    assert.equal(zeroMatchTarget(typed), null, `${typed} must not navigate`);
    assert.notEqual(linkLookups(typed)?.name, undefined);
  }
});

test("junk the route has no branch for does not navigate", () => {
  for (const typed of ["ZZQQXX", "ASDFGH", "totally not a ticker", "", "   "]) {
    assert.equal(zeroMatchTarget(typed), null, `${typed} must not navigate`);
  }
});

test("a typed percent sign declines rather than throwing URIError", () => {
  // `slugToCompanyName` opens with `decodeURIComponent`. A malformed escape is
  // a person typing a percent sign, and this gate runs inside an `onKeyDown`
  // with no `try`, so a throw here is an uncaught error on a keypress.
  for (const typed of ["100%", "50%off", "a%b", "%", "%zz", "%e0%a4%a"]) {
    assert.equal(zeroMatchTarget(typed), null, `${typed} must decline, not throw`);
  }
});

test("linkLookups reports a slug it cannot decode as an absence", () => {
  assert.equal(linkLookups("100%"), null);
  assert.equal(linkLookups("%"), null);
  // Decoding once can still leave a bare percent, so the second pass is guarded
  // too: "100%25" decodes to "100%", which the next decode rejects.
  assert.equal(linkLookups("100%25"), null);
  // A real slug is unaffected.
  assert.deepEqual(linkLookups("NVDA"), { ticker: "NVDA", name: "NVDA" });
});

test("the directory carries no ticker regex of its own", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../src/app/company/page.tsx", import.meta.url)),
    "utf8",
  );
  // Strip comments before asserting: prose about the gate quotes regexes.
  const inCode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(
    /\/\^\[A-Z\]\{1,\d\}/.test(inCode),
    false,
    "a ticker regex reappeared in the directory; use zeroMatchTarget",
  );
  assert.equal(inCode.includes("zeroMatchTarget(q)"), true);
});
