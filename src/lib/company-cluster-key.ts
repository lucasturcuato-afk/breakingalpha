/**
 * TS port of `normalize_company_key` in backend/company_match.py, which is
 * itself a port of `norm_v2.lookup_key_v2` in
 * sql/proposals/0020_normalize_lookup_key_v2.sql.
 *
 * READ-ONLY comparison key. Never store this value, never use it as an alias
 * lookup_key. Its ONE job here is to answer "do these two surface forms name
 * the same company?" so the article-cluster expansion can widen a query
 * WITHOUT dragging a different company onto the page.
 *
 * Why this matters concretely: `companies.ticker` is contaminated. Ticker RGTI
 * carries both "Gett" and "Rigetti"; ASTH carries "Stran" and "Astrana
 * Health"; CVLT carries "MMV" and "Commvault Systems"; GBTC carries "SCA" and
 * "Bitcoin"; CHX carries "CHAMP" and "ChampionX"; DJT carries "Trump" and
 * "Trump Media"; BCG carries "BCG" and "Kingswood". Expanding the article
 * filter to every row that shares a ticker would pull wrong-company articles
 * onto the canonical page, which is worse than the under-matching it fixes.
 * Every candidate surface form is therefore gated on key equality with the
 * head before it is allowed into the predicate.
 *
 * If you change this, change backend/company_match.py too. One definition of
 * "same company" in the project.
 */
import { normalizeLookupKey } from "@/lib/normalize-lookup-key";

/** Verbatim from norm_v2.lookup_key_v2 (sql/proposals/0020). */
export const BASE_SUFFIXES = [
  "inc", "incorporated", "corp", "corporation", "co", "company", "llc",
  "ltd", "limited", "plc", "sa", "ag", "nv", "ab", "holdings", "group",
] as const;

/**
 * DIVERGENCE FROM 0020, mirrored from backend/company_match.py where each
 * token was kept only because it measurably resolved additional rows.
 */
export const EXTRA_SUFFIXES = ["se", "spa", "oyj", "asa", "pte", "pty"] as const;

/**
 * The leading \s+ is load-bearing: a single-token name that IS a suffix word
 * ("Group") can never be emptied by the strip loop.
 */
const SUFFIX_RE = new RegExp(
  `\\s+(${[...BASE_SUFFIXES, ...EXTRA_SUFFIXES].join("|")})$`,
);

/** Deleted outright so "Inc." -> "inc" and "Moody's" -> "moodys". */
const PUNCT_TO_DELETE_RE = /[.'’]/g;

/**
 * Python `string.punctuation` spelled out as ASCII ranges rather than \W, so
 * accented letters survive (v1 keeps "Estee Lauder" accented).
 * !"#$%&'()*+,-./  :;<=>?@  [\]^_`  {|}~
 */
const PUNCT_TO_SPACE_RE = /[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/g;

const SUFFIX_PASSES = 3;

/**
 * Fold a company surface form onto a comparison key: v1 normalization, then
 * delete dots/apostrophes, then other punctuation to space, then collapse
 * whitespace, then strip trailing corporate suffixes (up to 3 passes).
 *
 * Never returns "" for non-empty input.
 *
 * @example
 *   normalizeCompanyKey("Bank of America Corp")   // "bank of america"
 *   normalizeCompanyKey("Wells Fargo & Company")  // "wells fargo"
 *   normalizeCompanyKey("Targa Resources, Inc.")  // "targa resources"
 *   normalizeCompanyKey("Gett") !== normalizeCompanyKey("Rigetti")
 */
export function normalizeCompanyKey(s: string): string {
  const base = normalizeLookupKey(s ?? "");
  let punct = base.replace(PUNCT_TO_DELETE_RE, "");
  punct = punct.replace(PUNCT_TO_SPACE_RE, " ");
  punct = punct.replace(/\s+/g, " ").trim();

  let out = punct;
  for (let i = 0; i < SUFFIX_PASSES; i++) {
    const prev = out;
    out = out.replace(SUFFIX_RE, "");
    if (out === prev) break;
  }
  // Empty guard: "Inc." alone must not normalize to nothing.
  return out || punct;
}

/** True when two surface forms fold onto the same company. */
export function sameCompanyKey(a: string, b: string): boolean {
  const ka = normalizeCompanyKey(a);
  return ka.length > 0 && ka === normalizeCompanyKey(b);
}
