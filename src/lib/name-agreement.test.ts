// Unit tests for src/lib/name-agreement.ts.
// Fixtures mirror backend/tests/test_cik_stamp_name_agreement.py. The two
// implementations gate the same column from two runtimes, so a case that
// blocks on one side and passes on the other is a bug in whichever moved.
import test from "node:test";
import assert from "node:assert/strict";
import { namesAgree, difflibRatio } from "./name-agreement.ts";

const agrees = (a: string, b: string | null | undefined) =>
  namesAgree(a, b).agrees;

test("fails open without an authority name", () => {
  for (const absent of [null, undefined, "", "   "]) {
    const got = namesAgree("Anything", absent);
    assert.equal(got.agrees, true);
    assert.match(got.reason, /fail-open/);
  }
});

test("blocks every named prod cross-wire", () => {
  const crossWires: [string, string][] = [
    ["Ola", "COCA COLA CO"],
    ["Gett", "Rigetti Computing, Inc."],
    ["AXT Inc.", "BAXTER INTERNATIONAL INC"],
    ["CSL", "CARLISLE COMPANIES INC"],
    ["Vanguard", "AMERICAN VANGUARD CORP"],
    ["Fidelity", "Fidelity National Information Services, Inc."],
    ["LIC", "REPUBLIC SERVICES, INC."],
    ["GHO", "WESTINGHOUSE AIR BRAKE TECHNOLOGIES CORP"],
    ["Revolut", "Revolution Medicines, Inc."],
    ["YC", "PAYCHEX INC"],
    ["Motive", "O REILLY AUTOMOTIVE INC"],
    ["HP Inc.", "Helmerich & Payne, Inc."],
    ["BYD", "BOYD GAMING CORP"],
    ["AWS", "Jaws Mustang Acquisition Corp"],
    ["Neuberger", "Getty Images Holdings, Inc."],
    ["BNY", "BNY MELLON STRATEGIC MUNICIPALS, INC."],
  ];
  for (const [ours, authority] of crossWires) {
    assert.equal(agrees(ours, authority), false, `${ours} / ${authority}`);
  }
});

test("admits rows a fail-closed gate would have blanked", () => {
  const clean: [string, string][] = [
    ["Electronic Arts", "ELECTRONIC ARTS INC"],
    ["Chart Industries", "CHART INDUSTRIES INC"],
    ["Twist Bioscience Corp", "Twist Bioscience Corp"],
    ["Apple", "Apple Inc."],
    ["Alight, Inc.", "Alight, Inc. / Delaware"],
    ["KalVista Pharmaceuticals Inc", "KalVista Pharmaceuticals, Inc."],
    ["Lake Shore Bancorp Inc/Md", "Lake Shore Bancorp, Inc. /MD/"],
  ];
  for (const [ours, authority] of clean) {
    assert.equal(agrees(ours, authority), true, `${ours} / ${authority}`);
  }
});

test("two-letter acronym floor blocks HP Inc. / Helmerich & Payne", () => {
  assert.equal(agrees("HP Inc.", "Helmerich & Payne, Inc."), false);
});

test("three-letter acronyms still match", () => {
  assert.equal(agrees("AMD", "ADVANCED MICRO DEVICES INC"), true);
  assert.equal(agrees("IBM", "INTERNATIONAL BUSINESS MACHINES CORP"), true);
  assert.equal(agrees("UPS", "UNITED PARCEL SERVICE INC"), true);
});

test("weak tokens survive into the acronym test", () => {
  // 'international' is dropped for set comparison but kept for acronyms, or
  // INTERNATIONAL BUSINESS MACHINES loses its I and IBM stops matching.
  assert.equal(agrees("IBM", "International Business Machines"), true);
});

test("bounded head prefix accepts a single extra identity token", () => {
  const ok: [string, string][] = [
    ["Coinbase", "Coinbase Global, Inc."],
    ["Amazon", "AMAZON COM INC"],
    ["Chime", "Chime Financial, Inc."],
    ["Lyra", "Lyra Therapeutics, Inc."],
    ["Huron", "Huron Consulting Group Inc."],
  ];
  for (const [a, b] of ok) assert.equal(agrees(a, b), true, `${a} / ${b}`);
});

test("bounded head prefix rejects more than one extra token", () => {
  const no: [string, string][] = [
    ["Fidelity", "Fidelity National Information Services, Inc."],
    ["BNY", "BNY MELLON STRATEGIC MUNICIPALS, INC."],
    ["xAI", "XAI Floating Rate & Alternative Income Trust"],
    ["Bain", "Bain Capital Specialty Finance, Inc."],
  ];
  for (const [a, b] of no) assert.equal(agrees(a, b), false, `${a} / ${b}`);
});

