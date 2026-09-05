/**
 * The ONE definition of "escape a value so PostgREST `ilike` is an exact,
 * case-insensitive match".
 *
 * It lived privately in `src/lib/data-access/aliasResolver.ts`. Extracted rather
 * than copied when `src/lib/company-conflict.ts` needed the same rule: two
 * copies of a normalization is the shape that has repeatedly shipped a check
 * with one side normalized and the other not, and a lost-race recovery that
 * escapes differently from the read path it is recovering into would find
 * nothing and report the company as absent.
 *
 * Measured against the live REST API, read-only, 2026-09-04:
 *   - a literal `%` IS a wildcard, and so is `_`.
 *   - a backslash reaches SQL and escapes the next character: `exxo\_` returns
 *     zero rows where `exxo_` returns one.
 *   - `*` IS a wildcard too, and it CANNOT be escaped here: PostgREST rewrites
 *     `*` to `%` before SQL sees the pattern, so `\*` arrives as `\%`, a literal
 *     percent, which is a different character than the one intended. Callers
 *     must tolerate a name containing `*` matching more rows than it should.
 *   - `ilike` does NOT trim. Trim the needle yourself if the comparison is
 *     meant to stand in for `btrim`.
 *
 * One pass over the character class, so an escape inserted for `\` is never
 * re-scanned and `%` cannot be double-escaped back into a wildcard.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
