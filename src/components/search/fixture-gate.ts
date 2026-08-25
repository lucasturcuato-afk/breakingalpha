/**
 * Search's fixture gate, and nothing else.
 *
 * This constant is deliberately in its own module, apart from the results it
 * guards. `./fixture` carries an invented result set and is imported by the
 * server page only, so none of that copy reaches the browser. The gate itself
 * is two environment comparisons with no content in it, so it is safe to
 * evaluate on both sides of the boundary, and it has to be: the page decides
 * whether to build the result set, and `SearchScreen` re-checks before it
 * matches anything it was handed.
 *
 * There is no search backend. `GET /api/companies?q=` covers companies only,
 * `/api/company-search` is a Clearbit autocomplete proxy, and nothing in the
 * repo searches a user's own entries or the deal table. Until one route
 * answers all three, the typed state is invented data and must not reach a
 * production reader.
 *
 * Fails closed: anything that is not development and not an explicit preview
 * deploy is treated as production.
 *
 * With the gate closed the screen draws its `unwired` state, NOT a skeleton
 * and NOT an empty result. A skeleton would say something is on its way when
 * nothing is coming, which is the same shape of untruth as claiming a search
 * found nothing. See `search-screen.tsx`.
 */
export const SEARCH_FIXTURE_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
