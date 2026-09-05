// Unit tests for the shared company-identity predicate
// (src/lib/whole-token-match.ts).
//
// The contract locked here is ONE property, stated as a property and not as a
// list of examples: a term never matches a name by starting in the MIDDLE of one
// of that name's words. Everything else in this file exists to prove the
// property was not bought by breaking a match that has to work, and to pin the
// two places where the rule deliberately still says yes.
//
// Run: npx tsx --test tests/unit/whole-token-match.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nameContainsTerm,
  nameContainsAnyTerm,
  normalizeForTokenMatch,
  tokensForMatch,
} from "../../src/lib/whole-token-match.ts";

/* The seven names the audit put on the table, each paired with the longer
 * company name whose interior it sits inside. Every pair is a `.includes()`
 * TRUE and must be a nameContainsTerm FALSE. */
const INTERIOR_PAIRS: Array<[fragment: string, insideOf: string]> = [
  ["Ola", "Coca-Cola"],
  ["Ola", "Motorola Solutions"],
  ["LIC", "Republic Services"],
  ["LIC", "Publicis Groupe"],
  ["GHO", "Westinghouse Electric"],
  ["Hark", "SharkNinja"],
  ["Acer", "Macerich"],
  ["ABC", "Labcorp"],
  ["Ely", "Ardelyx"],
];

/* Verbatim from the prod replay of the live desk query, 2026-09-05. Each is a
 * row origin/main served to a real watchlist entry through an interior hit. */
const PROD_INTERIOR_HITS: Array<[term: string, primaryCompany: string]> = [
  ["GS", "PDD Holdings"],
  ["GS", "Vertiv Holdings Co"],
  ["GS", "Sirius XM Holdings"],
  ["GS", "Arm Holdings PLC"],
  ["PL", "Dentsply Sirona"],
  ["PL", "Apple"],
  ["PL", "AAPL"],
  ["PL", "PYPL"],
];

test("an interior fragment never names the company it sits inside", () => {
  for (const [fragment, name] of INTERIOR_PAIRS) {
    // The old predicate, verbatim, so the fixture is proven to be a real
    // regression case and not a pair that never matched anyway.
    assert.equal(
      name.toLowerCase().includes(fragment.toLowerCase()),
      true,
      `fixture is not a substring case: ${fragment} / ${name}`,
    );
    assert.equal(
      nameContainsTerm(name, fragment),
      false,
      `${fragment} must not name ${name}`,
    );
  }
});

test("prod replay: every interior hit the live desk query served is refused", () => {
  for (const [term, pc] of PROD_INTERIOR_HITS) {
    assert.equal(pc.toLowerCase().includes(term.toLowerCase()), true, `${term} / ${pc}`);
    assert.equal(nameContainsTerm(pc, term), false, `${term} must not name ${pc}`);
  }
});

test("the same fragment still names its OWN company", () => {
  // The fix must not make these rows unreachable: each fragment is a real
  // entity in its own right, which is why the rows exist at all.
  assert.equal(nameContainsTerm("Ola Electric Mobility", "Ola"), true);
  assert.equal(nameContainsTerm("LIC Housing Finance", "LIC"), true);
  assert.equal(nameContainsTerm("GHO Capital", "GHO"), true);
  assert.equal(nameContainsTerm("Hark", "Hark"), true);
  assert.equal(nameContainsTerm("Acer Inc.", "Acer"), true);
  assert.equal(nameContainsTerm("ABC", "ABC"), true);
  assert.equal(nameContainsTerm("Ely", "Ely"), true);
});

test("whole-token containment, in the middle and at the end of a name", () => {
  assert.equal(nameContainsTerm("Nasdaq, Inc.", "Nasdaq"), true);
  assert.equal(nameContainsTerm("Nasdaq, Inc.", "Nasdaq Inc"), true);
  assert.equal(nameContainsTerm("Bank of America", "America"), true);
  assert.equal(nameContainsTerm("Taiwan Semiconductor", "Semiconductor"), true);
  assert.equal(nameContainsTerm("Goldman Sachs Group Inc", "Goldman Sachs"), true);
});

test("punctuation and separators are absorbed on both sides", () => {
  assert.equal(nameContainsTerm("Parker-Hannifin", "Parker Hannifin"), true);
  assert.equal(nameContainsTerm("Coca-Cola", "Coca Cola"), true);
  assert.equal(nameContainsTerm("Nasdaq, Inc.", "nasdaq inc."), true);
  assert.equal(normalizeForTokenMatch("  Sei Investments Co.  "), "sei investments co");
  assert.deepEqual(tokensForMatch("Parker-Hannifin Corp."), ["parker", "hannifin", "corp"]);
});

test("a SUB-TOKEN trailing fragment is refused as firmly as an interior one", () => {
  // "isa" ENDS the token "visa" and is 3 characters. Length is not what saves
  // this; the word boundary is.
  assert.equal("visa inc".includes("isa"), true);
  assert.equal(nameContainsTerm("Visa Inc", "isa"), false);
  assert.equal(nameContainsTerm("Coca-Cola", "ocacola"), false);
});

