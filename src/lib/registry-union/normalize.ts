/**
 * Name normalization for the read-only registry union.
 *
 * Kept in lockstep with the offline builder (scripts/registry-union/ukey.py).
 * Pure, no I/O, no framework. Both keys are derived the same way for the
 * registrant side at BUILD time and the typed side at REQUEST time, which is
 * the only reason a plain map lookup is a safe substitute for a matcher.
 */

// EDGAR writes the state/vintage marker into the registrant name:
//   'BANK OF AMERICA CORP /DE/', 'LENNAR CORP /NEW/', 'QUALCOMM INC/DE',
//   'TOYOTA MOTOR CORP/'. Left in place the listed parent's name never equals
//   the plain legal name, and an exact lookup falls through to a dormant
//   same-named predecessor.
const EDGAR_MARK = /\s*\/\s*[A-Za-z]{0,4}\s*\/?\s*$/;

/** Pure legal-form tokens. These carry no identity in any name. */
const LEGAL = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies", "cos",
  "ltd", "limited", "plc", "llc", "lp", "llp", "lllp", "sa", "sab", "nv", "bv", "ag",
  "se", "ab", "as", "asa", "oyj", "spa", "gmbh", "kgaa", "pte", "pty", "kk",
  "kabushiki", "aktiengesellschaft", "sas", "srl", "ulc", "fsb", "na", "the", "cv",
  "oy", "aps",
]);

/**
 * Weak-identity tail words. Removed only to form the WEAK key, never the
 * strong one, so 'Goldman Sachs' can reach 'The Goldman Sachs Group, Inc.'.
 *
 * Kept deliberately short. An earlier draft also listed industries /
 * enterprises / partners / global, which strips identity rather than
 * structure: 'CF Industries Holdings' collapsed all the way to 'cf', and
 * 'Insight Partners' (a growth-equity firm) collided with 'INSIGHT
 * ENTERPRISES INC' (an IT reseller) on the shared remnant 'insight'.
 */
const WEAK_TAIL = new Set(["holdings", "holding", "group", "groupe", "worldwide", "international"]);

/**
 * Legal-form CLASS. Two names that each name a legal form, and name DIFFERENT
 * ones, are not the same registrant. This is the rule that stops 'EQT AB' (the
 * Swedish private-equity firm; 'ab' is a legal form, so the key reduces to
 * 'eqt') from landing on 'EQT Corp' (NYSE: EQT, natural gas). When only one
 * side names a form, or neither does, the rule stays silent.
 */
const FORM_CLASS: Record<string, string> = {};
for (const [cls, forms] of Object.entries({
  uscorp: ["inc", "incorporated", "corp", "corporation", "co", "company", "companies", "cos"],
  llc: ["llc", "ulc"],
  lp: ["lp", "llp", "lllp"],
  ltd: ["ltd", "limited"],
  plc: ["plc"],
  sa: ["sa", "sab", "sas"],
  nv: ["nv"],
  bv: ["bv"],
  ag: ["ag", "aktiengesellschaft", "kgaa"],
  se: ["se"],
  ab: ["ab"],
  as: ["as", "asa", "aps"],
  oy: ["oy", "oyj"],
  spa: ["spa", "srl"],
  gmbh: ["gmbh"],
  pte: ["pte"],
  pty: ["pty"],
  kk: ["kk", "kabushiki"],
  bank: ["na", "fsb"],
  cv: ["cv"],
})) {
  for (const f of forms) FORM_CLASS[f] = cls;
}

export function stripMarker(s: string): string {
  let prev: string | null = null;
  let out = s ?? "";
  while (prev !== out) {
    prev = out;
    out = out.replace(EDGAR_MARK, "").trim();
  }
  return out;
}

function tokens(name: string): string[] {
  let s = stripMarker(name ?? "");
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  // '&' collapses to a SPACE, not to the word "and". Expanding it inserts a
  // token that then blocks legal-form stripping at the tail: 'JPMORGAN CHASE &
  // CO' would key as 'jpmorgan chase and' and never match the typed
  // 'JPMorgan Chase'.
  s = s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ");
  return s.split(" ").filter(Boolean);
}

/** Legal forms stripped from the tail; every identity word kept. */
export function strongKey(name: string): string {
  const t = tokens(name);
  while (t.length && t[0] === "the") t.shift();
  while (t.length && LEGAL.has(t[t.length - 1])) t.pop();
  return t.join(" ");
}

/** strongKey minus trailing weak-identity words. Multi-token names only. */
export function weakKey(name: string): string {
  const t = strongKey(name).split(" ").filter(Boolean);
  while (t.length && WEAK_TAIL.has(t[t.length - 1])) t.pop();
  return t.join(" ");
}

/** The legal-form class named at the tail of `name`, or null. */
export function formClass(name: string): string | null {
  const t = tokens(name);
  while (t.length && t[0] === "the") t.shift();
  if (!t.length) return null;
  return FORM_CLASS[t[t.length - 1]] ?? null;
}
