// The evidence tracker's mobile model, and the two properties that are easy
// to lose in an edit and impossible to see in a screenshot.
//
// 1. NO RATE, ANYWHERE. A tracker of graded theses is the single surface in
//    this product where a hit rate most wants to appear, and the desktop page
//    already computes one (`supportRate`) for sort order. The guard below is
//    lexical over the two mobile screens and the model, because a rate that
//    reaches a reader arrives as a division written in a render, not as an
//    exported function anyone can call.
//
// 2. THE LEAN AND THE SETTLED STATE ARE TWO CHANNELS. `leanTokens` paints the
//    direction and `verdictDisplayLabel` says whether the grader has settled.
//    Folding them, in either direction, loses one fact: a green card with the
//    word dropped reads as Supported, and a neutral card with the word kept
//    throws away the direction the evidence is running. The assertions hold
//    both halves at once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OUTCOME_TOKENS } from "../../src/components/ledger/claim-anatomy";
import {
  horizonLine,
  instrumentLine,
  isStale,
  leanTokens,
  sectorLeanTokens,
  railTail,
  sectorRows,
  type TrackerThesis,
} from "../../src/components/tracker-mobile/tracker-model";
import type { LiveScoreResult } from "../../src/lib/track-record-live-score";

const DIR = join("src", "components", "tracker-mobile");
const FILES = ["tracker-model.ts", "tracker-screen.tsx", "thesis-screen.tsx"];

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function live(verdict: string, over: Partial<LiveScoreResult> = {}): LiveScoreResult {
  return {
    score: 0,
    verdict,
    terminal: null,
    components: { price: 0, sentiment: 0, ratio: 0, confidence: 0, timeDecay: 0 },
    ageDays: 3,
    horizonDays: 30,
    stance: 1,
    source: "computed",
    ...over,
  };
}

function thesis(over: Partial<TrackerThesis> = {}): TrackerThesis {
  return {
    id: "t1",
    title: "A claim",
    sector: "Energy",
    ticker: "XYZ",
    generatedAt: "2026-08-01T00:00:00Z",
    checkAfter: "2026-09-01T00:00:00Z",
    live: live("Awaiting verdict"),
    reviews: [],
    ...over,
  };
}

/* ── 1. no rate ─────────────────────────────────────────────────────── */

test("no rate, no accuracy and no percent formatting reaches the mobile tracker", () => {
  const RATE = [
    /\baccuracy\b/i,
    /\bhit[_\s-]?rate\b/i,
    /\bwin[_\s-]?rate\b/i,
    /\bsuccess[_\s-]?rate\b/i,
    /\bsupportRate\b/,
    /\*\s*100\s*\)/,
    /\btoFixed\s*\(/,
  ];
  for (const f of FILES) {
    // Comments are stripped first. This file's own prose names `supportRate`
    // to say the desktop keeps one and the phone does not, and a scan that
    // cannot tell a warning from a violation bans writing the warning down.
    const text = stripComments(readFileSync(join(DIR, f), "utf8"));
    for (const shape of RATE) {
      assert.equal(
        shape.test(text),
        false,
        `${f} matches ${shape}, which is how a rate reaches this screen`,
      );
    }
  }
});

