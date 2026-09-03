/**
 * The quote at the head of the mobile Price and tone section.
 *
 * FOUR CONDITIONS, because the screen has four and desktop draws two of them
 * identically. A company with no symbol and a company whose read did not answer
 * both come out of the desktop strip as a dash, and the first of them also
 * picks up a "Private" badge that is false on over a thousand live rows. Each
 * case below is one of those, held against the pure module so it can be checked
 * without a browser.
 *
 * The last test is the load-bearing one: it is the guard on the ruling this
 * work sits inside. The quote may be on the SCREEN. It may not be on the
 * SERVER SHAPE.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  QUOTE_FAILED_COPY,
  QUOTE_PENDING_ANNOUNCE_MS,
  QUOTE_PENDING_COPY,
  buildQuoteCaption,
  formatQuoteCap,
  formatQuoteDay,
  formatQuoteLast,
  quoteLineView,
} from "../../src/lib/company-mobile/quote-line.ts";
import type { CompanyIntelData } from "../../src/components/company/mobile/types.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Source with every comment removed.
 *
 * THE ASSERTIONS BELOW BIND ON CODE, NOT ON PROSE, and they have to. The server
 * mapper names `/api/company-kpis` in its own header, at length, in order to
 * record why the quote stays off the shape. A text search over the raw file
 * cannot tell the ruling from a breach of it. Stripping comments first means
 * the file may go on arguing the rule while the check watches the code.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/* ── condition 1: the read is in flight ──────────────────────────────── */

test("a read in flight draws nothing until it has run long enough to be worth saying", () => {
  /* Timed on this route: median 58ms, p90 73ms, worst 213ms warm. A skeleton
     over that gap is a drawing of a load, not a load, and this screen already
     deleted one for that reason. Under the gate the block reserves its height
     and says nothing. */
  const early = quoteLineView({ ticker: "AAPL", phase: "pending", elapsedMs: 58 });
  assert.deepEqual(early, { kind: "pending", announce: false });

  const p90 = quoteLineView({ ticker: "AAPL", phase: "pending", elapsedMs: 73 });
  assert.equal(p90.kind === "pending" && p90.announce, false);

  /* Past the gate a reader on a poor connection gets a word rather than a
     blank strip. That reader is not on the timing bench. */
  const late = quoteLineView({
    ticker: "AAPL",
    phase: "pending",
    elapsedMs: QUOTE_PENDING_ANNOUNCE_MS,
  });
  assert.deepEqual(late, { kind: "pending", announce: true });
  assert.equal(QUOTE_PENDING_COPY, "reading the quote");
});

test("the announce gate sits past the measured worst case, cold start included", () => {
  /* 286ms is the first call after a cold start, where a crumb fetch runs ahead
     of the quote. The gate has to clear that or the pending copy flashes on
     every first load of the day. */
  assert.ok(QUOTE_PENDING_ANNOUNCE_MS > 286);
});

/* ── condition 2: the read answered ──────────────────────────────────── */

test("a resolved read draws last, the day move, and market cap", () => {
  const view = quoteLineView({
    ticker: "AAPL",
    phase: "answered",
    body: { kind: "live", ticker: "AAPL", last: 183.63, change: 0.0124, marketCap: 2.79e12 },
  });
  assert.equal(view.kind, "quoted");
  if (view.kind !== "quoted") return;
  assert.equal(view.last, "$183.63");
  assert.equal(view.day, "+1.24%");
  assert.equal(view.direction, "up");
  assert.equal(view.cap, "$2.8T");
});

test("the day move names its window, which is the whole point of drawing it", () => {
  /* The desktop tab draws two market figures at once and they disagree: this
     day move, and the chart's move since the start of a range that defaults to
     three months and is labelled nowhere. Whatever is drawn here says over
     what. */
  const view = quoteLineView({
    ticker: "AAPL",
    phase: "answered",
    body: { kind: "live", ticker: "AAPL", last: 183.63, change: 0.0124, marketCap: 2.79e12 },
  });
  if (view.kind !== "quoted") throw new Error("expected a drawn quote");
  assert.equal(view.caption, "last, change since prior close, market cap");
  assert.ok(view.caption.includes("prior close"));
});

