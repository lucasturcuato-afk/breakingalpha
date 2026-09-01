// Unit tests for the map from the desk-record MODEL to the props the mobile
// record screen draws (src/components/desk-record/from-record.ts).
//
// What is locked, and both are things the screen now depends on that it did
// not before:
//
//   1. lastGradedOn is a MAXIMUM over every row read, never the first row's
//      value. The rows are sorted by brief_date first, so a late grade against
//      an older brief is exactly the case a first-row read would get wrong.
//      This is also the correction to a prior cut, which recorded that no
//      grader-run timestamp existed. graded_at was always there and always
//      selected; the FIELD on the model was what was missing.
//   2. Every listed entry carries the model's own bucket. The strip is a
//      control now and a cell scopes the list by bucket, so a view that
//      re-derived the bucket from the rendered word would be a second copy of
//      the one table that decides which bucket wears which word.
//
// Run: npx tsx --test tests/unit/desk-record-from-record.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeskRecord, type DeskCallRow } from "../../src/lib/desk-record.ts";
import { deskRecordToScreenData } from "../../src/components/desk-record/from-record.ts";

const TODAY_PT = "2026-07-26";

function meta(symbol: string) {
  return {
    grader: "price_attribution",
    entity_symbol: symbol,
    entity_move_pct: 2.31,
    thresholds_pct: { dead_band: 0.25, min_excess: 0.75 },
    benchmarks: [
      { symbol: "XLK", role: "sector", move_pct: 0.42, excess_pct: 1.89, meaningful_bar_pct: 0.75 },
      { symbol: "SPY", role: "market", move_pct: 0.15, excess_pct: 2.16, meaningful_bar_pct: 0.75 },
    ],
  };
}

function row(
  id: string,
  briefDate: string,
  gradedAt: string,
  verdict: string,
  attribution: "clean" | "confounded" | "inconclusive" | null,
): DeskCallRow {
  return {
    call: {
      id,
      claim_text: `Call ${id} states something falsifiable about NVDA.`,
      target_symbol: "NVDA",
      claim_type: "ticker",
      brief_date: briefDate,
      created_at: `${briefDate}T13:00:00Z`,
      confidence: 0.7,
    },
    outcome: {
      call_id: id,
      verdict,
      attribution,
      actual_pct_change: 2.31,
      actual_direction: "up",
      verdict_notes: "Grader prose the surface deliberately does not render.",
      graded_at: gradedAt,
      metadata: meta("NVDA"),
    },
  };
}

test("lastGradedOn is the newest grade, not the newest brief", () => {
  // The newest BRIEF was graded first; an older brief was graded last. Reading
  // the first sorted row would report July 2 and be a day-and-a-half wrong.
  const rows = [
    row("newest-brief", "2026-07-20", "2026-07-21T10:00:00Z", "correct", "clean"),
    row("older-brief", "2026-07-05", "2026-07-24T10:00:00Z", "wrong", "clean"),
  ];
  const record = buildDeskRecord(rows, TODAY_PT);

  assert.equal(record.lastBriefDate, "2026-07-20");
  assert.equal(record.lastGradedAt, "2026-07-24T10:00:00Z");

  const screen = deskRecordToScreenData(record);
  assert.equal(screen.lastGradedOn, "July 24");
});

test("no rows means no last-graded date, and the screen is not given one", () => {
  const record = buildDeskRecord([], TODAY_PT);
  assert.equal(record.lastGradedAt, null);
  assert.equal(deskRecordToScreenData(record).lastGradedOn, null);
});

test("every listed entry carries the model's own bucket", () => {
  const rows = [
    row("a", "2026-07-20", "2026-07-21T10:00:00Z", "correct", "clean"),
    row("b", "2026-07-19", "2026-07-20T10:00:00Z", "wrong", "clean"),
    row("c", "2026-07-18", "2026-07-19T10:00:00Z", "correct", "confounded"),
    // Never listed: no verdict word exists for it. It is still counted.
    row("d", "2026-07-17", "2026-07-18T10:00:00Z", "ungradable", null),
  ];
  const screen = deskRecordToScreenData(buildDeskRecord(rows, TODAY_PT));

  assert.deepEqual(
    screen.entries.map((e) => [e.id, e.bucket, e.state]),
    [
      ["a", "supported", "supported"],
      ["b", "challenged", "challenged"],
      ["c", "noCleanRead", "developing"],
    ],
  );
  assert.equal(screen.hasUnlistedNotGraded, true);
});

test("the bucket a cell scopes to selects exactly the rows wearing its word", () => {
  const rows = [
    row("a", "2026-07-20", "2026-07-21T10:00:00Z", "correct", "clean"),
    row("b", "2026-07-19", "2026-07-20T10:00:00Z", "wrong", "clean"),
    row("c", "2026-07-18", "2026-07-19T10:00:00Z", "wrong", "clean"),
  ];
  const screen = deskRecordToScreenData(buildDeskRecord(rows, TODAY_PT));

  const challenged = screen.entries.filter((e) => e.bucket === "challenged");
  assert.equal(challenged.length, 2);
  assert.ok(challenged.every((e) => e.state === "challenged"));

  // A cell with no listed rows is not a control, and this is the count the
  // screen reads to decide that.
  assert.equal(screen.entries.filter((e) => e.bucket === "notGraded").length, 0);
});
