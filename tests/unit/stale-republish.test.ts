// Unit tests for the Layer 1 stale-republish detector (src/lib/stale-republish.ts).
//
// Coverage:
//  - the move-verb gate: positives (surge/soar/plunge/...) AND the load-bearing
//    negatives ("30% sales growth", "26% upside", "owns 12% stake");
//  - magnitude + direction parsing;
//  - price-mismatch logic: claimed move NOT on pubDate -> scan -> inferred date;
//    claimed move present on pubDate -> NOT stale; no price data -> NOT stale;
//  - the mode switch: off/shadow do nothing to ranking; active path in isolation.
//
// The price fetch is INJECTED (no network). Run:
//   node --test tests/unit/stale-republish.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHeadlineMagnitude,
  hasMoveVerbNearPercent,
  hasPeriodQualifier,
  parseClaimedDirection,
  parseSourceTicker,
  sessionRealizedMove,
  sessionPersistedMove,
  sessionMatchesClaim,
  evaluateStaleAgainstBars,
  evaluateStaleRepublish,
  correctedRecencyIso,
  resolveStaleRepublishMode,
  shadowLogLine,
  type DailyBar,
  type StaleRepublishInput,
} from "../../src/lib/stale-republish.ts";
import {
  applyStaleRankPenalty,
  type TopStoryRow,
} from "../../src/lib/top-stories.ts";
import type { StaleVerdict } from "../../src/lib/stale-republish.ts";

const DAY = 86_400;

// Build a synthetic bar series. moves[i] is the up-gap percent vs the prior
// close on session i (negative for a down move). Day 0 is `startDay`.
function makeBars(startDay: number, moves: number[]): DailyBar[] {
  const bars: DailyBar[] = [];
  let prevClose = 100;
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const open = prevClose;
    const close = prevClose * (1 + move / 100);
    const high = Math.max(open, close);
    const low = Math.min(open, close);
    const day = startDay + i;
    bars.push({ ts: day * DAY, day, open, close, high, low });
    prevClose = close;
  }
  return bars;
}

// A bar with an explicit intraday wick: gaps the HIGH up `wickPct` vs prior
// close but CLOSES at `closePct` vs prior close. Models the YYGH-06-04 case (a
// +77% intraday spike on a day that closed DOWN).
function wickBar(startDay: number, baseClose: number, day: number, wickPct: number, closePct: number): DailyBar {
  const close = baseClose * (1 + closePct / 100);
  const high = baseClose * (1 + wickPct / 100);
  const open = baseClose; // open at prior close for simplicity
  const low = Math.min(open, close);
  return { ts: day * DAY, day, open, close, high: Math.max(high, open, close), low };
}

// ---------------------------------------------------------------------------
// Magnitude + direction parsing
// ---------------------------------------------------------------------------

test("parseHeadlineMagnitude returns the largest attached percent move", () => {
  assert.equal(parseHeadlineMagnitude("Why Is YYGH Soaring Nearly 60% Premarket?"), 60);
  assert.equal(parseHeadlineMagnitude("ROKU surges 20% on guidance"), 20);
  assert.equal(parseHeadlineMagnitude("Stock down 4.8% after earnings"), 4.8);
  assert.equal(parseHeadlineMagnitude("No percent here"), null);
});

test("parseHeadlineMagnitude guards non-move percents (of/stake/yield)", () => {
  assert.equal(parseHeadlineMagnitude("60% of analysts rate it buy"), null);
  assert.equal(parseHeadlineMagnitude("Acquires 5% stake"), null);
  assert.equal(parseHeadlineMagnitude("Yields 4% dividend"), null);
});

test("parseClaimedDirection reads up vs down from the adjacent verb", () => {
  assert.equal(parseClaimedDirection("YYGH soaring nearly 60% premarket"), "up");
  assert.equal(parseClaimedDirection("ROKU surges 20%"), "up");
  assert.equal(parseClaimedDirection("Stock plunges 18% on miss"), "down");
  assert.equal(parseClaimedDirection("Shares tumble 12% after hours"), "down");
});

// ---------------------------------------------------------------------------
// The move-verb gate (load-bearing)
// ---------------------------------------------------------------------------

