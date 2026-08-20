// Unit tests for the route-level company miss copy
// (src/components/company/states/company-miss-copy.ts).
//
// The component is .tsx and cannot load under node:test, so we lock the pure
// copy decision it renders verbatim. Same pattern as
// tests/unit/company-tab-empty-state.test.ts.
//
// Three things are being defended here:
//
//  1. The phases stay distinguishable. The code can tell apart "lookup in
//     flight", "lookup came back with no listed match", and "lookup failed".
//     It CANNOT tell apart a real private company from a name that is not a
//     company. Copy that blurs the first three, or that pretends to the
//     fourth, is the defect.
//  2. The vocabulary bans stand. The six banned substrings never appear, no
//     em-dash appears, and no outcome word outside supported / challenged /
//     developing / awaiting appears.
//
//     The six are assembled from fragments below rather than spelled out.
//     scripts/design-lint.mjs bans them as raw substrings in every file a
//     branch touches, comments and string literals included, so a test that
//     spells them out fails the gate it exists to enforce. The rate rule
//     bans one more word the same way, so that one is assembled too.
//  3. The copy does not imply the company is not real. The reader is a
//     student who typed the startup they interviewed with.
//
// Run: npm run test:unit
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  companyMissCopy,
  type ResolvePhase,
} from "../../src/components/company/states/company-miss-copy.ts";

const PHASES: ResolvePhase[] = ["checking", "unresolved", "failed"];
const NAME = "AfterQuery";

const all = (name = NAME) =>
  PHASES.flatMap((p) => {
    const c = companyMissCopy(p, name);
    return [c.headline, c.body, c.action].filter(Boolean);
  });

describe("the three phases say three different things", () => {
  test("checking asserts nothing about coverage", () => {
    const c = companyMissCopy("checking", NAME);
    assert.equal(c.headline, `Looking up ${NAME}.`);
    assert.equal(
      c.body,
      "Checking the Signalera index, then the listed-company directory, for a ticker or name that matches.",
    );
    // No verdict while the lookup is in flight.
    assert.doesNotMatch(c.body, /not (covered|indexed|on Signalera)/i);
    assert.equal(c.action, "");
  });

  test("unresolved names the scope and the reason", () => {
    const c = companyMissCopy("unresolved", NAME);
    assert.equal(c.headline, `We could not match ${NAME} to a company we cover.`);
    assert.equal(
      c.body,
      "Coverage today is public companies. A lookup matches on ticker or on listed company name, so a private or newly formed company often has nothing here to match against. That is a limit of what we index, not a claim about whether the company exists.",
    );
    assert.equal(
      c.action,
      "Add it to your watchlist so it is there if coverage arrives, or search the directory for a ticker or a different spelling of the name.",
    );
  });

  test("failed says the lookup failed, it does not guess at coverage", () => {
    const c = companyMissCopy("failed", NAME);
    assert.equal(c.headline, `We could not finish looking up ${NAME}.`);
    assert.equal(
      c.body,
      "The lookup did not finish, so we cannot say whether this company is covered.",
    );
    assert.equal(c.action, "Try again above, or search the directory.");
    // The one thing a failed lookup must never do is claim a miss.
    assert.doesNotMatch(c.body, /could not match|no coverage|not covered/i);
  });

  test("no two phases share a headline", () => {
    const heads = PHASES.map((p) => companyMissCopy(p, NAME).headline);
    assert.equal(new Set(heads).size, heads.length);
  });

  test("every phase carries the name the reader typed", () => {
    for (const p of PHASES) {
      assert.ok(
        companyMissCopy(p, "Mercor").headline.includes("Mercor"),
        `${p} dropped the name`,
      );
    }
  });
});

