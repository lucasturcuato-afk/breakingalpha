/**
 * TS mirror of backend/edgar/name_agreement.py. Keep the two in lockstep:
 * this is the same policy that gates every backend write of an identifier
 * onto a company row, and the on-demand resolver must not be able to write a
 * pairing the pipeline would refuse.
 *
 * DESIGN RULE: FAIL OPEN. No authority name means no opinion, and the write
 * proceeds. The gate governs WRITES ONLY and never clears an existing value,
 * so a rejection costs a MISSING identifier, never a WRONG one.
 *
 * The shared fixture list lives in both test files:
 *   src/lib/name-agreement.test.ts
 *   backend/tests/test_cik_stamp_name_agreement.py
 */

// Pure legal-form tokens. No identity in ANY name.
const LEGAL = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
  "ltd", "limited", "plc", "llc", "lp", "sa", "nv", "ag", "se", "ab", "as",
  "spa", "the", "class", "common", "stock", "and", "of",
]);

// Weak-identity tokens: dropped for set comparison, KEPT for the acronym
// test where they still contribute an initial (the I of IBM).
const WEAK = new Set([
  "holdings", "holding", "group", "trust", "intl", "international", "new",
]);

const SUFFIXES = new Set([...LEGAL, ...WEAK]);

export const RATIO_ACCEPT = 0.8;
export const MIN_SHARED_TOKENS = 2;
export const MIN_ACRONYM_LEN = 3;
export const MAX_HEAD_PREFIX_EXTRA = 1;

/** Ordered tokens: trailing "/QUALIFIER" dropped, punctuation stripped, then
 * `drop` and every single-character token removed. Single characters are
 * debris from stripping the dots out of "S.A." and "N.V.", never identity. */
function tokens(name: string, drop: Set<string>): string[] {
  const n = (name || "")
    .toLowerCase()
    .replace(/\/.*$/, " ")
    .replace(/[^a-z0-9 ]/g, " ");
  return n.split(" ").filter((t) => t.length > 1 && !drop.has(t));
}

function normalizeTokens(name: string): Set<string> {
  return new Set(tokens(name, SUFFIXES));
}

/**
 * Faithful port of Python difflib.SequenceMatcher(None, a, b).ratio().
 * Both inputs are short joined company names, so autojunk never engages and
 * there is no junk predicate. The score is 2*M/T over the recursively
 * computed matching blocks, which is NOT the longest common subsequence, so
 * an approximation here would silently desync the two implementations right
 * at the 0.80 threshold.
 */
export function difflibRatio(a: string, b: string): number {
  const total = a.length + b.length;
  if (!total) return 1;

  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const arr = b2j.get(b[j]);
    if (arr) arr.push(j);
    else b2j.set(b[j], [j]);
  }

  function longestMatch(
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): [number, number, number] {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize++;
    }
    return [besti, bestj, bestsize];
  }

  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longestMatch(alo, ahi, blo, bhi);
    if (!k) continue;
    matches += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return (2 * matches) / total;
}

function acronymOf(short: Set<string>, longSeq: string[]): boolean {
  if (short.size !== 1) return false;
  const s = [...short][0];
  if (s.length < MIN_ACRONYM_LEN || s.length !== longSeq.length) return false;
  const initials = longSeq
    .map((t) => t[0])
    .sort()
    .join("");
  return initials === [...s].sort().join("");
}

/** Our raw tokens form a LEADING run of the authority's raw tokens AND the
 * authority adds at most MAX_HEAD_PREFIX_EXTRA identity tokens. The
 * positional test uses RAW tokens so a brand that genuinely ends in a legal
 * form ("Urban Company" vs "URBAN OUTFITTERS INC") cannot pose as a prefix. */
/** `shorter`'s raw token sequence is a LEADING run of `longer`'s. Raw tokens,
 * nothing dropped but single-character debris, for the reason on
 * headPrefixAgrees. */
