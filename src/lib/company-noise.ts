/**
 * company-noise - the one quality gate every company list applies.
 *
 * WHY IT IS ITS OWN FILE, and it is not a taste question. `isNoiseName` used to
 * live in `src/app/api/companies/route.ts` and `src/lib/ask-companies-data.ts`
 * imported it from there, which was correct while the arrow pointed one way.
 * The route now imports the href prover from `ask-companies-data.ts`, so
 * leaving the predicate in the route would make the two modules import each
 * other. An ES module cycle between a route and a lib resolves by hoisting on a
 * good day and by an undefined binding on a bad one, and neither is something
 * to leave standing under a directory that both the desk and Ask read from.
 *
 * The predicate itself is unchanged, byte for byte, and the route still
 * re-exports it under its old name so nothing that imported it has to move.
 */

/**
 * Quality filter for noise rows that survive the SQL-level filters.
 * Pure-noise patterns flagged: all-numeric, all-punctuation, all-lowercase short.
 */
export function isNoiseName(name: string): boolean {
  const trimmed = name.trim();
  // No alphabetic characters -> all-numeric or all-punctuation
  if (!/[A-Za-z]/.test(trimmed)) return true;
  // All-lowercase letters/spaces and shorter than 5 chars (e.g. "abc", "foo")
  if (/^[a-z\s]+$/.test(trimmed) && trimmed.length < 5) return true;
  return false;
}
