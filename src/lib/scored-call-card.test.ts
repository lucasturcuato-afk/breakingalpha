/**
 * Tests for the three defects on the scored call card.
 *
 * Presentation only, so every assertion here is about what a reader SEES from a
 * given stored row. No stored verdict, grading rule or attribution calculation
 * is touched by anything under test.
 *
 * Pure, deterministic, no network, no DOM.
 * Run: npx tsx --test src/lib/scored-call-card.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { scoredCallProps, type CallOutcomeRow, type OpenCallInput } from "./scored-object-map.ts";
import { verdictWordForState, VERDICT_WORD, RESOLUTION_BY_STATE } from "./verdict-vocabulary.ts";
import { displayLoggedDate, resolutionPhrase } from "./call-horizons.ts";
import { RESOLVED_ZONE_TYPE } from "./scored-object-type-scale.ts";
import { buildLedgerLine } from "../components/calls/TrackCallControl.tsx";

const CALL: OpenCallInput = {
  claim_text: "MSFT outperforms its sector into Friday's close.",
  target_symbol: "MSFT",
  claim_type: "ticker",
  brief_date: "2026-08-01",
  created_at: "2026-08-01T13:00:00Z",
};

function outcome(over: Partial<CallOutcomeRow>): CallOutcomeRow {
  return {
    call_id: "c1",
    verdict: "correct",
    attribution: "clean",
    actual_pct_change: 3.27,
    actual_direction: "up",
    verdict_notes: null,
    graded_at: "2026-08-02T00:00:00Z",
    metadata: {
      entity_symbol: "MSFT",
      entity_move_pct: 3.27,
      benchmarks: [
        { symbol: "XLK", role: "sector", move_pct: -1.19, excess_pct: 4.46, meaningful_bar_pct: 0.75 },
        { symbol: "SPY", role: "market", move_pct: 0.32, excess_pct: 2.95, meaningful_bar_pct: 0.75 },
      ],
      thresholds_pct: { min_excess: 0.75 },
    },
    ...over,
  };
}

// ── 1. Vocabulary ──────────────────────────────────────────────────────────

test("each stored verdict maps to its observational term", () => {
  // End to end from the stored row, through the same mapper the card uses, to
  // the word the card renders when no explicit verdict prop is passed.
  const cases: Array<[Partial<CallOutcomeRow>, string | undefined]> = [
    [{ verdict: "correct", attribution: "clean" }, "Supported"],
    [{ verdict: "wrong", attribution: "clean" }, "Challenged"],
    [{ verdict: "partial", attribution: "clean" }, "No clean read"],
    [{ verdict: "correct", attribution: "confounded" }, "No clean read"],
    [{ verdict: "correct", attribution: "inconclusive" }, "No clean read"],
    // An absence is not a verdict: no word at all.
    [{ verdict: "ungradable", attribution: null }, undefined],
  ];
  for (const [over, expected] of cases) {
    const props = scoredCallProps(CALL, outcome(over), "2026-08-02");
    assert.equal(
      verdictWordForState(props.state),
      expected,
      `${over.verdict}/${over.attribution} should render ${expected}`,
    );
  }
});

test("no rendered verdict string contains Right or Wrong", () => {
  const words = Object.values(VERDICT_WORD).filter((w): w is string => !!w);
  assert.ok(words.length > 0);
  for (const w of words) {
    assert.doesNotMatch(w, /\bright\b/i, `"${w}" must not say right`);
    assert.doesNotMatch(w, /\bwrong\b/i, `"${w}" must not say wrong`);
  }
  // Every state the card can reach, including via the default path.
  for (const state of Object.keys(RESOLUTION_BY_STATE) as Array<keyof typeof RESOLUTION_BY_STATE>) {
    const word = verdictWordForState(state);
    if (!word) continue;
    assert.doesNotMatch(word, /\b(right|wrong)\b/i, `state ${state} rendered "${word}"`);
  }
});

// ── 2. The log date ────────────────────────────────────────────────────────

test("a claim logged today renders today's date, never a future one", () => {
  // The live row: adopted 20:22 PT on 2026-08-02, stamped in UTC as 2026-08-03.
  assert.equal(displayLoggedDate("2026-08-03", "2026-08-02"), "2026-08-02");
  const line = buildLedgerLine(
    { id: "x", resolution_window_start: "2026-08-03", resolution_window_end: "2026-08-04" },
    "2026-08-02",
  );
  assert.match(line, /LOGGED 2026-08-02/);
  assert.doesNotMatch(line, /LOGGED 2026-08-03/);
});

test("a correctly stamped log date is returned untouched", () => {
  // Clamping only ever moves backwards. A past log date is a fact.
  assert.equal(displayLoggedDate("2026-08-01", "2026-08-02"), "2026-08-01");
  assert.equal(displayLoggedDate("2026-08-02", "2026-08-02"), "2026-08-02");
  const line = buildLedgerLine(
    { id: "x", resolution_window_start: "2026-08-01", resolution_window_end: "2026-08-02" },
    "2026-08-02",
  );
  assert.match(line, /LOGGED 2026-08-01/);
  assert.match(line, /REVIEW 2026-08-02/);
});

test("a log date is never invented when there is none", () => {
  assert.equal(displayLoggedDate(null, "2026-08-02"), null);
  const line = buildLedgerLine(
    { id: "x", resolution_window_start: null, resolution_window_end: "2026-08-02" },
    "2026-08-02",
  );
  assert.doesNotMatch(line, /LOGGED/);
  assert.match(line, /REVIEW 2026-08-02/);
});

// ── 3. The resolution phrase ───────────────────────────────────────────────

test("a claim resolving today does not say tomorrow", () => {
  // The live defect: window 2026-08-01 -> 2026-08-02 is a one-day SPAN, and the
  // old path phrased the span deictically. Read on 08-02 it closes today.
  assert.equal(resolutionPhrase("2026-08-02", "2026-08-02"), "resolves at today's close");
  assert.notEqual(resolutionPhrase("2026-08-02", "2026-08-02"), "resolves tomorrow");
});

test("a claim resolving tomorrow does say tomorrow", () => {
  assert.equal(resolutionPhrase("2026-08-03", "2026-08-02"), "resolves tomorrow");
});

test("the phrase moves with the reader's date, not the window length", () => {
  const end = "2026-08-08";
  assert.equal(resolutionPhrase(end, "2026-08-01"), "resolves in about a week");
  assert.equal(resolutionPhrase(end, "2026-08-06"), "resolves in 2 days");
  assert.equal(resolutionPhrase(end, "2026-08-07"), "resolves tomorrow");
  assert.equal(resolutionPhrase(end, "2026-08-08"), "resolves at today's close");
  assert.equal(resolutionPhrase(end, "2026-08-09"), "resolved");
});

test("no phrase at all when there is no date to speak about", () => {
  assert.equal(resolutionPhrase(null, "2026-08-02"), null);
  assert.equal(resolutionPhrase("2026-08-02", null), null);
});

// ── 4. Hierarchy ───────────────────────────────────────────────────────────

/** px value of a type token, read from the real stylesheet. */
function tokenPx(name: string): number {
  const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
  const m = css.match(new RegExp(`${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  assert.ok(m, `${name} not found in styles/tokens.css`);
  return Number(m![1]);
}

test("the attribution line renders at higher prominence than the verdict label", () => {
  const attribution = tokenPx(RESOLVED_ZONE_TYPE.attribution.sizeVar);
  const verdict = tokenPx(RESOLVED_ZONE_TYPE.verdict.sizeVar);
  assert.ok(
    attribution > verdict,
    `attribution ${attribution}px must outrank verdict ${verdict}px`,
  );
  // And the evidence is not demoted below the grader's prose either.
  const calibration = tokenPx(RESOLVED_ZONE_TYPE.calibration.sizeVar);
  assert.ok(attribution > calibration, `attribution ${attribution}px vs calibration ${calibration}px`);
});

test("the attribution line still carries the benchmark evidence verbatim", () => {
  const props = scoredCallProps(CALL, outcome({}), "2026-08-02");
  assert.equal(props.state, "right");
  assert.match(props.attribution ?? "", /MSFT \+3\.27%/);
  assert.match(props.attribution ?? "", /XLK -1\.19%/);
  assert.match(props.attribution ?? "", /SPY \+0\.32%/);
});
