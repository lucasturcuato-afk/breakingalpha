/**
 * TS mirror of backend/normalize.py `normalize_lookup_key` (W2-A alias
 * resolution). Keep the two in lockstep: this computes `aliases.lookup_key`,
 * and an on-demand insert MUST produce the same key the pipeline would, or the
 * dedup index silently diverges and duplicates creep back in.
 *
 * Order matters (same as the Python):
 *   1. Strip TM / R / C symbols BEFORE NFKC (NFKC folds them to ASCII, which
 *      would concatenate onto the preceding token and defeat dedup).
 *   2. NFKC: full-width -> ASCII, ligature decomposition.
 *   3. Fold curly quotes (NFKC does not).
 *   4. Trim + lowercase. Possessives and accents are preserved.
 */
export function normalizeLookupKey(s: string): string {
  let out = s
    .replace(/™/g, "")
    .replace(/®/g, "")
    .replace(/©/g, "");
  out = out.normalize("NFKC");
  out = out.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  return out.trim().toLowerCase();
}
