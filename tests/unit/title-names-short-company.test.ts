// Whether a SHORT company name can earn title evidence.
//
// THE DEFECT THIS LOCKS. `titleNamesCompany` opened with two substring tests,
// each carrying a length floor (`>= 5` for the whole name, `>= 6` for the first
// token). A substring test needs that floor. The consequence was that a company
// whose name is under five characters could never return true from this function
// no matter what the headline said, so `isMaterialCounterparty` was permanently
// false for that whole population and their counterparty M&A coverage was
// silently dropped. Measured against the corpus, hundreds of rows sit under the
// floor and the head of that list is names any reader would expect to work.
//
// This is the third instance of one shape: an asymmetric floor that makes a
// check unsatisfiable for a subpopulation rather than merely strict. #816 fixed
// it in `matchesCanonical`, and fixed it with an EQUALITY BRANCH rather than a
// lower floor, saying so in its own header. The same reasoning applies here and
// produces a different branch, because the haystack here is English prose rather
// than a company name: whole-word equality, not a shorter substring.
//
// WHY NOT JUST LOWER THE FLOOR, measured rather than asserted, and the two
// measurements answer two different questions. Dropping the floor from the FIRST
// branch, which is not tag-gated, fires on the wrong company more than a
// thousand times over pairs built from the corpus. Keeping the tag gate but
// making the short branch a SUBSTRING test is the narrower mistake, and it still
// fires on the wrong company every time the case occurs; the live instance is
// "KLA" reading itself out of the ticker string "KLAC". The whole-word branch
// fires on neither. The representative pairs are pinned below.
//
// THE FIRST DRAFT OF THE ADVERSARIAL TEST BELOW PROVED NOTHING, which is worth
// leaving in the record. It tagged each article with only the LONGER company, so
// `matchesCanonical` returned false, the loop `continue`d, and the branch under
// test never executed. It passed identically against the substring version. A
// case only tests this branch if the article is TAGGED with the short company.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { titleNamesCompany } from "../../src/lib/company-intel.ts";

/* ── the repair: a short name that IS the subject of the headline ────────── */

test("a short tagged name is found as a whole word in the headline", () => {
  // Real shape from the corpus: an insurance megadeal naming both parties, with
  // no primary_company, which is exactly what isMaterialCounterparty exists for.
  const title =
    "AON Flat, KKR Rises Overnight As $17B Insurance Megadeal Reportedly Looms";
  assert.equal(titleNamesCompany(title, ["Aon", "KKR"], "KKR"), true);
  assert.equal(titleNamesCompany(title, ["Aon", "KKR"], "Aon"), true);
});

test("a four character tagged name is found as a whole word", () => {
  assert.equal(
    titleNamesCompany("Olin, Huntsman Shareholders Approve All-Stock Merger of Equals", ["Olin"], "Olin"),
    true,
  );
  assert.equal(
    titleNamesCompany("Yduqs in preliminary talks to merge with Afya", ["Afya"], "Afya"),
    true,
  );
});

test("a short name with punctuation in it is still found", () => {
  assert.equal(titleNamesCompany("AT&T to acquire a fibre network", ["AT&T"], "AT&T"), true);
});

/* ── what must never fire: the adversarial pairs, built from the corpus ──── */

test("a TAGGED short name does not read itself out of a longer word in the headline", () => {
  // THIS IS THE TEST THAT ACTUALLY REACHES THE BRANCH, and the first draft of it
  // did not. Tagging the article with only the LONGER company ("Rheinmetall")
  // makes `matchesCanonical` false, so the loop `continue`s and the short-name
  // branch never runs: the case passed identically whether the branch used a
  // whole-word match or a substring, which is a tautology, not a proof.
  //
  // The honest shape is an article CORRECTLY tagged with the short company,
  // because it is genuinely discussed in the body, whose HEADLINE is about
  // someone else and merely contains the short name inside a longer word. That
  // reaches the branch, and it is the case a substring test gets wrong: "meta"
  // is inside "rheinmetall", "amd" is inside "camden", "arm" is inside
  // "armstrong", "visa" is inside "televisa".
  const pairs: Array<[string, string]> = [
    ["Meta", "Rheinmetall wins a defence order"],
    ["Meta", "Catalyst Metals lifts its guidance"],
    ["AMD", "Camden National reports a merger"],
    ["Arm", "Armstrong World Industries agrees a deal"],
    ["Visa", "Grupo Televisa explores a sale"],
    ["BP", "BPER Banca completes its takeover"],
    ["EQT", "An EQTEC subsidiary is acquired"],
    // The live instance, lifted from a real headline in the corpus: the ticker
    // string "KLAC" contains the canonical name "KLA".
    ["KLA", "KLAC Maintains Neutral Rating by UBS -- Price Target Lowered to $200"],
  ];
  for (const [short, title] of pairs) {
    assert.ok(
      title.toLowerCase().includes(short.toLowerCase()),
      `the pair is only adversarial if the substring is present: ${short} / ${title}`,
    );
    assert.equal(
      titleNamesCompany(title, [short], short),
      false,
      `"${short}" must not read itself out of "${title}"`,
    );
  }
});

/* ── the tag gate, which is the other half of the safety argument ────────── */

test("the short-name branch never fires on an article that does not carry the company", () => {
  // The branch sits below matchesCanonical, so the headline is only ever asked
  // to CONFIRM an identification ingest already made, never to make one. A bare
  // English word in a headline about someone else cannot pull a company in.
  assert.equal(titleNamesCompany("Alphabet's health arm strikes a deal", ["Alphabet"], "Arm"), false);
  assert.equal(titleNamesCompany("A warm reception for the chip listing", ["Nvidia"], "Arm"), false);
  assert.equal(titleNamesCompany("Startups raise a record sum", ["Sequoia"], "UPS"), false);
});

/* ── the long-name behaviour must be untouched ───────────────────────────── */

test("long names keep their existing substring behaviour", () => {
  assert.equal(
    titleNamesCompany("Nvidia invests in Marvell Technology", ["Marvell Technology"], "Marvell Technology"),
    true,
  );
  assert.equal(
    titleNamesCompany("Nvidia invests in a chip designer", ["Marvell Technology"], "Marvell Technology"),
    false,
  );
});