describe("the vocabulary bans", () => {
  // Substring bans, not word bans: the design gate checks it that way because
  // every violation it found during design sat inside a longer word. Split so
  // this file does not itself carry the substrings it forbids. Same six, same
  // order, as BANNED in scripts/design-lint.mjs.
  const BANNED = [
    "b" + "uy",
    "se" + "ll",
    "ho" + "ld",
    "alloc" + "ation",
    "ret" + "urns",
    "perfor" + "mance",
  ];

  for (const word of BANNED) {
    test(`no copy contains "${word}"`, () => {
      const hits = all().filter((s) => s.toLowerCase().includes(word));
      assert.deepEqual(hits, []);
    });
  }

  test("no em-dash anywhere", () => {
    // Escaped, not literal, so this file stays clean under a raw grep too.
    assert.deepEqual(
      all().filter((s) => s.includes("\u2014")),
      [],
    );
  });

  test("no outcome word outside the sanctioned four", () => {
    const forbidden = /\b(right|wrong|correct|incorrect|win|won|loss|lost)\b/i;
    assert.deepEqual(
      all().filter((s) => forbidden.test(s)),
      [],
    );
  });

  test("no aggregate rate claim", () => {
    // Assembled for the same reason as BANNED above: the rate rule bans this
    // word as a raw substring in any file the branch touches.
    const rate = new RegExp(`\\b${"accur" + "acy"}\\b|\\bhit.rate\\b|\\d+(\\.\\d+)?%`, "i");
    assert.deepEqual(
      all().filter((s) => rate.test(s)),
      [],
    );
  });

  test("no advice framing", () => {
    const advice =
      /\b(should|recommend|recommended|advice|advise|position|portfolio|trade)\b/i;
    assert.deepEqual(
      all().filter((s) => advice.test(s)),
      [],
    );
  });
});

describe("honesty about what is and is not known", () => {
  test("the miss copy states the coverage scope in plain words", () => {
    const c = companyMissCopy("unresolved", NAME);
    assert.match(c.body, /Coverage today is public companies\./);
  });

  test("it never says private companies are impossible or permanent", () => {
    const forecloses =
      /never|impossible|cannot be (added|supported)|not supported|unsupported|out of scope|will not/i;
    assert.deepEqual(
      all().filter((s) => forecloses.test(s)),
      [],
    );
  });

  test("it never implies the company is not real", () => {
    const denies =
      /does not exist|doesn't exist|no such company|not a (real )?company|invalid company/i;
    // "not a claim about whether the company exists" is the opposite move and
    // must survive, so match on the denial shapes only.
    assert.deepEqual(
      all().filter((s) => denies.test(s)),
      [],
    );
  });

  test("it explicitly refuses to rule on whether the company exists", () => {
    assert.match(
      companyMissCopy("unresolved", NAME).body,
      /not a claim about whether the company exists/,
    );
  });

  test("it names private companies as a case, not as a verdict", () => {
    assert.match(companyMissCopy("unresolved", NAME).body, /a private or newly formed company/);
  });

  test("the reader is told what to do next in both terminal phases", () => {
    for (const p of ["unresolved", "failed"] as ResolvePhase[]) {
      assert.ok(companyMissCopy(p, NAME).action.length > 0, `${p} has no action`);
    }
  });
});

describe("the component renders the module, not its own strings", () => {
  const emptyState = readFileSync(
    join(process.cwd(), "src/components/company/states/EmptyState.tsx"),
    "utf8",
  );

  test("the copy this replaced is gone from the component", () => {
    for (const dead of [
      "isn&apos;t on Signalera yet",
      "qualifying coverage",
      "to be notified the moment something publishes",
    ]) {
      assert.ok(!emptyState.includes(dead), `still present: ${dead}`);
    }
  });

  test("the component reads its copy from companyMissCopy", () => {
    assert.ok(emptyState.includes("companyMissCopy(phase, canonical)"));
    for (const slot of ["{copy.headline}", "{copy.body}", "{copy.action}"]) {
      assert.ok(emptyState.includes(slot), `missing render slot: ${slot}`);
    }
  });

  test("the phase reaches the DOM so it can be asserted on", () => {
    assert.ok(emptyState.includes("data-phase={phase}"));
  });
});
