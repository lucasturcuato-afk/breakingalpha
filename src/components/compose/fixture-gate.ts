/**
 * Compose's fixture gate, and nothing else.
 *
 * This constant is deliberately in its own module, apart from the content it
 * guards. `./fixture` carries an invented draft, an invented note and two
 * invented proposals, and is imported by the server page only, so none of that
 * copy reaches the browser. The gate itself is two environment comparisons
 * with no content in it, so it is safe to evaluate on both sides of the
 * boundary, and it has to be: the page decides whether to build a seed, and
 * `ComposeScreen` re-checks before it opens on anything it was handed.
 *
 * Lifted out of `src/app/compose/page.tsx`, where it was an inline local. One
 * exported constant, imported everywhere, is the version that cannot be
 * forgotten at a second call site.
 *
 * FAILS CLOSED. `empty` carries no invented content: two blank fields and a
 * locked control, which is what a real composer opens on. Every other stage
 * carries a made-up NVDA proposal and a made-up note. This route requires a
 * session in production, so an ungated `?stage=gradeable` would put an
 * invented call in front of a real person on a phone. Both variables are
 * inlined at build time, so the client copy of this check is the same check,
 * not a weaker one. Deletable the day a loader lands.
 */
export const COMPOSE_FIXTURE_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
