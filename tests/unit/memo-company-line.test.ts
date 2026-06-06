// Contract test for memo company-identifier threading (string/parser layer).
//
// Each memo surface now threads its subject company into the prompt content
// via withCompanyLine(). The server persists content.target_company by
// parsing the first `COMPANY: <name>` line (WD126,
// src/app/api/memo/route.ts extractCompanyFromContent). That parser is not
// exported (route.ts is Lucas-protected), so parseLikeWD126 below is a
// line-for-line mirror of its logic; if route.ts's parser changes, update
// this mirror alongside it.
//
// What this proves, offline and with zero spend: for every updated surface's
// representative content shape, the body the surface now sends yields a
// resolvable company at the string layer. It does not prove the DB write
// (that is the gated manual check documented in the PR).
//
// Run: node --test tests/unit/memo-company-line.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { withCompanyLine } from "../../src/lib/memo-company-line.ts";

/** Mirror of extractCompanyFromContent (src/app/api/memo/route.ts, WD126). */
function parseLikeWD126(content: string): string | null {
  try {
    if (!content || typeof content !== "string") return null;
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*COMPANY\s*:\s*(.+?)\s*$/i);
      if (m && m[1]) {
        const value = m[1].trim();
        if (value.length === 0 || value.length > 200) return null;
        return value;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// --- Representative surface shapes ---------------------------------------

test("story card / feed row / dc-story-row shape resolves (title + summary)", () => {
  const content = withCompanyLine(
    ["NVIDIA tops earnings estimates", "Shares rose 4% after the chipmaker beat consensus."].join("\n\n"),
    "NVIDIA",
  );
  assert.equal(parseLikeWD126(content), "NVIDIA");
});

test("deal-flow shape resolves and COMPANY wins over TARGET", () => {
  const content = withCompanyLine(
    [
      "TARGET: Marvell Technology",
      "ACQUIRER: Undisclosed",
      "TYPE: M&A",
      "VALUE: $1.2B",
      "STATUS: Rumored",
      "SECTOR: Technology",
    ].join("\n"),
    "Marvell Technology",
  );
  assert.equal(parseLikeWD126(content), "Marvell Technology");
});

test("watchlist article shape resolves (title + source)", () => {
  const content = withCompanyLine("Chevron expands Permian output\nReuters", "Chevron");
  assert.equal(parseLikeWD126(content), "Chevron");
});

test("watchlist identifier article shape resolves (title + source + summary)", () => {
  const content = withCompanyLine(
    "Goldman Sachs names new CFO\nBloomberg\n\nThe bank announced a leadership change.",
    "Goldman Sachs",
  );
  assert.equal(parseLikeWD126(content), "Goldman Sachs");
});

// --- No-company and guard behavior ----------------------------------------

test("no company leaves content unchanged and unresolvable", () => {
  const original = "Some headline\n\nSome summary";
  assert.equal(withCompanyLine(original, undefined), original);
  assert.equal(withCompanyLine(original, null), original);
  assert.equal(parseLikeWD126(original), null);
});

test("empty and whitespace-only company leaves content unchanged", () => {
  const original = "Headline\n\nSummary";
  assert.equal(withCompanyLine(original, ""), original);
  assert.equal(withCompanyLine(original, "   "), original);
});

test("over-200-char company is not prepended (parser would reject it)", () => {
  const original = "Headline";
  assert.equal(withCompanyLine(original, "A".repeat(201)), original);
});

test("company containing a newline is not prepended", () => {
  const original = "Headline";
  assert.equal(withCompanyLine(original, "Evil\nCorp"), original);
});

test("company is trimmed before prepending", () => {
  const content = withCompanyLine("Headline", "  Alphabet  ");
  assert.equal(parseLikeWD126(content), "Alphabet");
});

// --- First-line-wins and non-collision guards ------------------------------

test("prepended COMPANY line wins over a later COMPANY line in content", () => {
  const content = withCompanyLine("Quote of the day\nCOMPANY: SomeOtherCo", "NVIDIA");
  assert.equal(parseLikeWD126(content), "NVIDIA");
});

test("a 'Companies:' list line (trends-style content) does not match the parser", () => {
  // Regression guard: prose containing `Companies: A, B` must not be
  // mistaken for a COMPANY: anchor by the WD126 regex.
  assert.equal(parseLikeWD126("Companies: NVIDIA, AMD, Intel"), null);
});
