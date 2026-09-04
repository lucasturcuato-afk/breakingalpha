// The rules behind the phone layout of /cross-source.
//
// Four things here can go wrong silently, so each one is asserted rather than
// looked at in a browser:
//
//   1. A FAILED READ RENDERING AS AN EMPTY ONE. `panelStage` is the only place
//      the precedence of (fault, rows, loading) is decided, and issue 839 is a
//      log of four places in this codebase where the fault lost.
//   2. TWO IMPLEMENTATIONS OF THE LAG RULE. The desk layout and the phone
//      screen must read one cluster the same way. The desk imports the same
//      function, and this file asserts no second copy exists.
//   3. A BEHIND NOTICE FIRING ON A PANEL WITH NO DATES, which would be a claim
//      with no source under it.
//   4. THE OUTCOME VOCABULARY. The split has exactly two words on this
//      surface and they are two of the four the product is allowed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLUSTER_STALE_AFTER_DAYS,
  SOURCE_STALE_AFTER_DAYS,
  confidenceInk,
  formatLag,
  isBehind,
  newestIso,
  outcomeSplit,
  panelStage,
  roleWord,
  shortDate,
} from "../../src/components/cross-source-mobile/cross-source-model.ts";

/* ── panelStage ─────────────────────────────────────────────────────── */

test("a fault outranks a zero row count, so a failed read never renders empty", () => {
  assert.equal(panelStage({ error: "query failed" }, [], false), "error");
  assert.equal(panelStage({ error: "query failed" }, null, false), "error");
});

test("a fault outranks loading, so a failed refresh keeps saying so", () => {
  assert.equal(panelStage({ error: "query failed" }, null, true), "error");
  assert.equal(panelStage({ error: "query failed" }, [{}], true), "error");
});

test("null rows with nothing in flight is an error, not an empty table", () => {
  // Rows can only be null after a read that did not deliver. Calling that
  // empty is the exact substitution this function exists to refuse.
  assert.equal(panelStage(null, null, false), "error");
});

test("null rows with a read in flight is loading", () => {
  assert.equal(panelStage(null, null, true), "loading");
});

test("zero rows from a read that finished is empty", () => {
  assert.equal(panelStage(null, [], false), "empty");
});

test("zero rows with a read in flight is loading, not empty", () => {
  assert.equal(panelStage(null, [], true), "loading");
});

test("rows present stay drawn through a refresh", () => {
  assert.equal(panelStage(null, [{}, {}], true), "ready");
  assert.equal(panelStage(null, [{}, {}], false), "ready");
});

/* ── formatLag ──────────────────────────────────────────────────────── */

test("a null lag says unknown rather than zero", () => {
  assert.equal(formatLag(null), "unknown");
});

test("lag reads in the unit the size of the gap calls for", () => {
  assert.equal(formatLag(0), "same minute");
  assert.equal(formatLag(0.4), "same minute");
  assert.equal(formatLag(1), "+1m");
  assert.equal(formatLag(59), "+59m");
  assert.equal(formatLag(60), "+1.0h");
  assert.equal(formatLag(90), "+1.5h");
  assert.equal(formatLag(1439), "+24.0h");
  assert.equal(formatLag(1440), "+1.0d");
  assert.equal(formatLag(4320), "+3.0d");
});

