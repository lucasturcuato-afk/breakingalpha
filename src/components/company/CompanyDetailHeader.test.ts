import { test } from "node:test";
import assert from "node:assert/strict";

import { formatSubtitle } from "./CompanyDetailHeader";
import type { CompanyDetail } from "@/lib/data-access/getCompanyDetail";
import { computeTone } from "@/lib/tone";
import { computeAttention } from "@/lib/attention";
import { ARTICLE_DAYS_FAST } from "@/lib/article-window";

// Minimal CompanyDetail. Only ticker, exchange and sector reach formatSubtitle;
// the rest is structural so the fixture type-checks against the real interface.
//
// The tone and attention members are built by calling the real aggregators on
// empty input rather than by asserting a shape onto a literal. Two `as` casts
// used to stand here and both were false. `tone` claimed an evidence of null,
// which ToneSummary documents as always populated even in the insufficient
// case, and `attention` asserted an empty object onto AttentionSummary. A cast
// silences the compiler without making the value true, so the fixture drifted
// away from the interface it claims to model. computeTone([], []) and
// computeAttention(0, 0) are the insufficient-coverage values a real company
// with no scored mentions gets, they are checked, and they cannot drift.
function detail(over: Partial<CompanyDetail>): CompanyDetail {
  return {
    // Not read by formatSubtitle. Present because CompanyDetail requires it:
    // it is a companies.id primary key and every resolved page has one, so the
    // fixture must have one too.
    companyId: "00000000-0000-0000-0000-000000000000",
    canonical: "Test Co",
    display: "Test Co",
    ticker: null,
    exchange: null,
    sector: "Industrials",
    industry: null,
    aliases: [],
    aliasMentions: [],
    mentions: 0,
    mentions7d: [],
    sentiment7d: [],
    tone: computeTone([], []),
    attention: computeAttention(0, 0),
    articles: [],
    // An empty article list is not a truncated one, and the window is the
    // unescalated first rung, which is what a zero-row read leaves in place.
    articlesTruncated: false,
    articleWindowDays: ARTICLE_DAYS_FAST,
    themes: [],
    memo: null,
    isPrivate: false,
    ...over,
  };
}

// THE REGRESSION. Eleven NYSE filers among the twenty rows stamped on
// 2026-09-04 began printing "NASDAQ" the moment they gained a ticker, because
// the subtitle inferred a listing venue from ticker presence. There is no
// exchange column and CompanyDetail.exchange is null for every row today, so
// a ticker-bearing company must print its sector alone.
test("a ticker without an exchange never asserts an exchange", () => {
  for (const ticker of ["CF", "NPO", "KO", "WAB", "MSGS", "LH"]) {
    const out = formatSubtitle(detail({ ticker, exchange: null }));
    assert.equal(out, "Industrials", `${ticker} must print the bare sector`);
    assert.doesNotMatch(out, /NASDAQ|NYSE|·/, `${ticker} must not name a venue`);
  }
});

test("a real exchange value is printed when we hold one", () => {
  assert.equal(
    formatSubtitle(detail({ ticker: "CF", exchange: "NYSE", sector: "Materials" })),
    "NYSE · Materials",
  );
  assert.equal(
    formatSubtitle(detail({ ticker: "MARA", exchange: "Nasdaq", sector: "Technology" })),
    "Nasdaq · Technology",
  );
});

test("a blank or whitespace exchange counts as absent", () => {
  assert.equal(formatSubtitle(detail({ ticker: "CF", exchange: "" })), "Industrials");
  assert.equal(formatSubtitle(detail({ ticker: "CF", exchange: "   " })), "Industrials");
});

test("a private company with no ticker prints the bare sector", () => {
  assert.equal(formatSubtitle(detail({ ticker: null, sector: "Software" })), "Software");
});

test("a missing sector falls back to the placeholder", () => {
  assert.equal(formatSubtitle(detail({ ticker: "CF", sector: null })), "--");
  assert.equal(formatSubtitle(detail({ ticker: "CF", exchange: "NYSE", sector: null })), "NYSE · --");
});
