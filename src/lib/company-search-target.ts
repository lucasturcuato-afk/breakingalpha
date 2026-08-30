import { linkLookups } from "@/lib/watch-links";

/**
 * Where the company directory's search box sends a query that MATCHED NOTHING.
 *
 * A module rather than a closure inside `src/app/company/page.tsx`, and the
 * reason is that the last version of this decision could only be tested by
 * retyping it: the gate lived inline in an `onKeyDown` on a 900-line
 * `"use client"` page, so its unit test restated the rule and passed against a
 * tree that did not contain it. The decision is pure, so it lives where a test
 * can import the ACTUAL predicate.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS ANSWERS, AND WHAT IT DOES NOT.
 *
 * NOT "does this company exist". On the zero-match path we already know the
 * answer is no for the string as typed: `/api/companies?q=` ran
 * `name.ilike.%q% OR ticker.ilike.%q%` and returned no rows. The question left
 * is narrower and is about the DESTINATION:
 *
 *   if we push /company/<typed>, can that page terminate on a company, or is
 *   it a surface the reader cannot get out of?
 *
 * The miss surface is not a dead end by itself. `CompanyAutoResolve` mounts
 * beside it, POSTs `/api/company/resolve`, and on a hit or create pushes
 * `/company/<row.ticker>`. THAT push is the thing that has to land, and it is
 * where the defect lived: for BRK.B the resolve route's own wider regex,
 * `/^[A-Z][A-Z.]{0,6}$/`, finds Berkshire, returns ticker "BRK.B", the client
 * pushes the IDENTICAL slug, the route misses it again, and the
 * sessionStorage guard blocks a third attempt. The loop closes rather than
 * recovers.
 *
 * HOW THE ROUTE READS A SLUG, because the gate has to mirror it exactly and
 * the obvious model of it is wrong. `/company/[id]/page.tsx` RECONSTRUCTS
 * FIRST and hands the result to `getCompanyDetail`, so `resolveAlias` never
 * sees the raw slug:
 *
 *   page.tsx      canonicalize(slugToCompanyName(id))        <- reconstruction
 *   resolveAlias  TICKER_RE on THAT string, then a second reconstruction and
 *                 a case-insensitive exact name match
 *
 * So the ticker branch tests the RECONSTRUCTION, not the slug. `/company/INTC`
 * queries `companies.ticker = 'INTEL'`, because `CANONICAL.intc` is "Intel".
 * That is measured, not assumed: aliasResolver.ts:125 tests `input`, and
 * page.tsx:178 is what builds `input`. `linkLookups` runs exactly that
 * pipeline, imported from `watch-links.ts` rather than approximated, which is
 * the whole reason it is shared.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE TWO CLAUSES, AND WHY NEITHER ONE ALONE IS THE RULE.
 *
 * A. THE RETRY PUSH LANDS DETERMINISTICALLY. `linkLookups(...).ticker` is
 *    non-null, which is the resolver's own `TICKER_RE` run on the
 *    reconstruction, AND the reconstruction is the typed string unchanged. Both
 *    halves are load-bearing. The retry pushes the ticker the resolve route
 *    returned, which for a ticker query is the typed string, so the route has
 *    to be able to look THAT string up as a ticker. When CANONICAL rewrites it
 *    the lookup is performed on the rewrite instead and the branch is querying
 *    a ticker nobody has: `/company/INTC` asks for ticker "INTEL", finds
 *    nothing, and only reaches Intel through the name branch below. A gate
 *    that passed INTC on `TICKER_RE` alone was passing it because "INTEL"
 *    happens to be five letters, which is a fact about the alphabet and not
 *    about whether the page can land.
 *
 * B. THE NAME BRANCH HAS A CANDIDATE THE SEARCH NEVER LOOKED FOR. CANONICAL
 *    rewrote the slug into a string that does NOT contain what was typed, so
 *    the zero-match is no evidence about it. `/api/companies?q=GOOGLE` proves
 *    no row's name or ticker contains "google"; it proves nothing about
 *    "Alphabet", which is the exact string `/company/GOOGLE` looks up. Same
 *    for INTC -> Intel, TSM -> Taiwan Semiconductor, BX -> Blackstone. Where
 *    the rewrite CONTAINS the typed string the search has already ruled it
 *    out: `q=COIN` returning nothing means no name contains "coin", so
 *    "Coinbase" is not there either, and navigating would put the reader on
 *    the miss surface with the resolve retry pushing /company/COIN straight
 *    back to it.
 *
 * WHAT IT STILL CANNOT PROMISE, stated rather than implied. Clause B opens a
 * page that may still miss, because "may exist" is the strongest claim a
 * client with no read can make. What both clauses buy is that the reader is
 * never sent somewhere whose ONLY outcome is the same surface again.
 *
 * WIDENING `aliasResolver`'s `TICKER_RE` to accept the dot is the fix that
 * would make BRK.B land everywhere rather than merely decline here, and it is
 * issue 738. It is a shared resolver on every company-resolving route and
 * wants its own blast-radius check, not a ride on this one.
 */
export function zeroMatchTarget(typed: string): string | null {
  const q = typed.trim();
  if (q.length === 0) return null;
  const upper = q.toUpperCase();

  /* null covers two inputs: an empty reconstruction, and a slug
     `decodeURIComponent` cannot read. The second one is a person typing a
     percent sign ("100%", "50%off"), which used to reach `URIError` through
     this call and take the keypress handler down with it. It is not a company,
     so it declines like any other non-match and the reader sees the same
     nothing they would have seen anyway. */
  const lookups = linkLookups(upper);
  if (lookups === null) return null;

  const rewritten = lookups.name.toUpperCase() !== upper;
  const path = `/company/${encodeURIComponent(upper)}`;

  // A: the resolve retry's ticker push can be looked up as a ticker.
  if (!rewritten && lookups.ticker !== null) return path;

  // B: CANONICAL points at a name the directory's substring search never ran.
  if (rewritten && !lookups.name.toUpperCase().includes(upper)) return path;

  return null;
}