test("REGRESSION THE FIRST DRAFT CAUSED: a truncated symbol still reaches its name", () => {
  // A six-character floor on the prefix rule looked principled and cost a GOOGL
  // watchlist entry every Google article in the corpus, and a PL entry Planet
  // Labs. Both are prefixes. Measured on the live desk query before shipping.
  assert.equal(nameContainsTerm("Google", "GOOGL"), true);
  assert.equal(nameContainsTerm("Google Cloud", "GOOGL"), true);
  assert.equal(nameContainsTerm("Planet Labs", "PL"), true);
  assert.equal(nameContainsTerm("Planet Labs PBC", "PL"), true);
  // The same two-character term, one word later, is an interior hit and loses.
  assert.equal(nameContainsTerm("Dentsply Sirona", "PL"), false);
});

test("a token prefix resolves a shortened legal form and a concatenated brand", () => {
  assert.equal(nameContainsTerm("Nasdaq Incorporated", "Nasdaq Inc"), true);
  assert.equal(nameContainsTerm("JPMorganChase", "JPMorgan"), true);
  // Same length, but the term sits inside the token rather than starting it.
  assert.equal("jpmorganchase".includes("morganc"), true);
  assert.equal(nameContainsTerm("JPMorganChase", "morganc"), false);
});

test("only the LAST term token may be a prefix", () => {
  // "serv" is the last token and may be a prefix.
  assert.equal(nameContainsTerm("Republic Services Group", "Republic Serv"), true);
  // "repub" is NOT the last token, so it must match "republic" exactly.
  assert.equal(nameContainsTerm("Republic Services Group", "Repub Services"), false);
});

test("THE BOUNDARY OF THE RULE, stated rather than left to be discovered", () => {
  // A WHOLE TOKEN of a longer name DOES match, and a PREFIX of one does too.
  // "Cola" is a whole token of "Coca-Cola"; "Ola" starts inside that token.
  // The rule draws its line at the word boundary, not at a word count or a
  // length, which is the only line that can be drawn without a similarity
  // threshold. This is also the widest thing it still accepts, and it accepts
  // no more than origin/main did.
  assert.equal(nameContainsTerm("Coca-Cola", "Cola"), true);
  assert.equal(nameContainsTerm("Coca-Cola", "Ola"), false);
  assert.equal(nameContainsTerm("Metalla Royalty", "META"), true); // prefix, unchanged
  assert.equal(nameContainsTerm("Blue Moon Metals Inc.", "META"), true); // prefix, unchanged
  assert.equal(nameContainsTerm("Accenture PLC", "PL"), true); // prefix, unchanged
  // The practical bound: every caller applies this to rows a query already
  // returned for the SAME term, so an acceptance can only re-admit a row the
  // ILIKE arm had already selected.
  assert.equal(nameContainsTerm("Republic Services", "Services"), true);
  assert.equal(nameContainsTerm("Republic Services", "LIC"), false);
});

test("THE COST, NAMED. Three symbols that sit inside their own company's name", () => {
  /* Measured by replaying the live desk query for every distinct watchlist
   * entry (2026-09-05). These are the ONLY legitimate matches this rule
   * rejects, and all three are the same shape: the entry's whole term list is
   * the bare symbol, and the symbol starts in the middle of a word of its own
   * company's name. There is no string rule that separates them from the
   * symbols this rule correctly rejects -- "lly" inside "Lilly" is the same
   * relation as "gs" inside "Holdings" and "on" inside "Sony". Separating them
   * needs a RESOLVED company name on the watchlist row, not a wider predicate.
   *
   * Pinned here so the cost is visible and so a future widening has to argue
   * with a failing test rather than with a comment. */
  assert.equal(nameContainsTerm("Eli Lilly and Company", "LLY"), false);
  assert.equal(nameContainsTerm("ConocoPhillips", "COP"), false);
  assert.equal(nameContainsTerm("Robinhood Markets", "HOOD"), false);

  // And the fix for each is on the term side, not here. Given the resolved
  // name, every one of them matches.
  assert.equal(nameContainsTerm("Eli Lilly and Company", "Eli Lilly"), true);
  assert.equal(nameContainsTerm("ConocoPhillips", "Conoco"), true);
  assert.equal(nameContainsTerm("Robinhood Markets", "Robinhood Markets"), true);
});

test("null, empty and whitespace-only inputs are false, never throws", () => {
  assert.equal(nameContainsTerm(null, "Ola"), false);
  assert.equal(nameContainsTerm(undefined, "Ola"), false);
  assert.equal(nameContainsTerm("Ola", null), false);
  assert.equal(nameContainsTerm("", "Ola"), false);
  assert.equal(nameContainsTerm("Ola", "   "), false);
  assert.equal(nameContainsTerm("!!!", "Ola"), false);
  assert.equal(nameContainsTerm("Ola", "Ola Electric Mobility"), false); // term longer
});

test("nameContainsAnyTerm is an OR over the same rule", () => {
  assert.equal(nameContainsAnyTerm("Motorola Solutions", ["Ola", "Nikola"]), false);
  assert.equal(nameContainsAnyTerm("Motorola Solutions", ["Ola", "Motorola"]), true);
  assert.equal(nameContainsAnyTerm("Motorola Solutions", []), false);
});