test("the lag rule has exactly one implementation", () => {
  // The desk layout used to carry its own copy. Two implementations of one
  // rule is the shape this repo has paid for six times over; see the note in
  // src/components/mobile/tab-bar-clearance.tsx.
  const desk = readFileSync("src/app/cross-source/page.tsx", "utf8");
  assert.ok(
    !/function\s+formatLag\s*\(/.test(desk),
    "src/app/cross-source/page.tsx must import formatLag, not define a second one",
  );
  assert.ok(
    desk.includes("formatLag"),
    "the desk layout still draws the lag, so it must import the rule",
  );
});

/* ── roleWord ───────────────────────────────────────────────────────── */

test("a tied lead is named tied, because no lead was named", () => {
  assert.equal(roleWord("lead_tied"), "tied");
  assert.equal(roleWord("lead"), "lead");
  assert.equal(roleWord("echo"), "echo");
});

/* ── outcomeSplit ───────────────────────────────────────────────────── */

test("the split is exactly supported and challenged", () => {
  const row = {
    identity: "example",
    n_clean_outcomes: 9,
    n_correct: 6,
    n_wrong: 3,
    confidence: "low",
    is_syndicator: false,
    last_outcome_at: null,
  };
  const split = outcomeSplit(row);
  assert.deepEqual(Object.keys(split).sort(), ["challenged", "supported"]);
  assert.equal(split.supported, 6);
  assert.equal(split.challenged, 3);
});

test("the split reports counts and never divides them", () => {
  const row = {
    identity: "example",
    n_clean_outcomes: 4,
    n_correct: 1,
    n_wrong: 3,
    confidence: "insufficient",
    is_syndicator: false,
    last_outcome_at: null,
  };
  const split = outcomeSplit(row);
  assert.ok(Number.isInteger(split.supported) && Number.isInteger(split.challenged));
  assert.equal(split.supported + split.challenged, 4);
});

/* ── confidenceInk ──────────────────────────────────────────────────── */

test("the confidence scale is ink weight only, never a green or a red", () => {
  const inks = ["insufficient", "low", "moderate", "high"].map(confidenceInk);
  for (const ink of inks) {
    assert.ok(
      /^var\(--c-(ink|body|muted)\)$/.test(ink),
      `${ink} is not one of the three neutral inks`,
    );
  }
  assert.equal(confidenceInk("high"), "var(--c-ink)");
  assert.equal(confidenceInk("insufficient"), "var(--c-muted)");
  // An unknown band falls to the quietest ink rather than throwing.
  assert.equal(confidenceInk("something-new"), "var(--c-muted)");
});

/* ── newestIso and isBehind ─────────────────────────────────────────── */

test("newestIso skips nulls and unparseable strings rather than ranking them", () => {
  assert.equal(newestIso([]), null);
  assert.equal(newestIso([null, null]), null);
  assert.equal(newestIso([null, "not a date"]), null);
  assert.equal(
    newestIso(["2026-01-01T00:00:00Z", null, "2026-03-01T00:00:00Z", "nonsense"]),
    "2026-03-01T00:00:00Z",
  );
});

test("a panel with no dates is never reported as behind", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  assert.equal(isBehind(null, now, SOURCE_STALE_AFTER_DAYS), false);
  assert.equal(isBehind("not a date", now, SOURCE_STALE_AFTER_DAYS), false);
});

test("the two bars are the ones each panel's own cadence calls for", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  // A clean outcome resolves against a catalyst, so a fortnight is quiet, not
  // broken. A cluster window is measured in hours, so three days is broken.
  assert.equal(isBehind("2026-08-25T12:00:00Z", now, SOURCE_STALE_AFTER_DAYS), false);
  assert.equal(isBehind("2026-08-20T11:00:00Z", now, SOURCE_STALE_AFTER_DAYS), true);
  assert.equal(isBehind("2026-09-03T12:00:00Z", now, CLUSTER_STALE_AFTER_DAYS), false);
  assert.equal(isBehind("2026-08-30T11:00:00Z", now, CLUSTER_STALE_AFTER_DAYS), true);
});

test("the bar is exclusive at exactly the boundary", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  assert.equal(isBehind("2026-09-01T12:00:00Z", now, CLUSTER_STALE_AFTER_DAYS), false);
  assert.equal(isBehind("2026-09-01T11:59:59Z", now, CLUSTER_STALE_AFTER_DAYS), true);
});

/* ── shortDate ──────────────────────────────────────────────────────── */

test("an undated row says unknown rather than drawing an epoch", () => {
  assert.equal(shortDate(null), "unknown");
  assert.equal(shortDate("not a date"), "unknown");
  assert.ok(shortDate("2026-03-12T09:00:00Z").includes("2026"));
});
