/**
 * Ask's fixture gate, and nothing else.
 *
 * This constant is deliberately in its own module, apart from the answers it
 * guards. `./fixture` carries an invented answer citing a call the reader
 * never made, and is imported by the server page only, so none of that copy
 * reaches the browser. The gate itself is two environment comparisons with no
 * content in it, so it is safe to evaluate on both sides of the boundary, and
 * it has to be: the page decides whether to build the data, and both screens
 * re-check before they render anything they were handed.
 *
 * Fixture rendering is allowed in local development and on preview deploys, and
 * nowhere else. Fails closed: an unset NODE_ENV is not production, and any
 * production build that is not a preview gets nothing.
 */
export const ASK_FIXTURE_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
