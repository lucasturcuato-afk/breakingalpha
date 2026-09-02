/**
 * The four counts on the mobile Company Intel screen, and the arithmetic each
 * one owes a reader.
 *
 * Every case below was a live defect on the rendered screen before this file
 * existed. The measurements quoted are from a production build at 320, 375, 390
 * and 430 in both themes, signed in, on apple, meta and goldman-sachs.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { primerDevelopmentsEmptyCopy } from "../../src/components/company/tabs/empty-state-copy.ts";
import { buildCorpusNote, buildMasthead } from "../../src/lib/company-mobile/build.ts";
import { formatEvidence } from "../../src/lib/tone.ts";
import type { CompanyDetail } from "../../src/lib/data-access/getCompanyDetail.ts";

/* ── shared fixture ──────────────────────────────────────────────────── */

function article(id: string) {
  return {
    id,
    title: "t",
    source: "Reuters",
    url: null,
    publishedAt: null,
    sentiment: null,
    dealType: null,
    relevanceScore: null,
    sector: null,
    summary: null,
    relevanceReason: null,
    sentimentReason: null,
    ingestedAt: null,
    sourceWinRate: null,
    sourceSampleSize: null,
    completeness: "headline" as const,
  };
}

function detail(over: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    companyId: "00000000-0000-4000-8000-000000000001",
    canonical: "Apple",
    display: "Apple",
    ticker: "AAPL",
    exchange: null,
    sector: null,
    industry: null,
    aliases: [],
    aliasMentions: [],
    mentions: 0,
    mentions7d: [],
    sentiment7d: [],
    tone: {
      sufficient: false,
      score: null,
      level: null,
      levelLabel: "",
      evidence: { total: 0, positive: 0, neutral: 0, negative: 0 },
      direction: null,
      priorLevel: null,
      priorLevelLabel: null,
    },
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
    articles: [],
    articlesTruncated: false,
    articleWindowDays: 14,
    themes: [],
    memo: null,
    isPrivate: false,
    ...over,
  };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => article(String(i)));

/* ── count 1: the corpus on the memo control ─────────────────────────── */

test("a capped corpus declares its ceiling and an uncapped one does not", () => {
  /* Measured: apple and meta both drew "50 ARTICLES" where 50 is the read's
     `.limit()`, goldman-sachs drew "47 ARTICLES" where 47 is a total. The two
     states were drawn identically, so a reader could not tell a ceiling from a
     population. */
  const capped = buildMasthead(detail({ articles: rows(50), articlesTruncated: true }));
  const total = buildMasthead(detail({ articles: rows(47), articlesTruncated: false }));
  assert.equal(capped.memoCorpus, "50+ ARTICLES");
  assert.equal(total.memoCorpus, "47 ARTICLES");
  // The plus is the ONLY difference. No invented estimate of the true count.
  assert.equal(capped.memoCorpus.replace("+", ""), "50 ARTICLES");
});

test("the corpus stays a count and never becomes a rate", () => {
  const m = buildMasthead(detail({ articles: rows(1) }));
  assert.equal(m.memoCorpus, "1 ARTICLE");
  assert.equal(/%|per|rate/i.test(m.memoCorpus), false);
});

test("the memo cache key is the canonical identity and not the display string", () => {
  /* `display` is free to diverge from `canonical`. A cache lookup keyed on the
     display string misses the day it does, and a memo-cache miss spends a
     model call. */
  const m = buildMasthead(detail({ canonical: "Apple", display: "Apple Inc. (AAPL)" }));
  assert.equal(m.memoCompany, "Apple");
  assert.notEqual(m.memoCompany, m.name);
});

/* ── the pair: corpus against the mention count ──────────────────────── */

test("the corpus note states both denominators, both windows, and the cap", () => {
  const note = buildCorpusNote(detail({ articles: rows(50), articlesTruncated: true }));
  assert.match(note, /50 articles/);
  assert.match(note, /last 14 days/);
  assert.match(note, /at least 50/);
  assert.match(note, /mention rows over 7 days/);
  assert.match(note, /ingest run rather than by publication/);
  // No ratio between two counts over different objects.
  assert.equal(/%/.test(note), false);
});

test("the corpus note names the ESCALATED window when the read escalated", () => {
  /* The article read escalates from 14 days to 365 when the fast rung comes
     back thin. A note hardcoding 14 mislabels exactly the thin companies,
     which are the ones where a reader is most likely to be counting. */
  const note = buildCorpusNote(detail({ articles: rows(2), articleWindowDays: 365 }));
  assert.match(note, /last 365 days/);
  assert.equal(note.includes("last 14 days"), false);
});

test("an uncapped corpus note claims no ceiling", () => {
  const note = buildCorpusNote(detail({ articles: rows(47), articlesTruncated: false }));
  assert.equal(note.includes("at least"), false);
  assert.equal(note.includes("ceiling"), false);
});

/* ── count 4: the tone evidence noun ─────────────────────────────────── */

test("the tone evidence counts mentions and says so", () => {
  /* `ToneEvidence` is tallied over the labels handed to `computeTone`, whose
     only production caller builds both windows out of `company_mentions`. The
     sentence said "articles" while sitting a few pixels from a separate count
     of `articles` rows under the word ARTICLES. Measured on apple: the control
     read 50 while this read "10 of 55 articles positive", one noun over two
     different objects in two different tables. */
  const s = formatEvidence({ total: 55, positive: 10, neutral: 30, negative: 15 });
  assert.equal(s, "10 of 55 mentions positive");
  assert.equal(s.includes("article"), false);
});