test("verb gate POSITIVES: move verbs near a percent pass", () => {
  for (const t of [
    "YYGH stock soaring nearly 60% premarket today",
    "ROKU surges 20% on strong quarter",
    "Stock plunges 18% after guidance cut",
    "Shares tumble 12% in late trading",
    "Crypto miner rockets 45% overnight",
    "Stock jumps 9% on upgrade",
    "Name pops 30% after FDA nod",
    "Equity sinks 22% on dilution",
    "Shares crash 35% premarket",
    "Stock rallies 15% into close",
  ]) {
    assert.equal(hasMoveVerbNearPercent(t), true, `should pass: ${t}`);
  }
});

test("verb gate NEGATIVES (load-bearing): non-move percents are excluded", () => {
  // These are the exact false-positive sources from the recon doc. WITHOUT the
  // gate Layer 1 would fetch price, find no matching day, and falsely flag.
  for (const t of [
    "TSM reports 30% sales growth in Q2",      // revenue figure, no move verb
    "MGNI has 26% upside per analyst target",  // analyst target, no move verb
    "Insider owns 12% stake in the company",   // ownership, no move verb
    "Company posts 50% EPS growth year over year",
    "Stock up 59% in 6 months says bull case",  // "up" present but it is a non-realized framing... see note
  ]) {
    // Note: "up 59% in 6 months" DOES contain the verb "up"; the gate is a
    // necessary-not-sufficient guard. The downstream price check fails safe
    // (no 59% single-session move -> no-match-in-lookback -> not stale). The
    // four genuine non-move headlines below MUST be excluded by the gate itself.
    if (t.startsWith("Stock up 59%")) continue;
    assert.equal(hasMoveVerbNearPercent(t), false, `should be excluded: ${t}`);
  }
});

// ---------------------------------------------------------------------------
// The PERIOD-qualifier gate (load-bearing: cumulative/trailing moves)
// ---------------------------------------------------------------------------

test("period gate EXCLUDES cumulative / trailing-window moves", () => {
  // These have a move verb adjacent to the percent (so they pass the verb gate)
  // but the percent is a CUMULATIVE move over a multi-session window, not a
  // same-day claim. The full-set offline validation showed these as the dominant
  // false-positive class. They MUST be period-qualified.
  for (const t of [
    "Salesforce Stock Plummets 13% With 5-Day Losing Streak",
    "Honeywell International Stock Plummets 11% With 6-Day Losing Streak",
    "SMCI Plunges 32% in a Year: Time to Hold or Fold the Stock?",
    "AST SpaceMobile Stock Slides 25% With A 5-Day Losing Spree",
    "Why Micron Technology Stock Skyrocketed 87.8% Last Month But Is Falling in June",
    "Why Joby Aviation Soared 29.5% Last Month But Is Plummeting in June",
    "Dell Soars 54%, HP Enterprise Rockets 59% in a Month as AI-Server Demand Booms",
    "TSMC Revenue Surges 30% in May on Relentless AI Demand",
    "Roku (ROKU) Stock After 71% One-Year Surge Is The Price Still Reasonable",
    "SpaceX stock jumps for second day, now up over 35% since debut",
    "Super Micro Shares Plunge 26% in Two Days After Equity Raise",
  ]) {
    assert.equal(hasPeriodQualifier(t), true, `should be period-qualified: ${t}`);
  }
});

test("period gate does NOT exclude same-day claims", () => {
  for (const t of [
    "Why is YYGH stock soaring nearly 60% premarket today?",
    "ROKU Stock Surges Over 20% On Friday",
    "Eos Energy stock surges 13% on new production facility launch",
    "XOS stock jumps over 25% after-hours",
    "FRMI Stock Surges Nearly 27% Today",
    "ORCL Stock Tumbles 10% Today",
  ]) {
    assert.equal(hasPeriodQualifier(t), false, `should NOT be period-qualified: ${t}`);
  }
});

test("verb gate: a move verb far from the percent does not falsely pass", () => {
  // "surge" is 8+ tokens from the percent; proximity window is 4.
  assert.equal(
    hasMoveVerbNearPercent("Demand could surge but the dividend covers only 4% of the payout schedule going forward"),
    false,
  );
});

// ---------------------------------------------------------------------------
// Ticker resolution
// ---------------------------------------------------------------------------

