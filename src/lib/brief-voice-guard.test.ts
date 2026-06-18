/**
 * Unit tests for brief-voice-guard.ts. Pure, deterministic, no network.
 * Run: npx tsx --test src/lib/brief-voice-guard.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectVoiceViolations,
  hasVoiceViolation,
  enforceBriefVoice,
} from "./brief-voice-guard";

// A clean, impersonal, informational brief that must pass untouched. It
// deliberately includes near-miss tokens that must NOT trip the detector:
// "sell-side", "buy-side", "the sell-off", "buyers", "Phase I", "long-term",
// "increase revenue".
const CLEAN_BRIEF = `**Analyst Brief**
A $1.75 trillion valuation range now anchors the debate. The filing points to a deliberate capital-structure shift, and sell-side coverage has turned more constructive into the Phase I readout. Buyers stepped in after the sell-off, which buy-side desks read as positioning rather than conviction. Revenue is expected to increase as the order book builds.

**What To Watch**
If the SEC accepts the registration by quarter-end: the thesis that demand is structural holds, and the long-term margin path strengthens. If the review slips past Q3: the thesis weakens because the runway narrows. The first outcome looks more likely given the order book.

**Signal Quality**
High.`;

// ---------------------------------------------------------------------------
// First-person detection
// ---------------------------------------------------------------------------

test("first person: plural 'we' is flagged", () => {
  const v = detectVoiceViolations("We see the order book tightening.");
  assert.ok(v.firstPerson.includes("we"));
});

test("first person: 'us' and 'our' are flagged", () => {
  const v = detectVoiceViolations("This matters to us and to our thesis.");
  assert.ok(v.firstPerson.includes("us"));
  assert.ok(v.firstPerson.includes("our"));
});

test("first person: singular 'I' / 'my' are flagged", () => {
  const v = detectVoiceViolations("I believe my read is correct.");
  assert.ok(v.firstPerson.includes("i"));
  assert.ok(v.firstPerson.includes("my"));
});

test("first person: contractions ('we've', 'let's') are flagged", () => {
  const v = detectVoiceViolations("We've seen this before, so let's move on.");
  assert.ok(v.firstPerson.includes("we've"));
  assert.ok(v.firstPerson.includes("let's"));
});

test("first person: enumerators like 'Phase I' do NOT trip bare-I", () => {
  const v = detectVoiceViolations("The Phase I trial and the Class I shares cleared review.");
  assert.equal(v.firstPerson.length, 0);
});

// ---------------------------------------------------------------------------
// Recommendation / exposure detection
// ---------------------------------------------------------------------------

test("recommendation: 'We recommend increasing exposure' is flagged on both axes", () => {
  const v = detectVoiceViolations("We recommend increasing exposure into the print.");
  assert.ok(v.firstPerson.includes("we"));
  assert.ok(v.recommendations.includes("recommend"));
  assert.ok(v.recommendations.some((r) => r.includes("exposure")));
});

test("recommendation: 'reduce exposure' is flagged", () => {
  const v = detectVoiceViolations("Reduce exposure if the stock declines 15%.");
  assert.ok(v.recommendations.some((r) => r.includes("reduce exposure")));
});

test("recommendation: buy / sell calls are flagged", () => {
  assert.ok(detectVoiceViolations("Buy the dip here.").recommendations.includes("buy"));
  assert.ok(detectVoiceViolations("Sell into strength.").recommendations.includes("sell"));
});

test("recommendation: overweight / underweight are flagged", () => {
  assert.ok(detectVoiceViolations("Move to overweight.").recommendations.includes("overweight"));
  assert.ok(detectVoiceViolations("Go underweight here.").recommendations.includes("underweight"));
});

test("recommendation: 'you should' and 'trim' / 'add to position' are flagged", () => {
  assert.ok(detectVoiceViolations("You should wait for the filing.").recommendations.some((r) => r.startsWith("you should")));
  assert.ok(detectVoiceViolations("Trim the position into the rally.").recommendations.some((r) => r.includes("trim")));
  assert.ok(detectVoiceViolations("Add to position on weakness.").recommendations.some((r) => r.includes("add to") ));
});

test("recommendation: near-misses do NOT false-positive", () => {
  const v = detectVoiceViolations(
    "Sell-side and buy-side desks watched the sell-off as buyers returned; revenue should increase.",
  );
  assert.equal(v.recommendations.length, 0, JSON.stringify(v.recommendations));
});

// ---------------------------------------------------------------------------
// Clean brief passes whole
// ---------------------------------------------------------------------------

test("clean impersonal brief has zero violations", () => {
  const v = detectVoiceViolations(CLEAN_BRIEF);
  assert.equal(v.firstPerson.length, 0, `firstPerson: ${JSON.stringify(v.firstPerson)}`);
  assert.equal(v.recommendations.length, 0, `recommendations: ${JSON.stringify(v.recommendations)}`);
  assert.equal(hasVoiceViolation(CLEAN_BRIEF), false);
});

// ---------------------------------------------------------------------------
// enforceBriefVoice: detect -> bounded re-ask -> safe fallback
// ---------------------------------------------------------------------------

test("enforce: clean brief returns unchanged and never calls regenerate", async () => {
  let calls = 0;
  const res = await enforceBriefVoice(CLEAN_BRIEF, {
    regenerate: async () => {
      calls++;
      return "should not be called";
    },
  });
  assert.equal(calls, 0);
  assert.equal(res.reasked, false);
  assert.equal(res.stillViolating, false);
  assert.equal(res.memo, CLEAN_BRIEF);
});

test("enforce: violating brief re-asks once and adopts a clean rewrite", async () => {
  let calls = 0;
  const dirty = "We recommend increasing exposure into the print.";
  const res = await enforceBriefVoice(dirty, {
    regenerate: async () => {
      calls++;
      return CLEAN_BRIEF;
    },
  });
  assert.equal(calls, 1);
  assert.equal(res.reasked, true);
  assert.equal(res.stillViolating, false);
  assert.equal(res.memo, CLEAN_BRIEF);
  assert.ok(res.violationsBefore.firstPerson.includes("we"));
});

test("enforce: persistent violation falls back to least-violating and flags it", async () => {
  let calls = 0;
  const dirty = "We recommend increasing exposure and we expect buyers.";
  const lessDirty = "Filings point to increasing exposure risk."; // 1 violation, no first person
  const res = await enforceBriefVoice(dirty, {
    maxReasks: 1,
    regenerate: async () => {
      calls++;
      return lessDirty;
    },
  });
  assert.equal(calls, 1);
  assert.equal(res.reasked, true);
  assert.equal(res.stillViolating, true);
  assert.equal(res.memo, lessDirty); // adopted because it had fewer violations
});

test("enforce: a re-ask that does not help keeps the original draft", async () => {
  const dirty = "We recommend buying."; // 2 violations
  const worse = "We recommend buying and we should add to position."; // more violations
  const res = await enforceBriefVoice(dirty, {
    regenerate: async () => worse,
  });
  assert.equal(res.stillViolating, true);
  assert.equal(res.memo, dirty); // original kept; re-ask was not an improvement
});

test("enforce: null re-ask (model failure) falls back safely", async () => {
  const dirty = "We recommend increasing exposure.";
  const res = await enforceBriefVoice(dirty, {
    regenerate: async () => null,
  });
  assert.equal(res.reasked, true);
  assert.equal(res.stillViolating, true);
  assert.equal(res.memo, dirty);
});
