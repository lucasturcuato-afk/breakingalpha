import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Rule 1 of scripts/design-lint.mjs, exercised end to end.
//
// WHY THIS FILE EXISTS. Until issue 866 the rule skipped every comment-only
// line, so a banned substring in prose passed clean. Four reached merged
// commits on fix/user-profile-read-failures and design-lint reported zero. The
// script carries its own SELFTEST, which runs on every invocation and is the
// stronger gate of the two, but nothing under `npm run test:unit` reached it,
// so a regression in the rule could not fail the test suite.
//
// This file drives the real script over real files on disk. It is listed in
// EXCLUDE_FILES in design-lint.mjs for the same reason e2e/pressure/lib/rules.ts
// is: a file that tests a substring ban has to contain the banned substrings.
// ---------------------------------------------------------------------------

type Finding = { level: string; rule: string; line: number };

function lint(source: string, ext = ".ts"): Finding[] {
  const dir = mkdtempSync(join(tmpdir(), "design-lint-"));
  const file = join(dir, `specimen${ext}`);
  try {
    writeFileSync(file, source);
    const run = spawnSync("node", ["scripts/design-lint.mjs", file], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    // Exit 2 is a refusal: a broken self-test or a run that cannot be trusted.
    // Surfacing it here beats asserting against an empty finding list.
    assert.notEqual(run.status, 2, `design-lint refused to run:\n${run.stderr}`);
    return (run.stdout || "")
      .split("\n")
      .map((l) => /^(ERROR|WARN)\s+\S+:(\d+)\s+\[([a-z-]+)\]/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ level: m[1], line: Number(m[2]), rule: m[3] }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rule1 = (f: Finding[]) =>
  f.filter((x) => x.rule.startsWith("banned-"));
const errors = (f: Finding[]) =>
  rule1(f).filter((x) => x.level === "ERROR");

// ---------------------------------------------------------------------------
// The ground truth: the four that slipped through.
//
// Recovered from 6a61327c, "Clear four banned substrings from the comments this
// branch added". Each is the PRE-fix text, reproduced inside the comment block
// it lived in so the scanner sees it as the comment line it was. Three are
// forms of one word, one is a verb meaning "gains". design-lint reported none
// of them before this change.
// ---------------------------------------------------------------------------

const RECOVERED_FOUR: Array<[string, string]> = [
  [
    "onboarding/page.tsx",
    "/**\n * `OnboardingWizard.tsx:572` PATCHes every field it holds plus\n * `onboarding_completed: true`.\n */",
  ],
  [
    "mobile-settings-screen.tsx",
    "/**\n * This one is the opposite case: the fields hold nothing that\n * came from the reader's stored profile.\n */",
  ],
  [
    "read.test.ts",
    "/**\n * They fail the BUILD if the union ever stops holding, because an\n * unused `@ts-expect-error` is itself a tsc error.\n */",
  ],
  [
    "read.ts",
    "/**\n * Wrapping something that already discriminates buys nothing. This\n * type earns its place in exactly two places:\n */",
  ],
];

for (const [origin, source] of RECOVERED_FOUR) {
  test(`rule 1 flags the substring that reached ${origin}`, () => {
    assert.equal(errors(lint(source)).length, 1);
  });
}

// ---------------------------------------------------------------------------
// The plainest shapes, so the rule is not passing the four by accident.
// ---------------------------------------------------------------------------

test("a banned substring in a plain line comment is an error", () => {
  assert.equal(errors(lint("// the section draws before the allocation is known")).length, 1);
});

test("a banned substring in a plain identifier is an error", () => {
  assert.equal(errors(lint("export const performanceOfTheGrid = 1;\n")).length, 1);
});

test("a banned substring in a JSX comment is an error", () => {
  assert.equal(
    errors(lint("export const A = () => <div>{/* buy and sell, in a marker */}</div>;\n", ".tsx")).length,
    2,
  );
});

test("a banned substring in a rendered string is still an error", () => {
  // The widening must not change what rule 1 says about text a reader can see.
  assert.equal(errors(lint('export const LABEL = "performance";\n')).length, 1);
});

// ---------------------------------------------------------------------------
// The negatives. A gate that fires on legitimate English gets switched off, and
// then the rule is enforced by nothing at all.
// ---------------------------------------------------------------------------

test("the ordinary-English allowlist passes as whole words", () => {
  const src = [
    "const a = threshold;",
    "const b = household;",
    "const c = stakeholder;",
    "const d = withholding;",
    'const e = { placeholder: "Search" };',
    "const f = Russell;",
    "",
  ].join("\n");
  assert.equal(errors(lint(src)).length, 0);
});

test("the same words pass as identifier segments, which is what \\b missed", () => {
  // Every line here was an ERROR on bf1ad927 and is a real name in src.
  const src = [
    "const a = { match_threshold: 0.25 };",
    "const b = viewportThreshold;",
    "const c = thresholdNum + threshold_scale;",
    "const d = SIMILARITY_THRESHOLD;",
    "const e = pillRussell + russellPct;",
    "const f = SCORECARD.RUSSELL;",
    "",
  ].join("\n");
  assert.equal(errors(lint(src)).length, 0);
});

test("the granted stored identifiers still pass", () => {
  const src = "const a = facts.stockholders_equity;\nconst b = meta.thresholds_pct;\n";
  assert.equal(errors(lint(src)).length, 0);
});

test("segment anchoring did not widen into the identifiers that must fail", () => {
  // The boundary the script argues for in STORED_IDENTIFIERS. Same shape as the
  // granted ones, and all three are real hits.
  const src = "const n = row.shareholder_count;\nconst v = row.holdings_value;\nconst r = row.buyback_ratio;\n";
  assert.equal(errors(lint(src)).length, 3);
});

test("legitimate prose with no banned substring stays clean", () => {
  const src = [
    "/**",
    " * The loader answers before the effect settles, so the caller reads a",
    " * value that is already stale. Passing the identity down as a prop keeps",
    " * the two in step without a second read.",
    " */",
    "export const READY = true;",
    "",
  ].join("\n");
  assert.equal(rule1(lint(src)).length, 0);
});

// ---------------------------------------------------------------------------
// The two ways a comment hit prints without failing. Neither is silent.
// ---------------------------------------------------------------------------

test("`returns` in a doc comment warns and does not fail", () => {
  const f = rule1(lint("/**\n * Returns null when there is no date to speak about.\n */\n"));
  assert.equal(f.length, 1);
  assert.equal(f[0].level, "WARN");
  assert.equal(f[0].rule, "banned-in-comment");
});

test("the line marker downgrades a comment to a warning and prints the reason", () => {
  const src = '/**\n * forbids "buy" and "sell"  design-lint-allow: names the words it forbids\n */\n';
  const f = rule1(lint(src));
  assert.equal(errors(f).length, 0);
  assert.equal(f.length, 2);
  assert.ok(f.every((x) => x.rule === "banned-marked"));
});

test("the line marker grants nothing on a code line", () => {
  // Rendered copy lives in string literals on code lines. No marker anyone
  // writes may weaken rule 1 there.
  const src = 'export const LABEL = "performance"; // design-lint-allow: not a real reason\n';
  assert.equal(errors(lint(src)).length, 1);
});

test("a marker with no reason after the colon is not a marker", () => {
  assert.equal(errors(lint("// the fields hold nothing  design-lint-allow:\n")).length, 1);
});