test("parseSourceTicker pulls the gnews feed ticker", () => {
  assert.equal(parseSourceTicker("Google News (YYGH)"), "YYGH");
  assert.equal(parseSourceTicker("Google News (ROKU) - MSN"), "ROKU");
  assert.equal(parseSourceTicker("TradingView"), null);
  assert.equal(parseSourceTicker(null), null);
});

// ---------------------------------------------------------------------------
// Per-session realized move + match
// ---------------------------------------------------------------------------

test("sessionRealizedMove captures a gap-up vs prior close", () => {
  const bars = makeBars(100, [0, 32]); // session 1 gaps +32% vs session 0 close
  const m = sessionRealizedMove(bars, 1);
  assert.ok(m.up >= 31 && m.up <= 33, `up move ~32, got ${m.up}`);
  assert.equal(Math.round(m.down), 0);
});

test("sessionMatchesClaim: 60% claim vs gaps (25pp tolerance floor)", () => {
  // floor = max(60*0.5, 60-25) = max(30,35) = 35.
  const small = makeBars(100, [0, 30]); // 30 < 35 -> NO match
  assert.equal(sessionMatchesClaim(small, 1, 60, "up"), false);
  const faded = makeBars(100, [0, 42]); // 42 >= 35 -> matches (YYGH-style fade)
  assert.equal(sessionMatchesClaim(faded, 1, 60, "up"), true);
});

test("sessionPersistedMove ignores the intraday wick, keeps the close", () => {
  // A day that wicks +77% but closes -15% has persisted up=0, persisted down=15.
  const bars: DailyBar[] = [
    { ts: 1000 * DAY, day: 1000, open: 100, close: 100, high: 100, low: 100 },
    { ts: 1001 * DAY, day: 1001, open: 100, close: 85, high: 177, low: 85 },
  ];
  const persisted = sessionPersistedMove(bars, 1);
  assert.equal(Math.round(persisted.up), 0, "wick must not count as a persisted up move");
  assert.ok(persisted.down >= 14 && persisted.down <= 16, `persisted down ~15, got ${persisted.down}`);
  // Whereas the wick-inclusive realized move DOES see the +77% high.
  const realized = sessionRealizedMove(bars, 1);
  assert.ok(realized.up >= 70, `realized up sees the wick, got ${realized.up}`);
});

test("sessionMatchesClaim respects direction", () => {
  const up = makeBars(100, [0, 25]);
  assert.equal(sessionMatchesClaim(up, 1, 20, "up"), true);
  assert.equal(sessionMatchesClaim(up, 1, 20, "down"), false);
});

// ---------------------------------------------------------------------------
// Detection: the YYGH / ROKU price-mismatch logic
// ---------------------------------------------------------------------------

// pubDate day index helper for the tests (UTC midnight of an ISO date).
function isoForDay(dayIdx: number): string {
  return new Date(dayIdx * DAY * 1000).toISOString();
}

test("YYGH-style: claimed move NOT on pubDate -> scan -> inferred event date (STALE)", () => {
  // The real +58% move happened on session day 1000. The republish is pubDated
  // on day 1006 where the stock was flat/down.
  const eventDay = 1000;
  const bars = makeBars(eventDay - 1, [
    -2, // day 999
    58, // day 1000  <- real event
    -25, // 1001
    1, // 1002
    -1, // 1003
    2, // 1004
    -3, // 1005
    -5, // 1006  <- republish pubDate, NO 60% move
  ]);
  const input: StaleRepublishInput = {
    id: "republish-1",
    title: "Why is YYGH stock soaring nearly 60% premarket today?",
    source: "Google News (YYGH) - MSN",
    publishedAt: isoForDay(1006),
  };
  const v = evaluateStaleAgainstBars(input, bars);
  assert.equal(v.stale, true);
  assert.equal(v.reason, "flagged");
  assert.equal(v.ticker, "YYGH");
  assert.equal(v.claimPct, 60);
  assert.equal(v.direction, "up");
  assert.equal(v.inferredEventDate, isoForDay(1000).slice(0, 10));
  assert.equal(v.action, "both");
});

