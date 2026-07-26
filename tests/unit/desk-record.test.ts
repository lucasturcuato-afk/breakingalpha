// Unit tests for the desk call-record model (src/lib/desk-record.ts).
//
// The record surface (src/components/record/DeskRecordView.tsx) is a 1:1
// render of this model, so testing the model here is testing what the user
// sees. Same "test the pure decision the component renders verbatim" pattern
// as company-tab-empty-state.test.ts, because the .tsx cannot load in node.
//
// What is locked:
//   1. Counts are correct across a fixture covering EVERY verdict x
//      attribution combination, and the buckets always sum to the row count.
//   2. Challenged (wrong) and No-clean-read entries are present in the
//      rendered list, never filtered or collapsed.
//   3. A confounded move is never counted as supported, whatever the verdict.
//   4. An empty result set renders the empty state and does not throw.
//   5. No investment-result vocabulary (returns / performance / gains /
//      profit) appears in any string the surface authors or renders, with
//      one documented carve-out: the desk's own claim text is reproduced
//      verbatim and is never rewritten.
//
// Run: node --test tests/unit/desk-record.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeskRecord,
  deskRecordAuthoredStrings,
  DESK_RECORD_COPY,
  RESOLUTION_ORDER,
  type DeskCallRow,
  type Resolution,
} from "../../src/lib/desk-record.ts";

const TODAY_PT = "2026-07-26";

const VERDICTS = ["correct", "wrong", "partial", "ungradable"] as const;
const ATTRIBUTIONS = ["clean", "confounded", "inconclusive", null] as const;

/** Realistic grader metadata so the attribution lines render their evidence. */
function meta(symbol: string) {
  return {
    grader: "price_attribution",
    entity_symbol: symbol,
    tier: "sector",
    thresholds_pct: { dead_band: 0.25, min_excess: 0.75 },
    entity_move_pct: 2.31,
    benchmarks: [
      { symbol: "XLK", role: "sector", move_pct: 0.42, excess_pct: 1.89, meaningful_bar_pct: 0.3 },
      { symbol: "SPY", role: "market", move_pct: 0.15, excess_pct: 2.16, meaningful_bar_pct: 0.3 },
    ],
    benchmark_coverage: "full",
    attribution_confidence: 0.8,
    window: { from: "2026-07-20", to: "2026-07-21" },
    ungradable_reason: "no_price_data",
  };
}

/** One row per verdict x attribution combination: 16 rows, no gaps. */
function fullMatrix(): DeskCallRow[] {
  const rows: DeskCallRow[] = [];
  let i = 0;
  for (const verdict of VERDICTS) {
    for (const attribution of ATTRIBUTIONS) {
      i += 1;
      const id = `call-${i}`;
      const day = String(i).padStart(2, "0");
      rows.push({
        call: {
          id,
          claim_text: `Call ${i}: ${verdict} with ${attribution ?? "no"} attribution.`,
          target_symbol: "NVDA",
          claim_type: "ticker",
          brief_date: `2026-07-${day}`,
          created_at: `2026-07-${day}T13:00:00Z`,
          confidence: 0.7,
        },
        outcome: {
          call_id: id,
          verdict,
          attribution,
          actual_pct_change: 2.31,
          actual_direction: "up",
          verdict_notes: "Grader prose that the record surface deliberately does not render.",
          graded_at: `2026-07-${day}T23:00:00Z`,
          metadata: meta("NVDA"),
        },
      });
    }
  }
  return rows;
}

// Derived from scoredCallProps, which the model defers to:
//   ungradable (any attribution)      -> notGraded   (4)
//   null attribution (non-ungradable) -> notGraded   (3)
//   correct + clean                   -> supported   (1)
//   wrong   + clean                   -> challenged  (1)
//   everything else attributed        -> noCleanRead (7)
const EXPECTED: Record<Resolution, number> = {
  supported: 1,
  challenged: 1,
  noCleanRead: 7,
  notGraded: 7,
};

test("counts render correctly across every verdict x attribution combination", () => {
  const rows = fullMatrix();
  assert.equal(rows.length, 16, "fixture must cover all 16 combinations");

  const record = buildDeskRecord(rows, TODAY_PT);

  assert.equal(record.total, 16);
  assert.deepEqual(record.byResolution, EXPECTED);

  // Buckets partition the record: nothing is dropped, nothing double counted.
  const summed = RESOLUTION_ORDER.reduce((n, r) => n + record.byResolution[r], 0);
  assert.equal(summed, record.total);

  // Raw distributions are reported exactly as stored.
  assert.deepEqual(record.byVerdict, {
    correct: 4,
    wrong: 4,
    partial: 4,
    ungradable: 4,
  });
  assert.deepEqual(record.byAttribution, {
    clean: 4,
    confounded: 4,
    inconclusive: 4,
    unattributed: 4,
  });

  assert.equal(record.firstBriefDate, "2026-07-01");
  assert.equal(record.lastBriefDate, "2026-07-16");

  console.log("counts:", JSON.stringify(record.byResolution));
  console.log("byVerdict:", JSON.stringify(record.byVerdict));
  console.log("byAttribution:", JSON.stringify(record.byAttribution));
});