test("head position is load-bearing", () => {
  // 'Vanguard' is a one-extra-token INTERIOR match of AMERICAN VANGUARD.
  // Only the leading-position rule rejects it, so the rule cannot be
  // relaxed to "appears anywhere" to rescue Disney / Walt Disney Co.
  assert.equal(agrees("Vanguard", "AMERICAN VANGUARD CORP"), false);
});

test("head prefix runs on raw tokens", () => {
  // 'Urban Company' reduces to ['urban'] once the legal form is stripped,
  // which would make it a +1 head prefix of URBAN OUTFITTERS. Urban Company
  // is an Indian home-services firm.
  assert.equal(agrees("Urban Company", "URBAN OUTFITTERS INC"), false);
});

test("single-character debris is not identity", () => {
  assert.equal(agrees("Globant", "Globant S.A."), true);
  assert.equal(agrees("Spotify", "Spotify Technology S.A."), true);
  assert.equal(agrees("Nebius", "Nebius Group N.V."), true);
});

test("renames are rejected, which is the cheap direction", () => {
  // No string matcher connects these. The gate never clears an existing
  // value, so the cost is a missing identifier, not a wrong one.
  assert.equal(agrees("Raytheon", "RTX Corp"), false);
  assert.equal(agrees("Disney", "Walt Disney Co"), false);
  assert.equal(agrees("SpaceX", "SPACE EXPLORATION TECHNOLOGIES CORP"), false);
});

test("difflibRatio matches Python difflib.SequenceMatcher.ratio", () => {
  // Values produced by python3 -c "import difflib; print(
  //   difflib.SequenceMatcher(None, a, b).ratio())".
  const cases: [string, string, number][] = [
    ["capital mountain", "finance mountain", 0.625],
    ["", "", 1.0],
    ["abc", "abc", 1.0],
    ["abc", "xyz", 0.0],
    ["ola", "coca cola", 0.5],
    ["revolut", "medicines revolution", 0.5185185185185185],
    ["microstrategy", "strategy", 0.7619047619047619],
    ["amazon", "amazon com", 0.75],
  ];
  for (const [a, b, want] of cases) {
    assert.ok(
      Math.abs(difflibRatio(a, b) - want) < 1e-12,
      `ratio(${a}, ${b}) = ${difflibRatio(a, b)}, want ${want}`,
    );
  }
});

test("gate is symmetric on the equal-token-set path", () => {
  assert.equal(agrees("Twist Bioscience Corp", "Twist Bioscience Corp"), true);
  assert.equal(agrees("Foo Inc", "Foo Corporation"), true);
});

// Mirror of BoundedSubsetRule in backend/tests/test_cik_stamp_name_agreement.py.
// The subset branch was unbounded while the head-prefix branch was not.
test("bounded subset rejects a non-leading subset that adds more than one token", () => {
  // {energy, capital} is a subset of {el, paso, energy, capital, trust} with
  // two shared tokens. Unbounded, that is an accept, and it is how EP PR C
  // reached a companies row.
  assert.equal(agrees("Energy Capital", "El Paso Energy Capital Trust I"), false);
});

test("bounded subset still accepts a leading subset however much is added", () => {
  // Both pairs add TWO identity tokens, so MAX_HEAD_PREFIX_EXTRA alone rejects
  // them and only the leading test lets them through. Live registrant names.
  // An earlier version used a pair whose token sets were EQUAL once the weak
  // and legal forms were stripped, so it passed on the equality branch and
  // never reached the subset branch it claimed to cover.
  for (const [ours, authority] of [
    ["Check Point", "CHECK POINT SOFTWARE TECHNOLOGIES LTD"],
    ["Kratos Defense", "KRATOS DEFENSE & SECURITY SOLUTIONS, INC."],
  ]) {
    const { agrees: ok, reason } = namesAgree(ours, authority);
    assert.equal(ok, true, `${ours}/${authority}`);
    assert.ok(
      reason.startsWith("subset"),
      `${ours}/${authority} accepted by ${reason}, not the subset branch`,
    );
  }
});

test("bounded subset still accepts a bounded subset that does not lead", () => {
  assert.equal(agrees("Norwegian Cruise", "Norwegian Cruise Line"), true);
});

test("bounded subset leaves the currently stamped rows alone", () => {
  assert.equal(agrees("Theravance Biopharma", "Theravance Biopharma, Inc."), true);
  assert.equal(agrees("PennantPark Investment", "PennantPark Investment Corp"), true);
  assert.equal(agrees("Guardian Pharmacy Services", "Guardian Pharmacy Services, Inc."), true);
});
