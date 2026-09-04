/**
 * Which desk routes have a mobile twin, and what happens to the query.
 *
 * Split out of `desk-redirect.tsx` so the mapping and its rules can be tested
 * without mounting a client component. This module imports nothing: no React,
 * no stylesheet, no Next runtime. `desk-redirect.tsx` is the only caller in the
 * app, and `desk-redirect-map.test.ts` is the only other importer.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE QUERY STRING IS DROPPED. READ THIS BEFORE ADDING A ROUTE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `resolveTwinPath` takes a PATH and answers with a bare path literal. Any
 * `?a=b` on the way in is gone on the way out. That is a decision, not an
 * oversight, and `desk-redirect-map.test.ts` pins it so it cannot change by
 * accident.
 *
 * WHY DROPPING IS THE DEFAULT, rather than forwarding. A twin is a DIFFERENT
 * SCREEN, not a narrow rendering of the same one, and it has its own parameter
 * vocabulary. `/trends` and `/trends-mobile` do not share a filter model.
 * `/radar/desk-record` and `/desk-record` both understand `?stage=`, but behind
 * different gates with different reachability. Forwarding blindly would carry a
 * parameter onto a screen that never agreed to honour it, and the failure that
 * produces is WORSE than a drop: a dropped parameter renders the twin's honest
 * default, while a misread one renders a wrong screen that looks like a working
 * one. A drop is visible to whoever is looking for the parameter. A
 * misinterpretation is not.
 *
 * WHY FORWARDING WOULD NOT HAVE SAVED THE CASE THAT PROMPTED THIS EITHER.
 * The danger is a parameter that carries a WRITE, of the kind the outgoing
 * brief email puts in a call to action. Forwarding it to a twin that does not
 * read it loses the action just as completely as dropping it does, and does it
 * while looking like it worked. A parameter that must survive needs the TWIN to
 * implement it, which is a per-route decision belonging to whoever adds the
 * route.
 *
 * SO, IF YOU ARE ADDING A SIXTH ROUTE, answer this first:
 *
 *   1. Does the desk route read `searchParams`, or does anything link to it
 *      with a query? Check the outgoing email templates too, not just the app.
 *   2. If yes, does the twin read the same parameter, with the same meaning?
 *   3. If it does not, DO NOT ADD THE ROUTE HERE until it does. A redirect that
 *      silently discards a write is not a mobile treatment, it is a dropped
 *      action.
 *
 * Verified on `beca56cf`: none of the five routes below reads `searchParams`,
 * and nothing in the app links to any of them with a query, so the drop is
 * inert today. It is pinned by test so it stays a choice.
 */

/**
 * Desk route to mobile twin.
 *
 * Every value was opened and read before it was written here. Keys are matched
 * EXACTLY, never by prefix, which is what keeps `/company/[id]` alive: the
 * `/company` directory has a twin at `/ask`, while a company screen has its own
 * mobile treatment and must not be redirected.
 *
 * `/radar/following` IS DELIBERATELY ABSENT. It is the only surface in the app
 * that writes a follow, and no per-object follow toggle exists anywhere, so
 * redirecting it would remove the capability rather than move it. It was also
 * the least damaged route in the bucket: no horizontal overflow, no tab bar
 * collision, only the shared desk chrome. Owner ruling of 2026-09-03. Adding it
 * back is a product decision, not a completeness fix, and it becomes correct
 * only once a mobile follow control exists.
 */
export const DESK_TO_TWIN: Readonly<Record<string, string>> = {
  "/morning-brief": "/ledger",
  "/trends": "/trends-mobile",
  "/radar/desk-record": "/desk-record",
  "/radar/watchlist": "/watch/watchlist",
  "/company": "/ask",
};

/**
 * The `md` breakpoint, as a media query.
 *
 * PAIRED WITH `desk-redirect.module.css`, which repeats this width, and the two
 * must not drift. A width where the stylesheet hides the desk screen but the
 * component declines to navigate is a blank page with no way off it. It is
 * written twice because a CSS module cannot read a TypeScript constant, and the
 * comment in each file names the other.
 */
export const PHONE_WIDTH = "(max-width: 767.98px)";

/**
 * The twin for a desk path, or null when the path is not redirected.
 *
 * Takes a PATH, and the parameter name says so. Handing it a full URL or a
 * path with a query answers null rather than guessing, because a caller that
 * has a query in its hand is a caller who has not read the policy above.
 */
export function resolveTwinPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  return DESK_TO_TWIN[pathname] ?? null;
}
