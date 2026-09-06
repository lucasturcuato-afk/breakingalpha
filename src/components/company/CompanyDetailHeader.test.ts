import { test } from "node:test";
import assert from "node:assert/strict";

import { formatSubtitle } from "./CompanyDetailHeader";
import { computeAttention } from "@/lib/attention";
import type { ToneSummary } from "@/lib/tone";
import type { CompanyDetail } from "@/lib/data-access/getCompanyDetail";

const EMPTY_TONE: ToneSummary = {
  sufficient: false,
  score: null,
  level: null,
  levelLabel: "",
  evidence: { total: 0, positive: 0, neutral: 0, negative: 0 },
  direction: null,
  priorLevel: null,
  priorLevelLabel: null,
};

// Minimal CompanyDetail. Only ticker, exchange and sector reach formatSubtitle;
// the rest is structural so the fixture type-checks against the real interface.
function detail(over: Partial<CompanyDetail>): CompanyDetail {
  return {
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
    tone: EMPTY_TONE,
    attention: computeAttention(0, 0),
    articles: [],
    articlesTruncated: false,
    articleWindowDays: 14,
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
