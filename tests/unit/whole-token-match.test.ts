// Unit tests for the shared company-identity predicate
// (src/lib/whole-token-match.ts).
//
// The contract locked here is ONE property, stated as a property and not as a
// list of examples: an INTERIOR or TRAILING fragment of a company name never
// names that company, at any length. Everything else in this file exists to
// prove the property was not bought by breaking a match that has to work.
//
// Run: npx tsx --test tests/unit/whole-token-match.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nameContainsTerm,
  nameContainsAnyTerm,
  normalizeForTokenMatch,
  TOKEN_PREFIX_MIN_LEN,
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
});

test("punctuation and separators are absorbed on both sides", () => {
  assert.equal(nameContainsTerm("Parker-Hannifin", "Parker Hannifin"), true);
  assert.equal(nameContainsTerm("Coca-Cola", "Coca Cola"), true);
  assert.equal(nameContainsTerm("Nasdaq, Inc.", "nasdaq inc."), true);
  assert.equal(normalizeForTokenMatch("  Sei Investments Co.  "), "sei investments co");
});

test("a SUB-TOKEN trailing fragment is refused as firmly as an interior one", () => {
  // "isa" ENDS the token "visa" and is 3 characters. Length is not what saves
  // this; the token boundary is.
  assert.equal("visa inc".includes("isa"), true);
  assert.equal(nameContainsTerm("Visa Inc", "isa"), false);
  assert.equal(nameContainsTerm("Visanet", "Visa"), false);
});

test("THE BOUNDARY OF THE RULE, stated rather than left to be discovered", () => {
  // A WHOLE TOKEN of a longer name DOES match, and that is deliberate. "Cola"
  // is a whole token of "Coca-Cola"; "Ola" is not. The rule draws its line at
  // the token, not at the word count, which is the only line that can be drawn
  // without a similarity threshold. This is what separates it from
  // `.includes()`, and it is also the widest thing it still accepts.
  assert.equal(nameContainsTerm("Coca-Cola", "Cola"), true);
  assert.equal(nameContainsTerm("Coca-Cola", "Ola"), false);
  // The practical bound on that width: every caller applies this to rows a
  // query already returned for the SAME term, so a whole-token acceptance can
  // only re-admit a row the ILIKE arm had already selected.
  assert.equal(nameContainsTerm("Republic Services", "Services"), true);
  assert.equal(nameContainsTerm("Republic Services", "LIC"), false);
});

test("concatenated brand forms resolve, and only from the left", () => {
  // The one substring allowance, and it is a PREFIX of a token, never an
  // interior of one.
  assert.equal(nameContainsTerm("JPMorganChase", "JPMorgan"), true);
  assert.equal(nameContainsTerm("ExxonMobil Corp", "ExxonMobil"), true);
  // Same length, but the term sits inside the token rather than starting it.
  assert.equal("jpmorganchase".includes("morganc"), true);
  assert.equal(nameContainsTerm("JPMorganChase", "morganc"), false);
});

test("the prefix allowance carries a length floor that every fragment fails", () => {
  assert.equal(TOKEN_PREFIX_MIN_LEN, 6);
  // 5 characters, a genuine left-anchored prefix, still refused.
  assert.equal("nikola".startsWith("nikol"), true);
  assert.equal(nameContainsTerm("Nikola", "nikol"), false);
  for (const [fragment] of INTERIOR_PAIRS) {
    assert.ok(
      fragment.length < TOKEN_PREFIX_MIN_LEN,
      `${fragment} is long enough to reach the prefix rule; the fixture needs re-checking`,
    );
  }
});

test("a multi-token term never reaches the prefix rule", () => {
  // "coca cola" losing its separator is rule 1's job. A multi-token term that
  // failed rule 1 differs by more than a separator, so it must not be rescued
  // by a prefix test that was written for one concatenated word.
  assert.equal(nameContainsTerm("Republic Services Group", "Republic Serv"), false);
});

test("null, empty and whitespace-only inputs are false, never throws", () => {
  assert.equal(nameContainsTerm(null, "Ola"), false);
  assert.equal(nameContainsTerm(undefined, "Ola"), false);
  assert.equal(nameContainsTerm("Ola", null), false);
  assert.equal(nameContainsTerm("", "Ola"), false);
  assert.equal(nameContainsTerm("Ola", "   "), false);
  assert.equal(nameContainsTerm("!!!", "Ola"), false);
});

test("nameContainsAnyTerm is an OR over the same rule", () => {
  assert.equal(nameContainsAnyTerm("Motorola Solutions", ["Ola", "Nikola"]), false);
  assert.equal(nameContainsAnyTerm("Motorola Solutions", ["Ola", "Motorola"]), true);
  assert.equal(nameContainsAnyTerm("Motorola Solutions", []), false);
});
