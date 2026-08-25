/**
 * The fixture gate, and nothing else.
 *
 * This constant is deliberately in its own module, apart from the rows it
 * guards. `fixture.ts` carries invented cluster prose and is imported by the
 * server page only, so none of that copy reaches the browser. The gate itself
 * is two environment comparisons with no content in it, so it is safe to
 * evaluate on both sides of the boundary, and it has to be: the server page
 * decides whether to build the rows, and `TrendsScreen` re-checks before it
 * renders anything it was handed.
 *
 * FAILS CLOSED. Anything that is not a development build, a test run or an
 * explicit Vercel preview gets `false`, which sends the screen to the live
 * loader and its loading state. Both variables are inlined at build time, so
 * the client copy of this check is the same check, not a weaker one.
 *
 * THIS IS THE ONLY DEFENCE, not the second one. `MOBILE_REDESIGN_DEV_PATHS` in
 * `src/proxy.ts` is not a fixture gate and never restricts anything; it only
 * ever opens routes. Read `isMobileRedesignDevPath` (`src/proxy.ts:75-82`)
 * against the two branches that consume it:
 *
 * - In DEV and PREVIEW the predicate is true, which makes the path public.
 *   `if (!user && ... && !isPublicPath)` therefore lets a signed-out reader
 *   through, and `if (user && ... && !isPublicPath)` skips the beta allowlist
 *   check outright for a signed-in one.
 * - In PRODUCTION the predicate is false, so the route falls back to the
 *   ordinary auth and beta-allowlist gates.
 *
 * That production gating keeps strangers off the route. It does nothing about
 * the fixture. Every signed-in, allowlisted reader reaches `/trends-mobile` on
 * a production deployment, and the proxy never inspects which rows the screen
 * is about to draw. If this constant were wrong, those readers would be served
 * three invented clusters as though they were the tape. Nothing upstream will
 * stop that, so nothing downstream may assume something else already did.
 */
export const FIXTURE_ALLOWED =
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "test" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