test("the caption names only the figures that are actually drawn", () => {
  /* The route's price-only branch carries no market cap. A caption that names
     one anyway sends a reader looking for a figure that is not there. */
  const view = quoteLineView({
    ticker: "TSLA",
    phase: "answered",
    body: { kind: "price-only-fallback", ticker: "TSLA", last: 240.1, change: -0.0083 },
  });
  if (view.kind !== "quoted") throw new Error("expected a drawn quote");
  assert.equal(view.cap, null);
  assert.equal(view.caption, "last, change since prior close");
  assert.equal(view.day, "-0.83%");
  assert.equal(view.direction, "down");

  /* And with no day figure either, it names the one thing it drew. */
  assert.equal(buildQuoteCaption({ day: false, cap: false }), "last");
});

test("direction follows the rounded figure, never the raw one", () => {
  /* A move of four ten-thousandths of a percent draws as "0.00%". Painting
     that green states a rise the drawn number does not show. */
  const tiny = formatQuoteDay(0.0000004);
  assert.deepEqual(tiny, { text: "0.00%", direction: "flat" });
  assert.deepEqual(formatQuoteDay(0), { text: "0.00%", direction: "flat" });
  assert.deepEqual(formatQuoteDay(-0.0000004), { text: "0.00%", direction: "flat" });
});

test("a price under a cent is drawn at a precision that carries it", () => {
  /* One sampled tail symbol quotes far enough below a cent that two decimals
     print "$0.00", which is a price nobody is at. The read answered and the
     answer is true, so the figure is widened rather than thrown away. */
  assert.equal(formatQuoteLast(0.00432), "$0.0043");
  assert.notEqual(formatQuoteLast(0.00432), "$0.00");
  assert.equal(formatQuoteLast(0.0000000123), "$0.000000012");
  /* And the ordinary case is unchanged. */
  assert.equal(formatQuoteLast(1234.5), "$1,234.50");
});

test("market cap abbreviates without inventing a figure", () => {
  assert.equal(formatQuoteCap(2.79e12), "$2.8T");
  assert.equal(formatQuoteCap(4.2e9), "$4.2B");
  assert.equal(formatQuoteCap(8.5e6), "$8.5M");
  assert.equal(formatQuoteCap(null), null);
  assert.equal(formatQuoteCap(0), null);
});

/* ── condition 3: the row carries no symbol ──────────────────────────── */