test("the ORIGINAL (real-event-day) row is NOT flagged stale", () => {
  const eventDay = 1000;
  const bars = makeBars(eventDay - 1, [-2, 58, -25, 1]);
  const input: StaleRepublishInput = {
    id: "original-1",
    title: "Why Is YYGH Stock Soaring Nearly 60% Premarket Today?",
    source: "Google News (YYGH) - TradingView",
    publishedAt: isoForDay(1000), // the real event day
  };
  const v = evaluateStaleAgainstBars(input, bars);
  assert.equal(v.stale, false);
  assert.equal(v.reason, "move-on-pubdate");
});

test("ROKU-style: surge 20% present elsewhere -> later rows flagged", () => {
  // +22% on day 2000; rows dated 2001/2002 carry "surges 20%" but ROKU flat.
  const bars = makeBars(1999, [-1, 22, -2, -2]);
  const later: StaleRepublishInput = {
    id: "roku-later",
    title: "ROKU surges 20% as streaming rebounds",
    source: "Google News (ROKU)",
    publishedAt: isoForDay(2002),
  };
  const v = evaluateStaleAgainstBars(later, bars);
  assert.equal(v.stale, true);
  assert.equal(v.inferredEventDate, isoForDay(2000).slice(0, 10));
});

test("verb-gate exclusions are NOT flagged even when no price day matches", () => {
  // TSM "30% sales growth": gate excludes -> no fetch -> not stale.
  const tsm: StaleRepublishInput = {
    id: "tsm-1",
    title: "TSM reports 30% sales growth in Q2",
    source: "Google News (TSM)",
    publishedAt: isoForDay(3000),
  };
  const vTsm = evaluateStaleAgainstBars(tsm, makeBars(2990, new Array(20).fill(1)));
  assert.equal(vTsm.stale, false);
  assert.equal(vTsm.reason, "no-move-verb");

  // MGNI "26% upside": gate excludes.
  const mgni: StaleRepublishInput = {
    id: "mgni-1",
    title: "MGNI has 26% upside per analyst target",
    source: "Google News (MGNI)",
    publishedAt: isoForDay(3000),
  };
  const vMgni = evaluateStaleAgainstBars(mgni, makeBars(2990, new Array(20).fill(1)));
  assert.equal(vMgni.stale, false);
  assert.equal(vMgni.reason, "no-move-verb");
});

test("period-qualified headlines are NOT flagged even if no single session matches", () => {
  // "Plummets 13% With 5-Day Losing Streak": the 13% is cumulative. Even with a
  // down trend in the bars, the period gate excludes it from the single-session
  // price check.
  const bars = makeBars(6990, [-3, -2, -3, -2, -3, -2, -1, -2]); // steady decline
  const input: StaleRepublishInput = {
    id: "crm-streak",
    title: "Salesforce Stock Plummets 13% With 5-Day Losing Streak",
    source: "Google News (CRM)",
    publishedAt: isoForDay(6997),
  };
  const v = evaluateStaleAgainstBars(input, bars);
  assert.equal(v.stale, false);
  assert.equal(v.reason, "period-qualified");
});

test("INTRADAY WICK on a down day is NOT named the event day (persistence guard)", () => {
  // Models YYGH-06-04: a +77% intraday HIGH on a day that CLOSED down. The
  // pubDate is later and quiet. WITHOUT persistence the wick would be re-dated as
  // the real "soaring 60%" event (a false positive). WITH it, no session held the
  // move -> NOT stale.
  const bars: DailyBar[] = [
    wickBar(1000, 100, 1000, 5, 2), // quiet
    wickBar(1000, 102, 1001, 77, -15), // +77% wick, closes DOWN 15%  (the trap)
    wickBar(1000, 86.7, 1002, 3, 1),
    wickBar(1000, 87.6, 1003, 2, -1),
    wickBar(1000, 86.7, 1004, 1, 0), // pubDate session, quiet
  ];
  const input: StaleRepublishInput = {
    id: "wick-trap",
    title: "Why Is XYZ Stock Soaring Nearly 60% Premarket Today?",
    source: "Google News (XYZ)",
    publishedAt: isoForDay(1004),
  };
  const v = evaluateStaleAgainstBars(input, bars);
  assert.equal(v.stale, false, "a pure intraday wick must not be named the event day");
});