test("the model divides nothing", () => {
  const text = readFileSync(join(DIR, "tracker-model.ts"), "utf8");
  // `/` appears in comments, in JSX-free code only as division or as a regex.
  // Strip comments and string literals, then look for a bare division.
  const code = stripComments(text)
    .replace(/`[^`]*`/g, "``")
    .replace(/"[^"]*"/g, '""');
  assert.equal(/[)\w\]]\s*\/\s*[(\w]/.test(code), false, "a division survives in tracker-model.ts");
});

/* ── 2. lean and settled state are two channels ─────────────────────── */

test("a settled verdict and its lean share a hue and differ in the word", () => {
  const settled = leanTokens("Confirmed");
  const leaning = leanTokens("Tracking confirmed");
  assert.equal(settled.dot, leaning.dot, "the hue must carry the direction on both");
  assert.equal(settled.word, "Supported");
  assert.equal(leaning.word, "Leaning supportive");
  assert.notEqual(settled.word, leaning.word, "the word is what separates settled from leaning");

  const down = leanTokens("Invalidated");
  const leaningDown = leanTokens("Tracking invalidated");
  assert.equal(down.dot, leaningDown.dot);
  assert.equal(down.word, "Challenged");
  assert.equal(leaningDown.word, "Leaning against");
});

test("the dot takes a base token and the word takes an ink token, never swapped", () => {
  for (const v of ["Confirmed", "Invalidated", "Awaiting verdict", "Inconclusive after 40d"]) {
    const t = leanTokens(v);
    assert.match(t.dot, /var\(--c-(green|red|amber)\)/, `${v} paints its dot with an ink token`);
    assert.match(t.text, /var\(--c-(green|red|amber)ink\)/, `${v} writes its word in a fill token`);
    assert.notEqual(t.dot, t.text);
  }
  // The four states the tokens come from are the closed set, unchanged here.
  assert.equal(leanTokens("Confirmed").dot, OUTCOME_TOKENS.supported.dot);
  assert.equal(leanTokens("Invalidated").text, OUTCOME_TOKENS.challenged.text);
  assert.equal(leanTokens("Awaiting verdict").dot, OUTCOME_TOKENS.developing.dot);
});

test("a thesis with no review at all says Awaiting, not Developing", () => {
  const never = leanTokens("Awaiting verdict", false);
  const some = leanTokens("Awaiting verdict", true);
  assert.equal(never.word, "Awaiting");
  assert.equal(some.word, "Developing");
  assert.equal(never.dot, OUTCOME_TOKENS.awaiting.dot);
  assert.equal(never.text, OUTCOME_TOKENS.awaiting.text);
  // A settled or leaning verdict ignores the flag entirely: a review DID run.
  assert.equal(leanTokens("Confirmed", false).word, "Supported");
  assert.equal(leanTokens("Tracking invalidated", false).word, "Leaning against");
});

test("every outcome word on the sector table is one of the four", () => {
  const words = (["supportive", "against", "mixed", "awaiting"] as const).map(
    (l) => sectorLeanTokens(l).word,
  );
  assert.deepEqual(words, ["Supportive", "Against", "Mixed", "Awaiting"]);
  for (const w of words) {
    assert.equal(/\b(right|wrong|correct|incorrect|win|won|loss|lost)\b/i.test(w), false);
  }
});

/* ── the derivations ────────────────────────────────────────────────── */

test("sector rows count rows and never rank by a share", () => {
  const rows = sectorRows([
    thesis({ id: "a", sector: "Energy", live: live("Tracking confirmed") }),
    thesis({ id: "b", sector: "Energy", live: live("Tracking invalidated") }),
    thesis({ id: "c", sector: "Rates", live: live("Tracking confirmed") }),
    thesis({ id: "d", sector: null, live: live("Awaiting verdict") }),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.sector, r.count, r.lean]),
    [
      ["Energy", 2, "mixed"],
      ["Rates", 1, "supportive"],
      ["Unknown", 1, "awaiting"],
    ],
  );
  // Sorted by count, then name. Energy leads on two rows, not on a share.
  assert.equal(rows[0].sector, "Energy");
});

test("the horizon line states reviews and days, and nothing between them", () => {
  assert.equal(
    horizonLine(thesis({ reviews: [], live: live("Awaiting verdict", { horizonDays: 21 }) })),
    "AWAITING FIRST REVIEW · 21-DAY HORIZON",
  );
  const r = [{ id: "1", gradedAt: "2026-08-02T00:00:00Z", verdict: "pending", notes: null }];
  assert.equal(
    horizonLine(thesis({ reviews: r, live: live("Awaiting verdict", { ageDays: 7, horizonDays: 21 }) })),
    "1 REVIEW · 14 DAYS LEFT ON A 21-DAY HORIZON",
  );
  assert.equal(
    horizonLine(thesis({ reviews: r, live: live("Awaiting verdict", { ageDays: 30, horizonDays: 21 }) })),
    "1 REVIEW · 9 DAYS PAST A 21-DAY HORIZON",
  );
  assert.equal(
    horizonLine(
      thesis({ reviews: r, live: live("Confirmed", { terminal: "confirmed", horizonDays: 21 }) }),
    ),
    "1 REVIEW · SETTLED ON A 21-DAY HORIZON",
  );
});

test("the dot rail closes with a ring only while the thesis is open", () => {
  /* Midday UTC, not midnight. `shortDate` renders in the READER's zone, so a
     midnight-UTC fixture lands on the previous day west of Greenwich and the
     assertion reads as a bug in the tail rather than in the fixture. */
  const r = (d: string) => ({ id: d, gradedAt: `${d}T12:00:00Z`, verdict: "pending", notes: null });

  // Settled: no ring at all, and the closing date is the last reading.
  const settled = thesis({
    reviews: [r("2026-07-18"), r("2026-07-20")],
    live: live("Confirmed", { terminal: "confirmed" }),
  });
  assert.deepEqual(railTail(settled), { ring: false, date: "JUL 20" });

  // Settled on one review: nothing closes it, the opening date already names it.
  assert.deepEqual(
    railTail(
      thesis({ reviews: [r("2026-07-18")], live: live("Confirmed", { terminal: "confirmed" }) }),
    ),
    { ring: false, date: null },
  );

  // Open with a check-after that is genuinely later: ring plus that date.
  assert.deepEqual(
    railTail(thesis({ reviews: [r("2026-08-01")], checkAfter: "2026-08-20T12:00:00Z" })),
    { ring: true, date: "AUG 20" },
  );

  // Open with a check-after BEHIND the last review. Measured on real rows:
  // "AUG 1 (dot) ... (ring) JUL 31", a future review dated before a past one.
  // The ring stays, the backwards date does not.
  assert.deepEqual(
    railTail(thesis({ reviews: [r("2026-08-01")], checkAfter: "2026-07-31T12:00:00Z" })),
    { ring: true, date: null },
  );
});

test("an instrument line omits what the row does not carry", () => {
  assert.equal(instrumentLine({ ticker: "CEG", sector: "Utilities" }), "CEG · UTILITIES");
  assert.equal(instrumentLine({ ticker: null, sector: "Utilities" }), "UTILITIES");
  assert.equal(instrumentLine({ ticker: null, sector: null }), null);
});

test("a tracker that has never been reviewed is not stale", () => {
  const now = new Date("2026-09-04T00:00:00Z");
  assert.equal(isStale(null, now), false, "nothing has failed to update");
  assert.equal(isStale("2026-09-03T20:00:00Z", now), false);
  assert.equal(isStale("2026-09-01T00:00:00Z", now), true);
  assert.equal(isStale("not a date", now), false);
});
