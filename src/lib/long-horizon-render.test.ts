/**
 * Rendering side of the long-horizon panel.
 *
 * The backend property test proves the panel can only ever remove wins. These
 * tests prove the UI does not undo that: a downgraded call must render as
 * "no clean read", must say why, and a long call must never present itself
 * with the same authority as a same-session one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributionGradeLabel,
  panelDowngradeNote,
  scoredCallProps,
  type CallOutcomeMetadata,
  type CallOutcomeRow,
} from "./scored-object-map.ts";

const CALL = {
  claim_text: "NVDA outperforms into year end.",
  target_symbol: "NVDA",
  claim_type: "ticker",
  brief_date: "2026-01-02",
  created_at: "2026-01-02T14:00:00Z",
};

const TODAY = "2026-04-01";

function meta(over: Partial<CallOutcomeMetadata> = {}): CallOutcomeMetadata {
  return {
    grader: "price_attribution_v1",
    entity_symbol: "NVDA",
    entity_move_pct: 12.4,
    thresholds_pct: { dead_band: 2.7, min_excess: 4.1 },
    benchmarks: [
      { symbol: "XLK", role: "sector", move_pct: 3.1, excess_pct: 9.3, meaningful_bar_pct: 2.7 },
      { symbol: "SPY", role: "market", move_pct: 2.0, excess_pct: 10.4, meaningful_bar_pct: 2.7 },
    ],
    window_sessions: 62,
    ...over,
  };
}

function outcome(over: Partial<CallOutcomeRow> = {}): CallOutcomeRow {
  return {
    call_id: "c1",
    verdict: "correct",
    attribution: "clean",
    actual_pct_change: 0.124,
    actual_direction: "up",
    verdict_notes: null,
    graded_at: "2026-04-01T22:00:00Z",
    metadata: meta(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The confidence label
// ---------------------------------------------------------------------------

test("a short call adds no horizon label at all", () => {
  // Short calls keep benchmark attribution alone; the grader emits no panel
  // keys for them, so there is nothing to say.
  assert.equal(attributionGradeLabel(meta({ attribution_grade: "high" })), null);
  assert.equal(attributionGradeLabel(meta({})), null);
  assert.equal(attributionGradeLabel(null), null);
});

test("a long clean call reads as a directional read, not a strong one", () => {
  const label = attributionGradeLabel(
    meta({ attribution_grade: "moderate", window_sessions: 62 }),
  );
  assert.ok(label);
  assert.match(label, /directional read/i);
  assert.match(label, /62 sessions/);
  // It must not claim more than it can support.
  assert.doesNotMatch(label, /proven|confirmed|caused/i);
});

test("a long call with no interim evidence says so rather than implying it had some", () => {
  const label = attributionGradeLabel(
    meta({ attribution_grade: "directional", window_sessions: 45 }),
  );
  assert.ok(label);
  assert.match(label, /no interim benchmark evidence/i);
});

test("nothing cleanly attributed carries no grade label", () => {
  assert.equal(attributionGradeLabel(meta({ attribution_grade: "none" })), null);
});

// ---------------------------------------------------------------------------
// The downgrade is never silent
// ---------------------------------------------------------------------------

const DOWNGRADED = meta({
  attribution_grade: "none",
  horizon_class: "long",
  checkpoints: [
    {
      fraction: 0.333,
      date: "2026-01-30",
      sessions: 21,
      entity_pct: -6.2,
      signed_excess_pct: -8.4,
      bar_pct: 3.4,
      disagrees: true,
    },
    {
      fraction: 0.667,
      date: "2026-02-27",
      sessions: 41,
      entity_pct: 1.1,
      signed_excess_pct: 0.9,
      bar_pct: 4.8,
      disagrees: false,
    },
  ],
  panel: {
    agreed: false,
    downgraded: true,
    pre_panel_verdict: "correct",
    pre_panel_attribution: "clean",
  },
});

test("a downgraded call explains itself, naming the checkpoint it trailed at", () => {
  const note = panelDowngradeNote(DOWNGRADED);
  assert.ok(note);
  assert.match(note, /2026-01-30/);
  assert.match(note, /no clean read/i);
  assert.match(note, /not a win/i);
  // Only the disagreeing checkpoint is named.
  assert.doesNotMatch(note, /2026-02-27/);
});

test("an agreeing panel produces no downgrade note", () => {
  assert.equal(
    panelDowngradeNote(
      meta({
        panel: {
          agreed: true,
          downgraded: false,
          pre_panel_verdict: "correct",
          pre_panel_attribution: "clean",
        },
      }),
    ),
    null,
  );
  assert.equal(panelDowngradeNote(null), null);
});

// ---------------------------------------------------------------------------
// End to end through the real mapper
// ---------------------------------------------------------------------------

test("a panel-downgraded call renders as inconclusive, never as a win", () => {
  // This is the row the backend writes after a downgrade: partial/inconclusive.
  const props = scoredCallProps(
    CALL,
    outcome({ verdict: "partial", attribution: "inconclusive", metadata: DOWNGRADED }),
    TODAY,
  );
  assert.equal(props.state, "inconclusive");
  assert.notEqual(props.state, "right");
  assert.ok(props.attribution);
  assert.match(props.attribution, /trailed its benchmarks/i);
});

test("a downgraded call never claims it was below the bar when it cleared it", () => {
  // Regression: the generic inconclusive line reads "below the attribution
  // bar". AMD cleared a 5.95% bar by 40 points and was downgraded for
  // trailing at its checkpoints, so appending that line published a sentence
  // its own numbers contradicted.
  const props = scoredCallProps(
    CALL,
    outcome({
      verdict: "partial",
      attribution: "inconclusive",
      metadata: { ...DOWNGRADED, entity_move_pct: 52.92 },
    }),
    TODAY,
  );
  assert.ok(props.attribution);
  assert.doesNotMatch(props.attribution, /below the/i);
  assert.match(props.attribution, /trailed its benchmarks/i);
});

test("a clean long win renders as right and carries the honest label", () => {
  const props = scoredCallProps(
    CALL,
    outcome({
      metadata: meta({
        attribution_grade: "moderate",
        horizon_class: "long",
        panel: {
          agreed: true,
          downgraded: false,
          pre_panel_verdict: "correct",
          pre_panel_attribution: "clean",
        },
      }),
    }),
    TODAY,
  );
  assert.equal(props.state, "right");
  assert.ok(props.attribution);
  // The benchmark evidence still leads; the horizon label is a suffix.
  assert.match(props.attribution, /NVDA \+12\.40%/);
  assert.match(props.attribution, /directional read/i);
});

test("a short call's rendering is untouched by the panel work", () => {
  const shortMeta = meta({});
  delete shortMeta.window_sessions;
  const props = scoredCallProps(CALL, outcome({ metadata: shortMeta }), TODAY);
  assert.equal(props.state, "right");
  assert.ok(props.attribution);
  assert.doesNotMatch(props.attribution, /directional read/i);
  assert.doesNotMatch(props.attribution, /trailed/i);
});

test("a wrong call is never rewritten into no-clean-read by any panel field", () => {
  // The backend cannot produce this, but the mapper must not invent it either:
  // a wrong verdict renders wrong even when panel metadata is present.
  const props = scoredCallProps(
    CALL,
    outcome({ verdict: "wrong", attribution: "clean", metadata: DOWNGRADED }),
    TODAY,
  );
  assert.equal(props.state, "wrong");
});
