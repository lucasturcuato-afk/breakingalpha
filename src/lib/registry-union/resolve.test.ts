/**
 * Unit tests for the read-only registry union.
 * Run: npx tsx --test src/lib/registry-union/resolve.test.ts
 *
 * Two of these are not ordinary unit tests. THE VANGUARD PROOF (P1, P2 and the
 * interior-token sweep) runs over the entire shipped index rather than over a
 * fixture, because the claim being made is structural: the union cannot emit
 * the /company/vanguard shape, where a page fills with AMERICAN VANGUARD's
 * real SEC filings under the heading "Vanguard". Pure, deterministic, no
 * network, no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegistry, registryUnionMeta, __allKeys, __entity } from "./resolve";
import { strongKey, weakKey, formClass } from "./normalize";

const AMERICAN_VANGUARD = 5981;
const HELMERICH_PAYNE = 46765;

// ---------------------------------------------------------------------------
// THE VANGUARD PROOF
// ---------------------------------------------------------------------------

test("P1 containment: every shipped key is a LEADING token run of its registrant's name", () => {
  const violations: string[] = [];
  for (const [key, [cik, kind]] of __allKeys()) {
    if (kind === "b") continue; // brand entries are hand-verified, enumerated below
    const ent = __entity(cik);
    assert.ok(ent, `key ${key} points at cik ${cik} with no entity record`);
    const want = key.split(" ");
    const got = strongKey(ent[0]).split(" ");
    if (got.slice(0, want.length).join(" ") !== want.join(" ")) violations.push(`${key} -> ${ent[0]}`);
  }
  assert.deepEqual(violations, []);
});

test("P1b: a typed name can only reach a registrant whose key it leads", () => {
  // 'Vanguard' is an INTERIOR token of 'AMERICAN VANGUARD CORP'. An interior
  // match is the whole defect. Sweep every one-word key in the index and assert
  // none of them sits anywhere but first in its registrant's name.
  for (const [key, [cik, kind]] of __allKeys()) {
    if (kind === "b" || key.includes(" ")) continue;
    const ent = __entity(cik)!;
    assert.equal(strongKey(ent[0]).split(" ")[0], key, `one-word key ${key} is not the head of ${ent[0]}`);
  }
});

test("P2: the union answers with the REGISTRANT's name, never the typed string", () => {
  const m = resolveRegistry("google");
  assert.equal(m?.name, "Alphabet Inc.");
  assert.equal(m?.cik, 1652044);
  assert.equal(m?.via, "brand");
});

test("Vanguard: no spelling of it reaches American Vanguard", () => {
  for (const t of ["Vanguard", "vanguard", "VANGUARD", "Vanguard Group", "The Vanguard Group",
                   "Vanguard Group Inc", "vanguard-group", "The Vanguard Group, Inc."]) {
    const m = resolveRegistry(t.replace(/-/g, " "));
    assert.notEqual(m?.cik, AMERICAN_VANGUARD, `${t} reached American Vanguard`);
    assert.equal(m, null, `${t} should decline, got ${m?.name}`);
  }
  // and the registrant is genuinely in the index, reachable only by its own name
  assert.equal(resolveRegistry("American Vanguard")?.cik, AMERICAN_VANGUARD);
});

// ---------------------------------------------------------------------------
// The fourteen named probes
// ---------------------------------------------------------------------------

test("the fourteen probes resolve exactly as adjudicated", () => {
  const expect: Array<[string, number | null, string | null]> = [
    ["Vanguard", null, null],           // The Vanguard Group is not a listed registrant
    ["Cinven", null, null],             // UK private equity, no SEC listing
    ["CSL", null, null],                // only an OTC-only ADR claims the key
    ["EQT", null, null],                // EQT AB and EQT Corp both own the string
    ["HP Inc.", 47217, "HP INC"],       // NOT Helmerich & Payne, cik 46765
    ["Google", 1652044, "Alphabet Inc."],
    ["Facebook", 1326801, "Meta Platforms, Inc."],
    ["YouTube", 1652044, "Alphabet Inc."],
    ["Ola", null, null],
    ["Gett", null, null],
    ["LIC", null, null],
    ["Revolut", null, null],
    ["Accel", null, null],              // NOT Accel Entertainment, a slot-route operator
    ["BCG", null, null],                // NOT Binah Capital Group
  ];
  for (const [typed, cik, name] of expect) {
    const m = resolveRegistry(typed);
    assert.equal(m?.cik ?? null, cik, `${typed}: cik`);
    assert.equal(m?.name ?? null, name, `${typed}: name`);
  }
  assert.notEqual(resolveRegistry("HP Inc.")?.cik, HELMERICH_PAYNE);
  assert.notEqual(resolveRegistry("HP")?.cik, HELMERICH_PAYNE);
});

// ---------------------------------------------------------------------------
// The false accepts that name_agreement.py lets through
// ---------------------------------------------------------------------------

test("no acronym expansion, no head-prefix, no substring", () => {
  for (const t of ["BCG", "Accel", "Mercor", "Kearney", "Aerospace", "Defense", "Zeta",
                   "Continental Investors", "Fidelity International", "Insight Partners"]) {
    assert.equal(resolveRegistry(t), null, `${t} should decline`);
  }
});

test("C.H. Robinson reaches Robinson Worldwide and nothing named Robinson & Robinson", () => {
  const m = resolveRegistry("C.H. Robinson");
  assert.equal(m?.cik, 1043277);
  assert.equal(m?.name, "C. H. ROBINSON WORLDWIDE, INC.");
  assert.equal(m?.via, "structural");
  assert.equal(resolveRegistry("Robinson"), null);
});

test("former names decide nothing", () => {
  // Travelers Group became Citigroup in 1998 and the key must not reach it.
  assert.equal(resolveRegistry("Travelers")?.cik, 86312);
  assert.equal(resolveRegistry("Travelers")?.name, "TRAVELERS COMPANIES, INC.");
  for (const t of ["Duff & Phelps", "Atlas Holdings", "Hilton Worldwide", "Royal Dutch Shell",
                   "Colony Capital", "Charles River Associates"]) {
    assert.equal(resolveRegistry(t), null, `${t} must not resolve through a former name`);
  }
});

test("one-word names decline when a second registrant claims the word", () => {
  // 'UBS AG' is a subsidiary and keys 'ubs'; the listed parent 'UBS Group AG'
  // keys it weakly. Contested means decline, not "take the strong hit".
  assert.equal(resolveRegistry("UBS"), null);
  assert.equal(resolveRegistry("UBS Group")?.cik, 1610520);
});

test("legal-form conflict blocks a foreign firm from a same-stem US registrant", () => {
  assert.equal(formClass("EQT AB"), "ab");
  assert.equal(formClass("EQT Corp"), "uscorp");
  assert.equal(resolveRegistry("Shell AB"), null);       // form conflict, not a denylist hit
  assert.equal(resolveRegistry("Shell")?.name, "Shell plc");
  assert.equal(resolveRegistry("Chubb Limited")?.name, "Chubb Ltd"); // same class, still matches
});

test("list-page artifacts that are not firms all decline", () => {
  for (const t of ["Aerospace", "Apparel", "Business services", "Capital introduction", "Chemicals",
                   "Defense", "East Asia", "Energy", "Engineering", "Financials", "Food",
                   "Fortune 1000", "Fortune India 500", "Industrials", "Materials", "Media",
                   "North America", "Technology", "Transportation"]) {
    assert.equal(resolveRegistry(t), null, `${t} is a sector label, not a company`);
  }
});

// ---------------------------------------------------------------------------
// Normalization and the answers the union is supposed to get right
// ---------------------------------------------------------------------------

test("EDGAR state markers and ampersands normalize away", () => {
  assert.equal(strongKey("BANK OF AMERICA CORP /DE/"), "bank of america");
  assert.equal(strongKey("QUALCOMM INC/DE"), "qualcomm");
  assert.equal(strongKey("TOYOTA MOTOR CORP/"), "toyota motor");
  assert.equal(strongKey("JPMORGAN CHASE & CO"), "jpmorgan chase");
  assert.equal(weakKey("The Goldman Sachs Group, Inc."), "goldman sachs");
  assert.equal(weakKey("CF Industries Holdings, Inc."), "cf industries");
});

test("the answers the union exists to produce", () => {
  const cases: Array<[string, number]> = [
    ["Goldman Sachs", 886982],
    ["JPMorgan Chase", 19617],
    ["Bank of America", 70858],
    ["American International Group", 5272],
    ["Alphabet", 1652044],
    ["Booz Allen Hamilton", 1443646],
    ["Marsh & McLennan", 62709],
    ["Deere & Company", 315189],
    ["Toyota Motor", 1094517],
  ];
  for (const [t, cik] of cases) assert.equal(resolveRegistry(t)?.cik, cik, t);
});

test("index integrity: every key points at a shipped entity and the artifact is stamped", () => {
  const meta = registryUnionMeta();
  assert.equal(meta.schema, 1);
  assert.ok(meta.generated.match(/^\d{4}-\d{2}-\d{2}$/));
  assert.ok(String(meta.scope).includes("exchange-listed"));
  for (const [key, [cik]] of __allKeys()) assert.ok(__entity(cik), `${key} -> orphan cik ${cik}`);
});

test("degenerate inputs never throw and never answer", () => {
  for (const t of ["", "   ", "-", "12345", "a b c d e f g h i j", null, undefined]) {
    assert.equal(resolveRegistry(t as string), null, JSON.stringify(t));
  }
});