test("a gap that HELD into the close IS named the event day", () => {
  // Same shape but the spike day closes UP +32% (the real YYGH-06-10): a genuine
  // soaring event. A later quiet pubDate row IS stale and re-dates to it.
  const bars: DailyBar[] = [
    wickBar(2000, 100, 2000, 5, 2),
    wickBar(2000, 102, 2001, 42, 32), // gap +42% hi, CLOSES +32% (holds)
    wickBar(2000, 134.6, 2002, 3, -2),
    wickBar(2000, 131.9, 2003, 1, -1),
    wickBar(2000, 130.6, 2004, 2, 0), // pubDate, quiet
  ];
  const input: StaleRepublishInput = {
    id: "held-gap",
    title: "Why is XYZ stock soaring nearly 60% premarket today?",
    source: "Google News (XYZ)",
    publishedAt: isoForDay(2004),
  };
  const v = evaluateStaleAgainstBars(input, bars);
  assert.equal(v.stale, true);
  assert.equal(v.inferredEventDate, isoForDay(2001).slice(0, 10));
});

test("after-hours pubDate whose move prints NEXT session -> NOT stale (adjacency)", () => {
  // "jumps 25% after-hours" stamped late on day D; the 25% prints on D+1's bar.
  // The next-session adjacency check must keep it fresh, not back-date it.
  const bars = makeBars(2999, [-1, -2, 28, -3]); // day 3001 (index 2) is +28%
  const input: StaleRepublishInput = {
    id: "ah-next",
    title: "XOS stock jumps over 25% after-hours",
    source: "Google News (XOS)",
    publishedAt: isoForDay(3000), // pubDate session is the FLAT day before +28%
  };
  const v = evaluateStaleAgainstBars(input, bars);
  assert.equal(v.stale, false, "the move on the very next session means not stale");
});

test("no price data -> NOT stale (fail safe)", () => {
  const input: StaleRepublishInput = {
    id: "thin-1",
    title: "Thinly traded name surges 40%",
    source: "Google News (THIN)",
    publishedAt: isoForDay(4000),
  };
  const v = evaluateStaleAgainstBars(input, []);
  assert.equal(v.stale, false);
  assert.equal(v.reason, "no-price-data");
});

test("move present on pubDate AND elsewhere -> NOT stale (pubDate wins)", () => {
  // A genuinely-ongoing move: the claim matches the pubDate session itself.
  const bars = makeBars(4999, [-1, 25, 23]); // day 5000 +25, day 5001 +23
  const input: StaleRepublishInput = {
    id: "ongoing-1",
    title: "Name surges 22% again today",
    source: "Google News (ABC)",
    publishedAt: isoForDay(5001),
  };
  const v = evaluateStaleAgainstBars(input, bars);
  assert.equal(v.stale, false);
  assert.equal(v.reason, "move-on-pubdate");
});

test("evaluateStaleRepublish with an injected fetcher (no network)", async () => {
  const eventDay = 6000;
  const bars = makeBars(eventDay - 1, [-1, 60, -20, 1, -2, -3, -1]);
  const input: StaleRepublishInput = {
    id: "inj-1",
    title: "WHY stock soars 60% today",
    source: "Google News (WHY)",
    publishedAt: isoForDay(6006),
  };
  const v = await evaluateStaleRepublish(input, async () => bars);
  assert.equal(v.stale, true);
  assert.equal(v.inferredEventDate, isoForDay(6000).slice(0, 10));
});

test("evaluateStaleRepublish skips the network for gate-ineligible rows", async () => {
  let fetched = false;
  const input: StaleRepublishInput = {
    id: "skip-1",
    title: "TSM reports 30% sales growth",
    source: "Google News (TSM)",
    publishedAt: isoForDay(6000),
  };
  const v = await evaluateStaleRepublish(input, async () => {
    fetched = true;
    return [];
  });
  assert.equal(fetched, false, "must not hit the network for a gate-failed row");
  assert.equal(v.stale, false);
});

// ---------------------------------------------------------------------------
// Mode switch
// ---------------------------------------------------------------------------

test("resolveStaleRepublishMode defaults to shadow", () => {
  assert.equal(resolveStaleRepublishMode(undefined), "shadow");
  assert.equal(resolveStaleRepublishMode(""), "shadow");
  assert.equal(resolveStaleRepublishMode("garbage"), "shadow");
  assert.equal(resolveStaleRepublishMode("off"), "off");
  assert.equal(resolveStaleRepublishMode("ACTIVE"), "active");
  assert.equal(resolveStaleRepublishMode(" Shadow "), "shadow");
});