test("no symbol draws no line, and never the word desktop uses", () => {
  /* 1,028 live rows carry no symbol, among them several of the largest listed
     companies in the world. The desktop strip prints "Private" over every one
     of them, off nothing but that null. It is a falsehood and it does not
     cross. The absent case says nothing at all. */
  assert.deepEqual(quoteLineView({ ticker: "", phase: "pending" }), { kind: "absent" });
  assert.deepEqual(quoteLineView({ ticker: "   ", phase: "answered" }), { kind: "absent" });

  /* An absent view carries no field to draw. Not a dash, not a badge, not a
     stand-in: the object has one key and the component gives back null on it. */
  assert.deepEqual(Object.keys(quoteLineView({ ticker: "", phase: "answered" })), ["kind"]);

  /* And no string this module can produce carries the word, on any branch.
     Checked over the output rather than over the source, because the source
     legitimately carries a lowercase `"private"`: it is the discriminant on the
     upstream body, which is a fact about what the endpoint said and not a
     sentence anyone reads. */
  const everyString = [
    QUOTE_FAILED_COPY,
    QUOTE_PENDING_COPY,
    buildQuoteCaption({ day: true, cap: true }),
    buildQuoteCaption({ day: true, cap: false }),
    buildQuoteCaption({ day: false, cap: true }),
    buildQuoteCaption({ day: false, cap: false }),
  ];
  for (const s of everyString) {
    assert.doesNotMatch(s, /private/i, `"${s}" must not carry desktop's label`);
  }

  /* The rendered badge itself, spelled the way desktop spells it, is in
     neither module's code. */
  for (const rel of [
    "src/lib/company-mobile/quote-line.ts",
    "src/components/company/mobile/QuoteLine.tsx",
  ]) {
    assert.doesNotMatch(code(rel), /["'`]Private["'`]/, `${rel} must not draw desktop's label`);
  }
});

/* ── condition 4: the read did not answer ────────────────────────────── */

test("a read that did not answer says so, and is never drawn as an empty one", () => {
  /* Desktop conflates both into a dash. These are different facts. */
  assert.deepEqual(quoteLineView({ ticker: "AAPL", phase: "failed" }), { kind: "failed" });
  assert.deepEqual(
    quoteLineView({ ticker: "AAPL", phase: "answered", body: null }),
    { kind: "failed" },
  );
  assert.equal(QUOTE_FAILED_COPY, "quote read failed");
  assert.notEqual(QUOTE_FAILED_COPY, "");
});

test("an upstream miss on a row that HAS a symbol is a failed read, not a private company", () => {
  /* Same reasoning the desktop strip already records beside its own privacy
     check: the source of truth for unlisted is the symbol, not what the quote
     endpoint said. A row with a symbol that the endpoint 404s is a quote this
     screen could not get. */
  const view = quoteLineView({
    ticker: "NEWCO",
    phase: "answered",
    body: { kind: "private", ticker: "NEWCO", reason: "upstream 404" },
  });
  assert.deepEqual(view, { kind: "failed" });
});

test("a body with no usable last figure is a failed read", () => {
  for (const last of [null, 0, -1, Number.NaN]) {
    const view = quoteLineView({
      ticker: "THIN",
      phase: "answered",
      body: { kind: "live", ticker: "THIN", last, change: null, marketCap: null },
    });
    assert.deepEqual(view, { kind: "failed" }, `last=${String(last)} must not draw`);
  }
});

/* ── the ruling this work sits inside ────────────────────────────────── */

test("the quote never reaches the server shape", () => {
  /* The price was ruled off this screen three times in code and once in a
     commit body, and every one of those rulings is about the SERVER SHAPE: a
     figure drawn from a shape with no quote read behind it can only be stale
     or invented. That rule is kept exactly. The figures are read in the
     browser and they are never assembled on the server.

     This test is the guard on it. If a later change puts a price on the shape
     to save a round trip, this fails and names the reason. */
  const serverSide = [
    "src/lib/company-mobile/build.ts",
    "src/components/company/mobile/types.ts",
  ];
  for (const rel of serverSide) {
    const src = code(rel);
    assert.doesNotMatch(src, /company-kpis|QuoteLine|quote-line/, `${rel} must not reach the quote`);
    assert.doesNotMatch(src, /marketCap|regularMarket|quoteSummary/, `${rel} must carry no quote figure`);
  }

  /* And the module that DOES read it is a browser module, so the read cannot
     happen during the server render even by accident. */
  assert.match(read("src/components/company/mobile/QuoteLine.tsx"), /^"use client";/);
  assert.match(read("src/components/company/mobile/sections.tsx"), /^"use client";/);
});

/* A compile-time half of the same guard: tsc fails if a quote field is ever
   added to the shape, which a text search would miss if it were named
   something new. */
type QuoteField = "last" | "price" | "change" | "marketCap" | "quote" | "dayChange";
type ShapeCarriesNoQuote = Extract<keyof CompanyIntelData, QuoteField> extends never ? true : never;
const shapeCarriesNoQuote: ShapeCarriesNoQuote = true;

test("the shape type itself declares no quote field", () => {
  assert.equal(shapeCarriesNoQuote, true);
});
