import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTone } from "./build";
import { computeTone, type SentimentLabel, type ToneSummary } from "@/lib/tone";
import type {
  CompanyDetail,
  CompanyDetailArticle,
} from "@/lib/data-access/getCompanyDetail";

/**
 * buildTone, the tone block of the mobile Company Intel screen.
 *
 * WHY UNIT AND NOT E2E. `/company/[id]` is a server component, so its reads
 * happen before any bytes reach a browser and `page.route()` cannot see them.
 * Playwright can assert what the section painted but not what the mapper was
 * handed, which is exactly the seam that has to be right. These feed the mapper
 * a real `ToneSummary` (built by `computeTone` from label arrays, never
 * hand-written) plus real `articles.sentiment_reason` rows and assert the
 * mapped output. That substitutes for e2e under the preflight rule in
 * CLAUDE.md.
 *
 * THE FOUR THINGS THE DELETED FIXTURE GOT WRONG are each pinned below, because
 * each was producible-looking and none of them is producible:
 *   1. a level word outside the closed five ("Constructive")
 *   2. a direction with no prior-level clause ("▲ improving")
 *   3. an evidence sentence naming a source count
 *   4. a row that groups articles ("7 ARTICLES · AUG 1")
 * Plus the one the widened type exists for: a bearish row must read "down" and
 * not "mixed".
 */

/** The five words `levelToLabel` can produce, and the only five. */
const CLOSED_VOCABULARY = [
  "Strongly Positive",
  "Positive",
  "Mixed",
  "Negative",
  "Strongly Negative",
];

const DAY_MS = 86_400_000;

/** Inside the 7-day evidence window, by however many days. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

/**
 * Real rows, copied off `articles` on 2026-08-29. `sentimentReason` is the
 * verbatim column value; nothing here is written for the test.
 */
function article(over: Partial<CompanyDetailArticle> = {}): CompanyDetailArticle {
  return {
    id: "6b641e68-97c7-4699-af09-89187780b055",
    title: "Walmart to Pay $50 Million to Settle Opioid Lawsuit, US Says",
    source: "NYT Business",
    url: null,
    publishedAt: daysAgo(1),
    sentiment: "bearish",
    dealType: null,
    relevanceScore: 80,
    sector: null,
    summary: null,
    relevanceReason: null,
    sentimentReason: "Walmart to pay $50 million to settle opioid lawsuits.",
    ingestedAt: null,
    sourceWinRate: null,
    sourceSampleSize: null,
    completeness: "headline",
    ...over,
  };
}

function detailWith(tone: ToneSummary, articles: CompanyDetailArticle[]): CompanyDetail {
  return {
    canonical: "Broadcom",
    display: "Broadcom",
    ticker: "AVGO",
    exchange: null,
    sector: null,
    industry: null,
    aliases: [],
    aliasMentions: [],
    mentions: 0,
    mentions7d: [],
    sentiment7d: [],
    tone,
    attention: {
      sufficient: false,
      level: null,
      levelLabel: "",
      ratio: null,
      currentCount: 0,
      baselineCount: 0,
      currentRate: null,
      baselineRate: null,
    },
    articles,
    themes: [],
    memo: null,
    isPrivate: false,
  };
}

function labels(n: number, label: SentimentLabel): SentimentLabel[] {
  return new Array<SentimentLabel>(n).fill(label);
}

describe("buildTone: the level word", () => {
  it("only ever emits one of the closed five", () => {
    const cases: Array<[SentimentLabel[], string]> = [
      [labels(6, "bullish"), "Strongly Positive"],
      [[...labels(3, "bullish"), ...labels(3, "neutral")], "Positive"],
      [labels(6, "neutral"), "Mixed"],
      [[...labels(3, "bearish"), ...labels(3, "neutral")], "Negative"],
      [labels(6, "bearish"), "Strongly Negative"],
    ];
    for (const [current, expected] of cases) {
      const built = buildTone(detailWith(computeTone(current, []), []));
      assert.equal(built.level, expected);
      assert.ok(
        CLOSED_VOCABULARY.includes(built.level as string),
        `${built.level} is outside the closed vocabulary`,
      );
    }
  });

  it("never emits the design's word", () => {
    const built = buildTone(detailWith(computeTone(labels(8, "bullish"), []), []));
    assert.notEqual(built.level, "Constructive");
  });

  it("tints the level off the level's own sign, never pinned", () => {
    assert.equal(buildTone(detailWith(computeTone(labels(6, "bullish"), []), [])).levelTone, "up");
    assert.equal(buildTone(detailWith(computeTone(labels(6, "neutral"), []), [])).levelTone, "flat");
    assert.equal(buildTone(detailWith(computeTone(labels(6, "bearish"), []), [])).levelTone, "down");
  });
});