test("counts cover every row even when the rendered list is capped", () => {
  const record = buildDeskRecord(fullMatrix(), TODAY_PT, 3);
  assert.equal(record.entries.length, 3);
  assert.equal(record.total, 16);
  assert.deepEqual(record.byResolution, EXPECTED);
});

test("wrong and no-clean-read entries are present in the output, not filtered", () => {
  const record = buildDeskRecord(fullMatrix(), TODAY_PT);

  assert.equal(record.entries.length, 16, "every graded row is rendered");

  const challenged = record.entries.filter((e) => e.resolution === "challenged");
  const noCleanRead = record.entries.filter((e) => e.resolution === "noCleanRead");
  const supported = record.entries.filter((e) => e.resolution === "supported");

  assert.ok(challenged.length > 0, "a wrong call must appear in the list");
  assert.ok(noCleanRead.length > 0, "a no-clean-read call must appear in the list");
  assert.equal(challenged.length, EXPECTED.challenged);
  assert.equal(noCleanRead.length, EXPECTED.noCleanRead);

  // Misses carry a real verdict word, same as hits. Nothing is blanked out.
  assert.equal(challenged[0].verdictLabel, DESK_RECORD_COPY.bucketLabel.challenged);
  assert.equal(noCleanRead[0].verdictLabel, DESK_RECORD_COPY.bucketLabel.noCleanRead);
  assert.equal(supported[0].verdictLabel, DESK_RECORD_COPY.bucketLabel.supported);

  // Misses carry their attribution evidence, same as hits.
  assert.ok(challenged[0].attributionNote, "a miss must still show its evidence");
  assert.ok(noCleanRead[0].attributionNote);

  // The desk's own words are reproduced verbatim, never rewritten.
  const wrongClean = record.entries.find((e) => e.id === "call-5");
  assert.equal(wrongClean?.resolution, "challenged");
  assert.equal(wrongClean?.claim, "Call 5: wrong with clean attribution.");

  // Reverse chronological, newest brief first.
  const dates = record.entries.map((e) => e.briefDate);
  assert.deepEqual(dates, [...dates].sort().reverse());

  console.log(
    "rendered resolutions:",
    JSON.stringify(record.entries.map((e) => e.resolution)),
  );
  console.log("a challenged entry:", JSON.stringify(challenged[0].props.verdict), challenged[0].claim);
  console.log("a no-clean-read entry:", noCleanRead[0].attributionNote);
});

test("a confounded move is never counted as supported", () => {
  const record = buildDeskRecord(fullMatrix(), TODAY_PT);
  const confounded = record.entries.filter(
    (e) => e.id === "call-2" || e.id === "call-6" || e.id === "call-10",
  );
  assert.equal(confounded.length, 3);
  for (const e of confounded) {
    assert.equal(e.resolution, "noCleanRead", `${e.id} must not be a hit`);
    assert.notEqual(e.props.state, "right");
  }
  // Including the one whose raw verdict was "correct".
  assert.equal(record.entries.find((e) => e.id === "call-2")?.resolution, "noCleanRead");
});

test("an empty result set renders the empty state and does not throw", () => {
  const record = buildDeskRecord([], TODAY_PT);
  assert.equal(record.total, 0);
  assert.deepEqual(record.entries, []);
  assert.deepEqual(record.byResolution, {
    supported: 0,
    challenged: 0,
    noCleanRead: 0,
    notGraded: 0,
  });
  assert.deepEqual(record.byVerdict, {});
  assert.deepEqual(record.byAttribution, {});
  assert.equal(record.firstBriefDate, null);
  assert.equal(record.lastBriefDate, null);

  // The empty state is real copy, not a blank or a zeroed-out headline.
  assert.ok(DESK_RECORD_COPY.emptyTitle.length > 0);
  assert.ok(DESK_RECORD_COPY.emptyBody.length > 0);
  assert.doesNotThrow(() => deskRecordAuthoredStrings(record));
  assert.doesNotThrow(() => deskRecordAuthoredStrings(null));

  console.log("empty state:", DESK_RECORD_COPY.emptyTitle, "/", DESK_RECORD_COPY.emptyBody);
});

const PROHIBITED = /\b(returns?|performance|performing|gains?|profits?|profitable)\b/i;

test("no investment-result vocabulary in any string the surface authors", () => {
  const record = buildDeskRecord(fullMatrix(), TODAY_PT);

  const authored = deskRecordAuthoredStrings(record);
  assert.ok(authored.length > 20, "the copy surface must actually be covered");
  for (const s of authored) {
    assert.doesNotMatch(s, PROHIBITED, `prohibited vocabulary in authored copy: ${s}`);
  }

  // Attribution notes come from the shared mapper and also render on screen.
  for (const e of record.entries) {
    if (e.attributionNote) {
      assert.doesNotMatch(
        e.attributionNote,
        PROHIBITED,
        `prohibited vocabulary in attribution note: ${e.attributionNote}`,
      );
    }
    // Carve-out, deliberate: the desk's published claim renders verbatim.
    // What the surface must never do is carry the grader's free-text notes,
    // which are written in market-move vocabulary.
    assert.equal(e.props.calibration, undefined, "grader prose must not render");
  }

  console.log(`vocabulary check: ${authored.length} authored strings clean`);
  console.log("copy sample:", DESK_RECORD_COPY.intro);
});