test("correctedRecencyIso is prod-neutral in off/shadow", () => {
  const verdict: StaleVerdict = {
    stale: true,
    reason: "flagged",
    ticker: "YYGH",
    claimPct: 60,
    direction: "up",
    pubDateMove: 5,
    inferredEventDate: "2026-06-10",
    action: "both",
  };
  const pub = "2026-06-16T08:55:07.000Z";
  // off/shadow: returns the original pubDate unchanged.
  assert.equal(correctedRecencyIso("off", pub, verdict), pub);
  assert.equal(correctedRecencyIso("shadow", pub, verdict), pub);
  // active: corrects to the inferred event date.
  assert.equal(correctedRecencyIso("active", pub, verdict), "2026-06-10T00:00:00.000Z");
  // active but not stale: unchanged.
  assert.equal(correctedRecencyIso("active", pub, { ...verdict, stale: false }), pub);
});

test("shadowLogLine emits a greppable line only for stale verdicts", () => {
  const input: StaleRepublishInput = {
    id: "abc",
    title: "YYGH soaring 60% premarket",
    source: "Google News (YYGH)",
    publishedAt: "2026-06-16T08:55:07.000Z",
  };
  const stale: StaleVerdict = {
    stale: true, reason: "flagged", ticker: "YYGH", claimPct: 60, direction: "up",
    pubDateMove: 5.4, inferredEventDate: "2026-06-10", action: "both",
  };
  const line = shadowLogLine(input, stale);
  assert.ok(line && line.startsWith("STALE_REPUBLISH_SHADOW "));
  assert.ok(line.includes("ticker=YYGH"));
  assert.ok(line.includes("inferred_event=2026-06-10"));
  assert.ok(line.includes("action=both"));
  // not stale -> null
  assert.equal(shadowLogLine(input, { ...stale, stale: false }), null);
});

// ---------------------------------------------------------------------------
// Ranking: applyStaleRankPenalty (active path in isolation; no-op in off/shadow)
// ---------------------------------------------------------------------------

function row(id: string, relevance: number): TopStoryRow {
  return {
    id, title: id, source: null, summary: null, content: null, sector: null,
    industry_verticals: null, activity_types: null, sentiment: null,
    published_at: null, ingested_at: new Date().toISOString(), url: null,
    companies: null, primary_company: null, relevance_score: relevance,
  };
}

test("applyStaleRankPenalty is a NO-OP (order unchanged) in off and shadow", () => {
  const rows = [row("a", 10), row("b", 7), row("c", 5)];
  const verdicts = new Map<string, StaleVerdict>([
    ["a", { stale: true, reason: "flagged", ticker: "A", claimPct: 60, direction: "up",
      pubDateMove: 0, inferredEventDate: sixDaysAgoISODate(), action: "both" }],
  ]);
  for (const mode of ["off", "shadow"] as const) {
    const out = applyStaleRankPenalty(rows, verdicts, mode);
    assert.deepEqual(out.map((r) => r.id), ["a", "b", "c"], `no-op in ${mode}`);
  }
});

test("applyStaleRankPenalty active: a stale relevance-10 row sinks below fresh content", () => {
  const rows = [row("stale10", 10), row("fresh7", 7), row("fresh6", 6)];
  const verdicts = new Map<string, StaleVerdict>([
    ["stale10", { stale: true, reason: "flagged", ticker: "X", claimPct: 60,
      direction: "up", pubDateMove: 0, inferredEventDate: sixDaysAgoISODate(), action: "both" }],
  ]);
  const out = applyStaleRankPenalty(rows, verdicts, "active");
  // stale10 effective = 10 - 1.5*6 = 1.0, so it drops below fresh7 and fresh6.
  assert.deepEqual(out.map((r) => r.id), ["fresh7", "fresh6", "stale10"]);
});

test("applyStaleRankPenalty active: non-stale rows keep their order (stable)", () => {
  const rows = [row("a", 10), row("b", 10), row("c", 9)];
  const out = applyStaleRankPenalty(rows, new Map(), "active");
  assert.deepEqual(out.map((r) => r.id), ["a", "b", "c"]);
});

function sixDaysAgoISODate(): string {
  return new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
}