function isLeadingRun(shorter: string, longer: string): boolean {
  const s = tokens(shorter, new Set<string>());
  const l = tokens(longer, new Set<string>());
  if (!s.length) return false;
  return l.slice(0, s.length).join(" ") === s.join(" ");
}

function headPrefixAgrees(ourName: string, authorityName: string): boolean {
  const ours = tokens(ourName, new Set<string>());
  const theirs = tokens(authorityName, new Set<string>());
  if (!ours.length) return false;
  if (theirs.slice(0, ours.length).join(" ") !== ours.join(" ")) return false;
  const ourIdent = normalizeTokens(ourName);
  let extra = 0;
  for (const t of normalizeTokens(authorityName)) if (!ourIdent.has(t)) extra++;
  return extra <= MAX_HEAD_PREFIX_EXTRA;
}

export type Agreement = { agrees: boolean; reason: string };

/** FAIL OPEN when either side carries no identity. */
export function namesAgree(
  ourName: string,
  authorityName: string | null | undefined,
): Agreement {
  if (!authorityName || !String(authorityName).trim()) {
    return { agrees: true, reason: "fail-open: no authority name" };
  }
  const ours = normalizeTokens(ourName);
  const theirs = normalizeTokens(authorityName);
  if (!ours.size) {
    return {
      agrees: true,
      reason: "fail-open: our name has no identity tokens",
    };
  }
  if (!theirs.size) {
    return {
      agrees: true,
      reason: "fail-open: authority name has no identity tokens",
    };
  }

  const sortedOurs = [...ours].sort();
  const sortedTheirs = [...theirs].sort();
  if (sortedOurs.join(" ") === sortedTheirs.join(" ")) {
    return { agrees: true, reason: "token sets equal" };
  }

  const shared = sortedOurs.filter((t) => theirs.has(t)).length;
  const oursSubset = sortedOurs.every((t) => theirs.has(t));
  const theirsSubset = sortedTheirs.every((t) => ours.has(t));
  if ((oursSubset || theirsSubset) && shared >= MIN_SHARED_TOKENS) {
    // BOUNDED, for the same reason headPrefixAgrees is bounded. An unbounded
    // subset accepts "Energy Capital" inside "El Paso Energy Capital Trust I",
    // a private PE firm matched to a preferred-share trust, and that is how
    // EP PR C reached a companies row. Accept when the longer name adds almost
    // nothing, OR when the shorter one LEADS it. Position is what rejects the
    // "Vanguard" inside "AMERICAN VANGUARD CORP" shape.
    const [shorter, longer] = oursSubset
      ? [ourName, authorityName]
      : [authorityName, ourName];
    const smaller = oursSubset ? ours : theirs;
    const bigger = oursSubset ? theirs : ours;
    let extra = 0;
    for (const t of bigger) if (!smaller.has(t)) extra++;
    if (extra <= MAX_HEAD_PREFIX_EXTRA || isLeadingRun(shorter, longer)) {
      return { agrees: true, reason: `subset with ${shared} shared tokens` };
    }
  }

  const ratio = difflibRatio(sortedOurs.join(" "), sortedTheirs.join(" "));
  // Truncate rather than round for display: Python's format() rounds
  // half-to-even and toFixed does not, so an exact 0.625 would render
  // differently on the two sides and break the reason-string parity test.
  const shown = (Math.trunc(ratio * 100) / 100).toFixed(2);
  if (ratio >= RATIO_ACCEPT) {
    return { agrees: true, reason: `ratio ${shown}` };
  }

  const oursSeq = tokens(ourName, LEGAL);
  const theirsSeq = tokens(authorityName, LEGAL);
  if (acronymOf(ours, theirsSeq) || acronymOf(theirs, oursSeq)) {
    return { agrees: true, reason: "acronym" };
  }

  if (headPrefixAgrees(ourName, authorityName)) {
    return {
      agrees: true,
      reason: "head prefix, authority adds <= 1 identity token",
    };
  }

  return {
    agrees: false,
    reason: `disagree (shared=${shared} ratio=${shown})`,
  };
}