test("the tone evidence singular is a mention", () => {
  assert.equal(
    formatEvidence({ total: 1, positive: 1, neutral: 0, negative: 0 }),
    "1 of 1 mention positive",
  );
});

/* ── the empty state: three branches, one of which was false ─────────── */

test("a full pool is reported as a full pool and never as an empty window", () => {
  /* THE DEFECT. Development-classified rows exist inside the 30-day window the
     loader queries, and zero render, because the ten slots fill out of the
     14-day filler sub-window before the step that reaches back can run.
     Measured on apple and meta at every phone width in both themes. */
  const c = primerDevelopmentsEmptyCopy({
    selected: 10,
    poolSize: 10,
    candidates: 62,
    candidateDevelopments: 6,
    windowDays: 30,
    fillerWindowDays: 14,
  });
  assert.match(c.note, /6 company developments sit in the last 30 days/);
  assert.match(c.note, /pool of 10 and took 10/);
  assert.match(c.note, /last 14 days first, and that filled it/);
  // The false sentence must not survive on this branch.
  assert.equal(c.headline.includes("No indexed coverage"), false);
  // The count is stated, not hidden.
  assert.match(c.note, /\b6\b/);
});

test("the full-pool branch reads singular for one development", () => {
  const c = primerDevelopmentsEmptyCopy({
    selected: 10,
    poolSize: 10,
    candidates: 30,
    candidateDevelopments: 1,
    windowDays: 30,
    fillerWindowDays: 14,
  });
  assert.match(c.note, /1 company development sits/);
});

test("coverage with no development in it is a DIFFERENT and honest state", () => {
  /* The common case, and the reason deleting the empty state would have been
     wrong. A reader has to be able to tell it from the branch above. */
  const c = primerDevelopmentsEmptyCopy({
    selected: 10,
    poolSize: 10,
    candidates: 41,
    candidateDevelopments: 0,
    windowDays: 30,
    fillerWindowDays: 14,
  });
  assert.match(c.note, /all 41 articles indexed in the last 30 days/);
  assert.match(c.note, /none is a development/);
  assert.equal(c.note.includes("pool"), false);
});

test("the two non-empty branches are distinguishable to a reader", () => {
  const full = primerDevelopmentsEmptyCopy({
    selected: 10, poolSize: 10, candidates: 62, candidateDevelopments: 6,
    windowDays: 30, fillerWindowDays: 14,
  });
  const honest = primerDevelopmentsEmptyCopy({
    selected: 10, poolSize: 10, candidates: 62, candidateDevelopments: 0,
    windowDays: 30, fillerWindowDays: 14,
  });
  assert.notEqual(full.headline, honest.headline);
  assert.notEqual(full.note, honest.note);
});

test("genuinely no coverage keeps the original sentence, with the count behind it", () => {
  const c = primerDevelopmentsEmptyCopy({
    selected: 0,
    poolSize: 10,
    candidates: 0,
    candidateDevelopments: 0,
    windowDays: 30,
    fillerWindowDays: 14,
  });
  assert.equal(c.headline, "No indexed coverage in the window this primer reads from.");
  assert.match(c.note, /Zero articles are indexed/);
  assert.match(c.note, /last 30 days/);
});

test("the windowless read paths never name a window they did not apply", () => {
  /* The cache path hops `watchlist_articles` with no published_at gate at all,
     so it reads an unbounded window. Printing "in the last 30 days" over its
     answer states a window nothing enforced. */
  for (const candidateDevelopments of [0, 4]) {
    const c = primerDevelopmentsEmptyCopy({
      selected: 8,
      poolSize: 10,
      candidates: 8,
      candidateDevelopments,
      windowDays: null,
      fillerWindowDays: null,
    });
    assert.equal(/last \d+ days/.test(c.note), false);
    assert.equal(/\b30\b|\b14\b/.test(c.note), false);
  }
});

test("no empty-state branch ever renders an empty string", () => {
  /* A failed read must never render as an empty one, and neither must an
     absent count. */
  const cases = [
    { candidates: 0, candidateDevelopments: 0, windowDays: 30, fillerWindowDays: 14 },
    { candidates: 0, candidateDevelopments: 0, windowDays: null, fillerWindowDays: null },
    { candidates: 9, candidateDevelopments: 0, windowDays: 30, fillerWindowDays: 14 },
    { candidates: 9, candidateDevelopments: 3, windowDays: 30, fillerWindowDays: 14 },
    { candidates: 1, candidateDevelopments: 0, windowDays: 30, fillerWindowDays: 14 },
  ] as const;
  for (const c of cases) {
    const copy = primerDevelopmentsEmptyCopy({ selected: 5, poolSize: 10, ...c });
    assert.ok(copy.headline.trim().length > 0);
    assert.ok(copy.note.trim().length > 0);
  }
});

test("no empty-state branch states a rate or an outcome word", () => {
  const copy = primerDevelopmentsEmptyCopy({
    selected: 10, poolSize: 10, candidates: 62, candidateDevelopments: 6,
    windowDays: 30, fillerWindowDays: 14,
  });
  for (const text of [copy.headline, copy.note]) {
    assert.equal(/%|\bper cent\b|\brate\b|\baccuracy\b/i.test(text), false);
    assert.equal(/\b(right|wrong|correct|win|won|loss|lost)\b/i.test(text), false);
    assert.equal(text.includes("—"), false);
  }
});