describe("buildTone: the direction phrase", () => {
  it("always carries the prior-level clause", () => {
    // 6 in each window clears DIRECTION_MIN_N (5), so a direction is stated.
    const tone = computeTone(labels(6, "bullish"), labels(6, "neutral"));
    const built = buildTone(detailWith(tone, []));
    assert.equal(built.direction, "Improving · was Mixed last week");
    assert.match(built.direction, / · was .+ last week$/);
  });

  it("states a deteriorating direction as plainly as an improving one", () => {
    const tone = computeTone(labels(6, "bearish"), labels(6, "bullish"));
    assert.equal(buildTone(detailWith(tone, [])).direction, "Deteriorating · was Strongly Positive last week");
  });

  it("is never the design's bare adjective", () => {
    const tone = computeTone(labels(6, "bullish"), labels(6, "neutral"));
    const built = buildTone(detailWith(tone, []));
    assert.notEqual(built.direction, "▲ improving");
    assert.doesNotMatch(built.direction, /▲|▼/);
  });

  it("is suppressed, not neutralised, when the prior window is thin", () => {
    // 4 prior mentions is under DIRECTION_MIN_N, so tone.direction is null.
    const tone = computeTone(labels(6, "bullish"), labels(4, "bullish"));
    assert.equal(tone.direction, null);
    const built = buildTone(detailWith(tone, []));
    assert.equal(built.direction, "");
    assert.equal(built.level, "Strongly Positive", "the level still stands on its own");
  });
});

describe("buildTone: the evidence sentence", () => {
  it("is the count sentence and names no source count", () => {
    const tone = computeTone([...labels(3, "bullish"), "neutral"], []);
    const built = buildTone(detailWith(tone, []));
    assert.equal(built.evidence, "3 of 4 articles positive");
    assert.doesNotMatch(built.evidence, /source/i);
    assert.doesNotMatch(built.evidence, /%/, "a count, never a rate");
  });

  it("counts the same window the level was computed over", () => {
    const tone = computeTone(labels(3, "bullish"), []);
    assert.equal(buildTone(detailWith(tone, [])).evidence, "3 of 3 articles positive");
  });
});

describe("buildTone: the insufficient branch states nothing about the company", () => {
  // 2 scored mentions is under LEVEL_MIN_N (3), the /company/quantinuum case.
  const thin = computeTone(labels(2, "bullish"), labels(14, "bullish"));
  const built = buildTone(detailWith(thin, [article()]));

  it("has no level", () => {
    assert.equal(built.level, null);
  });

  it("has no direction", () => {
    assert.equal(built.direction, "");
  });

  it("has NO evidence sentence, not an empty-valued one", () => {
    assert.equal(built.evidence, "");
    assert.doesNotMatch(built.evidence, /0 of 0/);
  });

  it("still carries the caveat, which is true in both branches", () => {
    assert.ok(built.disclaimer.length > 0);
    assert.doesNotMatch(
      built.disclaimer,
      /no number sits behind/i,
      "computeTone means a score over the window; the score is hidden, not absent",
    );
  });
});

describe("buildTone: one article per row", () => {
  const sufficient = computeTone(labels(6, "bullish"), []);

  it("emits exactly one row per qualifying article and never a grouped count", () => {
    const articles = [
      article({ id: "a", sentimentReason: "First reading.", publishedAt: daysAgo(1) }),
      article({ id: "b", sentimentReason: "Second reading.", publishedAt: daysAgo(1) }),
      article({ id: "c", sentimentReason: "Third reading.", publishedAt: daysAgo(2) }),
    ];
    const built = buildTone(detailWith(sufficient, articles));

    assert.equal(built.rows.length, 3);
    assert.deepEqual(
      built.rows.map((r) => r.reading),
      ["First reading.", "Second reading.", "Third reading."],
      "the reading is articles.sentiment_reason verbatim",
    );
    for (const row of built.rows) {
      assert.doesNotMatch(row.meta, /ARTICLES/i, "no row asserts a cluster count");
      assert.doesNotMatch(row.meta, /^\d+ /, "no row leads with a count of articles");
    }
  });

  it("puts the article's source and date in the meta, uppercased, in that order", () => {
    // The date half is asserted by shape rather than by literal: the row has to
    // be inside the trailing 7-day window to exist at all, so a pinned calendar
    // date would expire. The literal that matters here is the source and the
    // separator.
    const built = buildTone(detailWith(sufficient, [article({ source: "NYT Business" })]));
    assert.match(built.rows[0].meta, /^NYT BUSINESS · [A-Z]{3} \d{1,2}$/);
  });

  it("drops the source half rather than inventing one when the row has none", () => {
    const built = buildTone(detailWith(sufficient, [article({ source: null })]));
    assert.match(built.rows[0].meta, /^[A-Z]{3} \d{1,2}$/);
  });

  it("maps all three sentiment states, so a bearish row cannot read as mixed", () => {
    const built = buildTone(
      detailWith(sufficient, [
        article({ id: "up", sentiment: "bullish", sentimentReason: "Up." }),
        article({ id: "mid", sentiment: "neutral", sentimentReason: "Mid." }),
        article({ id: "dn", sentiment: "bearish", sentimentReason: "Down." }),
      ]),
    );
    assert.deepEqual(
      built.rows.map((r) => r.direction),
      ["up", "mixed", "down"],
    );
  });

  it("drops a row it cannot honestly draw rather than substituting for it", () => {
    const built = buildTone(
      detailWith(sufficient, [
        article({ id: "keep", sentimentReason: "Kept." }),
        article({ id: "stale", sentimentReason: "Outside the window.", publishedAt: daysAgo(9) }),
        article({ id: "noreason", sentimentReason: null }),
        article({ id: "blank", sentimentReason: "   " }),
        article({ id: "unlabelled", sentiment: null, sentimentReason: "No label on this row." }),
        article({ id: "nodate", publishedAt: null, sentimentReason: "No date on this row." }),
      ]),
    );
    assert.deepEqual(
      built.rows.map((r) => r.reading),
      ["Kept."],
    );
  });
});
