/**
 * The banned shapes, in one place.
 *
 * These regexes used to be three local consts inside dashboard-honesty.test.ts
 * and were applied only to strings authored by src/lib/desk-record.ts and
 * src/lib/your-record.ts. That scoping is how
 * `53W · 50L · 41 partial · 37% hit rate` shipped on /morning-brief for months
 * while a test in the same repo asserted that a component deleted for exactly
 * that format stays deleted. The detectors were right. Their reach was not.
 *
 * They live here so the model-level assertions and the rendered-output
 * assertions in reader-output-honesty.test.ts cannot drift apart, which is the
 * same argument DESK_RECORD_COPY makes about the vocabulary itself.
 *
 * Not a .test.ts on purpose: `npm run test:unit` globs `**\/*.test.ts`.
 */

/** `53W`, `50 L`, `W/L`, `W / L`. Sports shorthand for an outcome. */
export const WL_SHORTHAND = /\b\d+\s*[WL]\b|\b[WL]\s*\/\s*[WL]\b|\bW\/L\b/;

/** Any percentage figure at all. Correct for a record surface, where every
 *  percentage is an aggregate. NOT correct for a price move, so callers that
 *  render quotes must not reach for this one. */
export const ANY_PERCENT = /\d\s*%|percent\b/i;

/** Vocabulary that frames a graded call as a game rather than as evidence. */
export const SPORTS_WORDS =
  /\b(win rate|hit rate|wins|losses|record of wins|winning|hit-rate)\b/i;

/**
 * Strip line and block comments so a source scan reads what ships, not what a
 * file says ABOUT what ships. Several components carry comments naming the
 * banned formats in order to explain why they are absent, and a scan that
 * cannot tell those apart from a live string is a scan nobody can leave on.
 *
 * Deliberately crude: it does not model strings containing comment markers.
 * A URL inside a literal loses its tail, which costs nothing here because the
 * detectors do not match URLs.
 */
export function stripComments(source: string): string {
  return source
    // Newlines are preserved so a reported line number is the real one.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
