/**
 * ONE definition of "this name names that company", for every read path that
 * decides company identity from two strings.
 *
 * WHAT THIS REPLACES, AND WHY IT IS ONE FUNCTION AND NOT THREE
 * -----------------------------------------------------------
 * Three call sites answered that question with a bare `.includes()`:
 *
 *   src/lib/watchlist-title-precision.ts  companyCorroborates
 *   src/app/radar/watchlist/page.tsx      the short-company early return
 *   src/lib/radar-following.ts            (no in-memory check at all; the
 *                                          unanchored ILIKE was the decision)
 *
 * A bare `.includes()` accepts a match that STARTS IN THE MIDDLE OF A WORD, and
 * that is not evidence of identity. Measured by replaying the live desk query
 * for every distinct watchlist entry: a "GS" entry was served every article
 * whose primary_company merely ends in "Holdings", because "gs" sits inside the
 * word; "PL" was served Apple, Accenture and Dentsply; "META" was served Metalla
 * Royalty and T2 Metals. None of those rows is about the company the reader
 * asked for, and the reader is given no way to tell.
 *
 * The narrower half of that pair was already correct and had been for a while.
 * `titleMentionIsGenuine`, in the same file as `companyCorroborates`, written by
 * the same hand, checks the SAME question against the title with alphanumeric
 * lookarounds so a token boundary is required. Its sibling checking
 * primary_company did not, and because `companyCorroborates` SHORT-CIRCUITS the
 * filter, the anchored half never ran on any row the unanchored half accepted.
 * One fact, two paths, one of them guarded.
 *
 * THE RULE, AND IT IS DELIBERATELY THE SMALLEST ONE THAT CLOSES THE HOLE
 * ---------------------------------------------------------------------
 * Both sides are lowercased and reduced to alphanumeric tokens. The term's
 * tokens must align to a CONTIGUOUS RUN of the name's tokens, every token equal
 * to its counterpart except the LAST, which may instead be a PREFIX of its
 * counterpart.
 *
 *   "nasdaq"        names "Nasdaq, Inc."          exact token
 *   "cola"          names "Coca-Cola"             exact token, see the note below
 *   "googl"         names "Google"                prefix of the last token
 *   "goldman sachs" names "Goldman Sachs Group"   contiguous run
 *   "ola"           does NOT name "Motorola"      starts inside the word
 *   "ola"           does NOT name "Coca-Cola"     starts inside the word
 *   "gs"            does NOT name "PDD Holdings"  starts inside the word
 *
 * NO LENGTH FLOOR, AND THE FLOOR IS THE MISTAKE THIS RULE IS THE SECOND
 * VERSION OF. The first draft required six characters before allowing a token
 * prefix, on the precedent of `web-memo-entity.DOMINANT_TOKEN_MIN_LEN`. The
 * same prod replay that found the "GS" defect also found what the floor cost:
 * a GOOGL watchlist entry lost every Google article in the corpus, and a PL
 * entry lost Planet Labs. Both are prefixes, not interior hits. A floor is a
 * proxy for the property; the property itself is "never starts inside a word",
 * and it is cheaper to state directly than to approximate.
 *
 * WHAT THIS DOES NOT DO. It is not a similarity score and it does not judge
 * whether a prefix match is the RIGHT company: "meta" still reaches "Metalla
 * Royalty" and "pl" still reaches "Accenture PLC", exactly as before this
 * change. Those are prefix collisions between a bare exchange symbol and a
 * name, they need a resolved company name rather than a string rule to fix, and
 * widening this predicate to guess at them would be the same mistake as the
 * floor. Every rejection here is a match that began mid-word.
 *
 * IT CAN ONLY NARROW. Every caller applies it to rows a query has already
 * returned, so a stricter answer removes rows and can never add one.
 */

/** Lowercase, every run of non-alphanumerics to one space, trimmed. */
export function normalizeForTokenMatch(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The token sequence `nameContainsTerm` compares. Exported for tests. */
export function tokensForMatch(value: string | null | undefined): string[] {
  const n = normalizeForTokenMatch(value);
  return n ? n.split(" ") : [];
}

/**
 * Does `name` name the company `term` refers to?
 *
 * True when the term's tokens align to a contiguous run of the name's tokens,
 * with only the final term token allowed to be a prefix rather than an exact
 * match. A term can therefore never begin in the middle of one of the name's
 * words, which is the single property this function exists to hold.
 */
export function nameContainsTerm(
  name: string | null | undefined,
  term: string | null | undefined,
): boolean {
  const hay = tokensForMatch(name);
  const needle = tokensForMatch(term);
  if (hay.length === 0 || needle.length === 0) return false;
  if (needle.length > hay.length) return false;

  const last = needle.length - 1;
  for (let offset = 0; offset + needle.length <= hay.length; offset++) {
    let ok = true;
    for (let i = 0; i < needle.length; i++) {
      const a = needle[i];
      const b = hay[offset + i];
      // Every token but the last must be equal. The last may be a prefix, so a
      // truncated symbol ("googl") reaches its name ("Google") and a shortened
      // legal form ("inc") reaches its long form ("incorporated").
      if (i === last ? !b.startsWith(a) : a !== b) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** True when any of `terms` names the company `name` refers to. */
export function nameContainsAnyTerm(
  name: string | null | undefined,
  terms: readonly string[],
): boolean {
  return terms.some((term) => nameContainsTerm(name, term));
}
