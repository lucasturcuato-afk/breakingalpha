/**
 * Entity name normalization for W2-A alias resolution.
 * See docs/w2-a-entity-resolution-design.md section 6 for spec.
 *
 * MUST stay logically identical to backend/normalize.py.
 * Test fixtures match between languages.
 */
export function normalizeLookupKey(s: string): string {
  s = s.replace(/[\u2122\u00ae\u00a9]/g, "");
  s = s.normalize("NFKC");
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  return s.trim().toLowerCase();
}
