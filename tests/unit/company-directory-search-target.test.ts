// Unit tests for where the company directory's search box sends a query that
// matched nothing.
//
// WHY A UNIT TEST AND NOT A BROWSER SPEC. The defect is a NAVIGATION DECISION
// that only fires on the zero-match path, and reproducing it end to end means
// landing on `/company/BRK.B`, which mounts `CompanyAutoResolve` and POSTs
// `/api/company/resolve`, a route that inserts a `companies` row through the
// service-role client. The assertion that matters is "this query does not
// navigate", and it can be made without touching the write path at all.
//
// THE DEFECT. `src/app/company/page.tsx` gated the zero-match navigation on its
// own regex, `/^[A-Z]{1,6}(\.[A-Z]{1,4})?$/`, the widest of the three in the
// repo for one rule. It accepted a dot. `/company/[id]` resolves through
// `aliasResolver.ts`'s `TICKER_RE`, `/^[A-Z]{1,5}$/`, which does not. So BRK.B
// navigated to a slug whose ticker branch could never run, missed the name
// branch too, and told the reader that Berkshire Hathaway is not on Signalera.
// The recovery path closes rather than opens: `resolveOrCreateCompany.ts`'s
// third regex, `/^[A-Z][A-Z.]{0,6}$/`, DOES accept the dot, finds the row,
// returns its ticker, and the client pushes the identical slug.
//
// THE CONTRACT LOCKED HERE:
//
//   BRK.B / BF.B / SHELL.AS -> NO navigation. The route's ticker branch cannot
//                              run on a dotted slug, and on the zero-match path
//                              the name branch has already been searched and
//                              missed
//   NVDA / AAPL / GOOGL / A -> navigates. Plain tickers reach the ticker branch,
//                              which is what opens the on-demand mint path
//   INTC                    -> navigates. CANONICAL rewrites the slug to
//                              "Intel", so it lands through the NAME branch. A
//                              ticker-only check would drop twenty-odd names
//   ZZQQXX / ASDFGH         -> NO navigation. Six characters is outside the
//                              route's ticker branch and there is nothing for
//                              the name branch to find
//   the predicate itself    -> `linkLookups`, imported from `watch-links.ts`.
//                              A fourth regex in this file is the defect, so
//                              the source is asserted to carry none
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { linkLookups } from "../../src/lib/watch-links.ts";

/** The directory's zero-match gate, as `src/app/company/page.tsx` spells it. */
function navigatesTo(typed: string): string | null {
  const q = typed.trim();
  if (!q) return null;
  const upper = q.toUpperCase();
  if (linkLookups(upper)?.ticker) return `/company/${encodeURIComponent(upper)}`;
  return null;
}

test("a dotted ticker does not route into a slug the route cannot resolve", () => {
  for (const typed of ["BRK.B", "brk.b", "BF.B", "SHELL.AS"]) {
    assert.equal(navigatesTo(typed), null, `${typed} must not navigate`);
  }
});

test("a plain ticker still opens the on-demand mint path", () => {
  assert.equal(navigatesTo("NVDA"), "/company/NVDA");
  assert.equal(navigatesTo("aapl"), "/company/AAPL");
  assert.equal(navigatesTo("GOOGL"), "/company/GOOGL");
  assert.equal(navigatesTo("A"), "/company/A");
});

test("a ticker CANONICAL rewrites still navigates, via the name branch", () => {
  // slugToCompanyName("INTC") -> "Intel", so the ticker branch looks up INTEL
  // and misses while the name branch hits. A ticker-only gate would drop it.
  assert.equal(navigatesTo("INTC"), "/company/INTC");
  assert.equal(linkLookups("INTC")?.name, "Intel");
});

test("junk longer than the route's ticker branch does not navigate", () => {
  for (const typed of ["ZZQQXX", "ASDFGH", "totally not a ticker"]) {
    assert.equal(navigatesTo(typed), null, `${typed} must not navigate`);
  }
});

test("the directory carries no ticker regex of its own", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../src/app/company/page.tsx", import.meta.url)),
    "utf8",
  );
  // Strip comments before asserting: the reasoning above the gate QUOTES all
  // three regexes, so a naive scan of the raw source always trips.
  const inCode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(
    /\/\^\[A-Z\]\{1,\d\}/.test(inCode),
    false,
    "a fourth ticker regex reappeared in the directory; use linkLookups",
  );
  assert.equal(inCode.includes("linkLookups"), true);
});
