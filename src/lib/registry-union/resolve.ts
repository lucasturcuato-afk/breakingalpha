/**
 * The read-only registry union: typed string -> exchange-listed SEC registrant.
 *
 * WHAT THIS IS. A checked-in index built from free, enumerable SEC bulk files
 * (company_tickers.json, company_tickers_exchange.json, the submissions bulk
 * file including former names, cik-lookup-data.txt, Form D, Form ADV) plus a
 * seven-entry hand-verified Wikidata brand-to-parent map. It writes nothing,
 * it migrates nothing, and it does not know about the `companies` table. The
 * caller consults it first and falls back to `companies`.
 *
 * WHAT IT IS FOR. 2,251 of the 2,869 names in the recruiting universe resolve
 * to no production row at all. The union does not invent rows: it maps a typed
 * name onto the registrant that already owns the CIK the pillar tables are
 * keyed by, so a name with no `companies` row can still reach real filings,
 * real Form 4 rows and real validated XBRL under the registrant's OWN name.
 *
 * THE TIE-BREAK, AND WHY IT IS NOT "FIRST ACCEPTED CANDIDATE".
 * backend/edgar/name_agreement.py is a GATE, not a ranker: it accepts
 * 'C.H. Robinson' against BOTH 'C. H. ROBINSON WORLDWIDE, INC.' and
 * 'ROBINSON & ROBINSON, INC.'. Taking the first accepted registrant chooses
 * arbitrarily on a large fraction of names and is exactly how a page fills
 * with another company's data. This resolver never chooses arbitrarily. The
 * ladder runs at BUILD time and emits a key only when it produces exactly one
 * survivor:
 *
 *   1. Exact normalized CURRENT-name match. No prefix matching, no substring
 *      matching, no acronym expansion. 'BCG' cannot reach 'Binah Capital
 *      Group' and 'Accel' cannot reach 'Accel Entertainment'.
 *   2. Among ties: a major-exchange registrant outranks an OTC-only one. If
 *      exactly one survives, it wins.
 *   3. Among what is left: a registrant that has filed since 2024 outranks a
 *      dormant one. If exactly one survives, it wins.
 *   4. Otherwise the key is DROPPED. There is no rung five.
 *
 * FOUR GATES ON TOP OF THE LADDER.
 *   G1 One-word names must land on a still-filing MAJOR-exchange registrant
 *      whose own current name is exactly that word, and nothing else in the
 *      983,021-CIK space may claim the word as its current name, and no second
 *      listed registrant may claim it as a weak key. That last clause is the
 *      UBS shape: 'UBS AG' (a subsidiary) keys 'ubs' strongly while the listed
 *      parent 'UBS Group AG' keys it weakly, so 'UBS' declines rather than
 *      putting the subsidiary's identity on the parent's page.
 *   G2 Former names are NOT a resolution rung. Measured over the universe the
 *      rung answered 8 names and 3 were wrong (Duff & Phelps -> Virtus,
 *      Atlas Holdings -> Amneal, Hilton Worldwide -> Park Hotels). They stay
 *      in the source data for disclosure and decide nothing.
 *   G3 Legal-form conflict: see formClass in ./normalize.
 *   G4 A three-entry denylist for strings two real firms both own
 *      ('eqt', 'strategy', 'dana'). Hand-adjudicated, listed in the artifact.
 *
 * THE VANGUARD PROPERTY. /company/vanguard fills all four tabs with AMERICAN
 * VANGUARD's real filings under the heading "Vanguard". Filled and wrong is
 * worse than empty. Two structural properties keep the union out of that
 * shape, and resolve.test.ts asserts both over the whole shipped index:
 *   P1 Every accepted answer satisfies strongKey(registrant) === strongKey(typed)
 *      or extends it as a LEADING token run. 'american vanguard' neither
 *      equals nor is led by 'vanguard', so no typed 'Vanguard' can reach it.
 *   P2 The union returns the REGISTRANT's own name. A caller that renders it
 *      cannot put one company's data under another company's heading.
 */
import indexData from "./union-index.json";
import { strongKey, weakKey, formClass } from "./normalize";

type Entity = [name: string, tickers: string[], exchange: string];
type KeyEntry = [cik: number, kind: "s" | "w" | "b"];

interface UnionIndex {
  schema: number;
  generated: string;
  scope: string;
  source: Record<string, string>;
  counts: Record<string, unknown>;
  deny: string[];
  entities: Record<string, Entity>;
  keys: Record<string, KeyEntry>;
}

const IDX = indexData as unknown as UnionIndex;
const DENY = new Set(IDX.deny);

/** How the key was earned. `current` is an exact legal-name match, `structural`
 *  dropped a trailing Holdings/Group/International/Worldwide from the
 *  REGISTRANT side, `brand` is a hand-verified brand-to-parent entry. */
export type RegistryVia = "current" | "structural" | "brand";

export interface RegistryMatch {
  cik: number;
  /** The REGISTRANT's own name. Render this, never the typed string. */
  name: string;
  ticker: string | null;
  tickers: string[];
  exchange: string | null;
  via: RegistryVia;
  /** The normalized key the answer was found under. Useful in logs. */
  key: string;
}

const VIA: Record<KeyEntry[1], RegistryVia> = { s: "current", w: "structural", b: "brand" };

/** Max tokens in a typed name before we treat it as prose rather than a name. */
const MAX_TOKENS = 8;

function build(key: string, entry: KeyEntry, typed: string): RegistryMatch | null {
  const [cik, kind] = entry;
  const ent = IDX.entities[String(cik)];
  if (!ent) return null;
  const [name, tickers, exchange] = ent;
  // G3, the one gate that cannot be baked: it depends on the TYPED side.
  const a = formClass(typed);
  const b = formClass(name);
  if (a && b && a !== b) return null;
  return {
    cik,
    name,
    ticker: tickers[0] ?? null,
    tickers,
    exchange: exchange || null,
    via: VIA[kind],
    key,
  };
}

/**
 * Resolve a typed company name against the union. Returns null whenever the
 * union has no single, gated answer. Null is the normal result and it is the
 * safe one: the caller falls back to `companies`.
 *
 * Pure and synchronous. No network, no database, no writes.
 */
export function resolveRegistry(typed: string | null | undefined): RegistryMatch | null {
  const raw = (typed ?? "").trim();
  if (!raw) return null;
  const key = strongKey(raw);
  if (!key) return null;
  const toks = key.split(" ");
  if (toks.length > MAX_TOKENS) return null;
  if (/^\d+$/.test(key)) return null;
  if (DENY.has(key)) return null;

  const direct = IDX.keys[key];
  if (direct) return build(key, direct, raw);

  // A one-word name never reaches the structural index. Every structural key
  // carries two or more tokens by construction, so this is belt and braces.
  if (toks.length < 2) return null;

  const wk = weakKey(raw);
  if (!wk || wk === key || wk.split(" ").length < 2) return null;
  if (DENY.has(wk)) return null;
  const viaWeak = IDX.keys[wk];
  return viaWeak ? build(wk, viaWeak, raw) : null;
}

/** Provenance for the report and for any surface that wants to cite the index. */
export function registryUnionMeta() {
  return { schema: IDX.schema, generated: IDX.generated, scope: IDX.scope, source: IDX.source, counts: IDX.counts };
}

/** Exported for the proof tests; not part of the resolution path. */
export function __allKeys(): Array<[string, KeyEntry]> {
  return Object.entries(IDX.keys);
}
export function __entity(cik: number): Entity | undefined {
  return IDX.entities[String(cik)];
}
