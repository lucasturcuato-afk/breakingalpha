/**
 * The recency window the watchlist counts against, in days.
 *
 * `WatchlistGallery.tsx` line 155 filters at two days and says "in the last two
 * days"; the mobile design's collapse says "No news today". The copy and the
 * window have to agree, so mobile ships at one day and says today. Flagged in
 * the PR body as an unresolved product difference with the desktop surface.
 *
 * It lives HERE rather than in `fixture.ts` because `watch-screen.tsx` is a
 * client component and needs the value at runtime. A value import out of a
 * module whose path names it a fixture is exactly what design-lint rule
 * `fixture-in-client-bundle` exists to stop, and the rule is right: the import
 * that carries this constant would carry the invented prose beside it into
 * `.next/static`. This module carries the constant and nothing else.
 */
export const WATCH_RECENCY_DAYS: number = 1;
