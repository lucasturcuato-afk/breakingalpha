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

test("recommendation: 'sold off', space-separated 'sell off', and 'buyout' do NOT false-positive", () => {
  const v = detectVoiceViolations(
    "The stock sold off hard, a leveraged buyout closed, and the sell off deepened.",
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

// FAIL-CLOSED on recommendations: a recommendation must never survive the
// fallback, even if first person does. helper asserts the surfaced brief is
// provably free of any recommendation/exposure phrase.
const recsIn = (s: string) => detectVoiceViolations(s).recommendations;

test("enforce: fallback NEVER surfaces a recommendation (double failure, both contain one)", async () => {
  // Draft and re-ask both contain a recommendation; the re-ask has a compliant
  // sentence that must survive redaction while the recommendation is removed.
  const dirty = "The filing shifts the capital structure. We recommend increasing exposure.";
  const reask = "Analysts recommend buying the stock. The order book points to demand.";
  const res = await enforceBriefVoice(dirty, { regenerate: async () => reask });
  assert.equal(res.reasked, true);
  assert.deepEqual(recsIn(res.memo), [], `leftover recommendation: ${res.memo}`);
  assert.ok(res.memo.includes("order book"), "compliant sentence should survive");
  assert.ok(!/recommend|\bbuy\b/i.test(res.memo), "offending sentence should be gone");
});

test("enforce: recommendation-free draft wins even though it has first person", async () => {
  // Draft has a recommendation; re-ask drops the recommendation but keeps "we".
  // The recommendation-free draft must win; first person may remain.
  const dirty = "We recommend buying.";
  const reask = "We see the order book tightening."; // first person, NO recommendation
  const res = await enforceBriefVoice(dirty, { regenerate: async () => reask });
  assert.equal(res.memo, reask);
  assert.deepEqual(recsIn(res.memo), []);
  assert.ok(res.violationsBefore.firstPerson.includes("we"));
  assert.equal(res.stillViolating, true); // leftover first person is acceptable
});

test("enforce: all drafts carry a recommendation -> redacted recommendation-free, first person may remain", async () => {
  const dirty = "We expect demand. We recommend buying."; // compliant fp sentence + offending sentence
  const reask = "We recommend selling. We see the order book."; // offending + compliant fp sentence
  const res = await enforceBriefVoice(dirty, { regenerate: async () => reask });
  assert.deepEqual(recsIn(res.memo), [], `leftover recommendation: ${res.memo}`);
  assert.ok(detectVoiceViolations(res.memo).firstPerson.includes("we"), "first person may remain");
  assert.ok(!/recommend|\bbuy\b/i.test(res.memo));
});

test("enforce: null re-ask (model failure) redacts the original to recommendation-free", async () => {
  const dirty = "The filing shifts strategy. We recommend increasing exposure.";
  const res = await enforceBriefVoice(dirty, { regenerate: async () => null });
  assert.equal(res.reasked, true);
  assert.deepEqual(recsIn(res.memo), []);
  assert.ok(res.memo.includes("filing shifts strategy"), "compliant content survives");
});

test("enforce: invariant -- no double-failure shape ever surfaces a recommendation", async () => {
  const pairs: Array<[string, string]> = [
    ["We recommend increasing exposure.", "Analysts recommend buying the stock."],
    ["Buy the dip.", "Sell into strength."],
    ["Move to overweight here.", "Go underweight instead."],
    ["You should add to position.", "Trim the position into the rally."],
    ["Take profits now.", "We recommend reducing exposure."],
  ];
  for (const [draft, reask] of pairs) {
    const res = await enforceBriefVoice(draft, { regenerate: async () => reask });
    assert.deepEqual(recsIn(res.memo), [], `shape leaked: draft=${draft} reask=${reask} memo=${res.memo}`);
  }
});
