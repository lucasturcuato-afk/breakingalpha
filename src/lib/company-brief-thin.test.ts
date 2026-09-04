/**
 * Unit tests for the THIN brief shape: the band #816 left behind.
 * Run: npx tsx --test src/lib/company-brief-thin.test.ts
 *
 * WHAT THIS IS ABOUT.
 *
 * #816 gave the EMPTY pool its own mode and one line. It did nothing for the
 * band just above empty: zero direct developments and one or two context
 * articles, where the prompt still demanded an Analyst Brief, a Coverage Note,
 * a Cross-Signals with a binary verdict, two What To Watch bullets each with a
 * mandatory probability sentence, and a Signal Quality line. With no event and
 * one headline there is nothing to attach a probability to, and the sentence
 * the model reaches for instead is the one that shipped to a reader:
 * "The probability of such a development occurring within the next 30 days is
 * unassessable without further information."
 *
 * That sentence is not in this repository and never was. It is model output. So
 * these tests do not look for its absence in the source. They pin the three
 * things that are actually ours to control:
 *   1. the SHAPE decision (classifyBriefPool), which is one predicate now,
 *   2. the LINE that replaces the five sections, checked through the shipped
 *      compliance guards rather than a hand-written copy of their rules, and
 *   3. the PROMPT instructions, including the explicit ban on that hedge in the
 *      context-led band this mode does not cover.
 *
 * MUTATION TARGETS, AND THE TAGS ARE OBSERVED RATHER THAN INTENDED.
 *
 * The first draft of this file carried one bare `[MUTATION]` tag on eight tests
 * and named one target. Only four of the eight went red under it, a fifth red
 * test was not tagged at all, and the other four guard different lines
 * entirely. A tag that says "this dies when you delete X" and does not is worse
 * than no tag: it is a claim about coverage that review will believe. Every tag
 * below was set by APPLYING the named mutation, running this file, and reading
 * which tests failed. None of them was set by reasoning about intent.
 *
 * Seven mutations, one per production string this change adds, each run against
 * a clean tree and reverted. Baseline is 34 pass, 0 fail.
 *
 *   M1  company-intel.ts, classifyBriefPool: delete
 *       `if (devCount === 0 && ctxCount <= THIN_CONTEXT_MAX) return "thin";`
 *       Observed 29 pass / 5 fail.
 *   M2  company-intel.ts, buildMemoSystemPrompt: delete the
 *       `MEMO_MODE = "thin"` block and its INPUTS entry.  32 pass / 2 fail.
 *   M3  src/app/company/[id]/page.tsx: restore origin/main, which is the
 *       hand-inlined length comparison in all three readers.  30 pass / 4 fail.
 *   M4  brief-voice-guard.ts, detectVoiceViolations: drop the `maskOwnName`
 *       call so the raw memo is scanned again.  29 pass / 5 fail.
 *   M5  company-intel.ts: empty `BRIEF_LINE_NAME_SLOTS`, so no company name is
 *       ever recognised as a proper noun.  28 pass / 6 fail.
 *   M6  company-intel.ts, context-led What To Watch: delete the hedge ban.
 *       33 pass / 1 fail.
 *   M7  company-intel.ts, BRIEF_VOICE_OVERRIDE: back to one exception.
 *       33 pass / 1 fail.
 *
 * A test carries every tag it was OBSERVED to fail under and no others. Every
 * mutation reddens at least one test, and every tagged test reddens under every
 * tag it carries. Untagged tests are boundary and regression pins: green under
 * all seven, there to catch drift in the paths this change did not touch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  classifyBriefPool,
  thinCoverageBriefLine,
  noCoverageBriefLine,
  briefLineCompanyNames,
  buildMemoContent,
  buildMemoSystemPrompt,
  BRIEF_VOICE_OVERRIDE,
  THIN_CONTEXT_MAX,
  type CompanyArticle,
} from "./company-intel";
import {
  hasVoiceViolation,
  detectVoiceViolations,
  enforceBriefVoice,
} from "./brief-voice-guard";
import { filterComplianceLanguage } from "./compliance-language-filter";

// ---------------------------------------------------------------------------
// Fixtures. Titles are real prod headlines from the 30d relevance>=6 window,
// read read-only, for companies measured at exactly these pool sizes.
// ---------------------------------------------------------------------------

function art(over: Partial<CompanyArticle> & { id: string; title: string }): CompanyArticle {
  return {
    source: undefined,
    sector: undefined,
    sentiment: undefined,
    summary: "",
    content: null,
    published_at: "2026-08-30T00:00:00.000Z",
    url: undefined,
    primary_company: null,
    relevance_score: 7,
    deal_type: null,
    _isDevelopment: false,
    ...over,
  };
}

/** Allbirds, measured at dev=0 ctx=1. */
const ONE_CONTEXT: CompanyArticle[] = [
  art({
    id: "a1",
    title: "Smartbird, formerly Allbirds, is building dedicated AI infrastructure for businesses",
    deal_type: "Other",
  }),
];

/** QuantumScape, measured at dev=0 ctx=2. */
const TWO_CONTEXT: CompanyArticle[] = [
  art({
    id: "b1",
    title: "QuantumScape (QS) Updates PowerCo Program And Expands Its Battery Commercialization Efforts",
    deal_type: "Other",
  }),
  art({
    id: "b2",
    title: "QS stock retreats as QuantumScape faces cautious analyst outlook",
    deal_type: "Other",
  }),
];

/** Foot Locker, measured at dev=0 ctx=3: one past the threshold. */
const THREE_CONTEXT: CompanyArticle[] = [
  art({ id: "c1", title: "Dick's Sporting Goods Shares Fall on Q2 Miss and Lowered Foot Locker Outlook", deal_type: "Earnings" }),
  art({ id: "c2", title: "DICK'S sales hit $5.59B as Foot Locker posted a $31.9M segment loss", deal_type: "Earnings" }),
  art({ id: "c3", title: "NIKE (NKE) Partners With Foot Locker As Its Valuation Debate Stays Front And Center", deal_type: "Other" }),
];

const ONE_DEVELOPMENT: CompanyArticle[] = [
  art({
    id: "d1",
    title: "SoFi Technologies posts Q2 results",
    deal_type: "Earnings",
    primary_company: "SoFi Technologies",
    _isDevelopment: true,
  }),
];

// ---------------------------------------------------------------------------
// 1. The shape predicate
// ---------------------------------------------------------------------------

test("[MUTATION M1] classifyBriefPool calls a lone context article with no development thin", () => {
  assert.equal(classifyBriefPool(0, 1), "thin");
});

test("[MUTATION M1] classifyBriefPool holds the thin band open up to THIN_CONTEXT_MAX and closes it one past", () => {
  assert.equal(THIN_CONTEXT_MAX, 2, "the boundary this test describes");
  assert.equal(classifyBriefPool(0, THIN_CONTEXT_MAX), "thin");
  assert.equal(classifyBriefPool(0, THIN_CONTEXT_MAX + 1), "normal");
});

test("classifyBriefPool keeps an empty pool on no-coverage rather than folding it into thin", () => {
  // Order matters: no-coverage is tested first, so #816's one-line-no-model-call
  // path is not silently rerouted through the new mode, which would put a "has 0
  // articles" sentence in front of a reader.
  assert.equal(classifyBriefPool(0, 0), "no-coverage");
});

test("classifyBriefPool never calls a pool thin once it carries a development", () => {
  assert.equal(classifyBriefPool(1, 0), "normal");
  assert.equal(classifyBriefPool(1, 1), "normal");
  assert.equal(classifyBriefPool(3, 0), "normal");
});

// ---------------------------------------------------------------------------
// 2. The memo content
// ---------------------------------------------------------------------------

test("[MUTATION M1] buildMemoContent puts MEMO_MODE thin and the rendered line into a one-article pool", () => {
  const content = buildMemoContent("Allbirds", [], ONE_CONTEXT);
  assert.match(content, /^MEMO_MODE: thin$/m);
  assert.match(
    content,
    new RegExp(`^THIN BRIEF LINE: ${escapeRe(thinCoverageBriefLine("Allbirds", 1))}$`, "m"),
  );
});

test("[MUTATION M1] buildMemoContent carries the same line for a two-article pool, pluralised", () => {
  const content = buildMemoContent("QuantumScape", [], TWO_CONTEXT);
  assert.match(content, /^MEMO_MODE: thin$/m);
  assert.ok(content.includes(`THIN BRIEF LINE: ${thinCoverageBriefLine("QuantumScape", 2)}`));
  assert.ok(content.includes("2 articles tagged to QuantumScape"));
});

test("[MUTATION M1] the THIN BRIEF LINE count is the classified context count, which is the count that chose the mode", () => {
  // classifyBriefPool is asked about contextArticles.length and the sentence
  // reports contextArticles.length. If the line were ever built off
  // effectiveCtxArts (which selectContextArticles caps at 4) the two would part
  // company the first time a pool exceeded the cap, and the reader would be told
  // a number that did not pick the branch they are looking at.
  const content = buildMemoContent("QuantumScape", [], TWO_CONTEXT);
  const m = content.match(/^THIN BRIEF LINE: .*?has (\d+) articles?/m);
  assert.ok(m, "the thin line is present");
  assert.equal(Number(m[1]), TWO_CONTEXT.length);
});

test("BOUNDARY: a three-article context pool stays on the long form and gets no thin line", () => {
  const content = buildMemoContent("Foot Locker", [], THREE_CONTEXT);
  assert.match(content, /^MEMO_MODE: context-led$/m);
  assert.ok(!content.includes("THIN BRIEF LINE"));
});

test("a pool with a development stays developments-led and gets no thin line", () => {
  const content = buildMemoContent("SoFi Technologies", ONE_DEVELOPMENT, []);
  assert.match(content, /^MEMO_MODE: developments-led$/m);
  assert.ok(!content.includes("THIN BRIEF LINE"));
});

test("an empty pool still emits the #816 no-coverage block untouched", () => {
  const content = buildMemoContent("SoFi Technologies", [], []);
  assert.equal(
    content,
    [
      "COMPANY: SoFi Technologies",
      "COMPANY INDUSTRY: Unknown",
      "MEMO_MODE: no-coverage",
      "SIGNAL QUALITY: No articles found for SoFi Technologies in current window",
      "",
      "COMPANY DEVELOPMENT ARTICLES (0):",
      "None",
      "",
      "SECTOR CONTEXT ARTICLES (0):",
      "None",
    ].join("\n"),
  );
});

// ---------------------------------------------------------------------------
// 3. The rich case does not move. These two pin the FULL rendered content
//    string, not a property of it, so any drift in ordering, labels, counts or
//    article formatting fails here.
// ---------------------------------------------------------------------------

test("REGRESSION: a context-led pool above the thin band renders exactly what it rendered before", () => {
  assert.equal(
    buildMemoContent("Foot Locker", [], THREE_CONTEXT),
    [
      "COMPANY: Foot Locker",
      "COMPANY INDUSTRY: Unknown",
      "MEMO_MODE: context-led",
      "SIGNAL QUALITY: No direct events - 3 context articles, 3 with Foot Locker in title",
      "",
      "COMPANY DEVELOPMENT ARTICLES (0):",
      "None",
      "",
      "SECTOR CONTEXT ARTICLES (3):",
      "* [Earnings] Dick's Sporting Goods Shares Fall on Q2 Miss and Lowered Foot Locker Outlook",
      "",
      "* [Earnings] DICK'S sales hit $5.59B as Foot Locker posted a $31.9M segment loss",
      "",
      "* [Other] NIKE (NKE) Partners With Foot Locker As Its Valuation Debate Stays Front And Center",
    ].join("\n"),
  );
});

test("REGRESSION: a developments-led pool renders exactly what it rendered before", () => {
  assert.equal(
    buildMemoContent("SoFi Technologies", ONE_DEVELOPMENT, TWO_CONTEXT),
    [
      "COMPANY: SoFi Technologies",
      "COMPANY INDUSTRY: Unknown",
      "MEMO_MODE: developments-led",
      "SIGNAL QUALITY: 1 direct company event (Earnings) - limited direct evidence",
      "",
      "COMPANY DEVELOPMENT ARTICLES (1):",
      "* [Earnings] SoFi Technologies posts Q2 results",
      "",
      "SECTOR CONTEXT ARTICLES (2):",
      "* [Other] QuantumScape (QS) Updates PowerCo Program And Expands Its Battery Commercialization Efforts",
      "",
      "* [Other] QS stock retreats as QuantumScape faces cautious analyst outlook",
    ].join("\n"),
  );
});

// ---------------------------------------------------------------------------
// 4. The copy, checked through the guards that already ship, not through a
//    second copy of their rules living in this file.
// ---------------------------------------------------------------------------

/**
 * THE LAST TWO ARE THE REAL FAILING NAMES, not invented ones. Scanned read-only
 * with the shipped `detectVoiceViolations` over every row in `companies`,
 * exactly two names carry a reader-directed action word as a whole word, and
 * these are both of them. "Buy Buy Baby" is measured in the thin band, so it is
 * the case this mode ships into; "Best Buy" is not in the band today and can
 * enter it on a quiet week with no code change.
 *
 * The first draft of this list held three benign names, so every assertion in
 * this section passed while the only case that could break was untested.
 */
const RENDERED: Array<{ name: string; line: string }> = [
  { name: "Allbirds", line: thinCoverageBriefLine("Allbirds", 1) },
  { name: "QuantumScape", line: thinCoverageBriefLine("QuantumScape", 2) },
  { name: "Bank of America", line: thinCoverageBriefLine("Bank of America", 2) },
  { name: "Buy Buy Baby", line: thinCoverageBriefLine("Buy Buy Baby", 1) },
  { name: "Best Buy", line: thinCoverageBriefLine("Best Buy", 2) },
];
const RENDERED_LINES = RENDERED.map((r) => r.line);

test("[MUTATION M4 M5] the thin line passes the shipped brief-voice guard, including the two names that carry a banned token", () => {
  for (const line of RENDERED_LINES) {
    assert.equal(
      hasVoiceViolation(line),
      false,
      `${line} :: ${JSON.stringify(detectVoiceViolations(line))}`,
    );
  }
});

test("the thin line passes the shipped compliance-language filter with nothing stripped", () => {
  /* The company name is handed to the filter here and is NOT self-detected,
     which is the honest shape of that guard: `filterComplianceLanguage` is a
     general descriptive-only sanitizer with one production caller
     (/api/financials-commentary) and no brief path, so it exempts only what a
     caller proves is a proper noun. The brief path's guard is
     brief-voice-guard, and that one resolves the name itself. */
  for (const { name, line } of RENDERED) {
    const res = filterComplianceLanguage(line, [name]);
    assert.equal(res.blocked, false, `${line} :: ${JSON.stringify(res.findings)}`);
    assert.equal(res.clean.trim(), line);
  }
});

test("the thin line names one permitted outcome state and no other outcome vocabulary", () => {
  // The four permitted states, and the words a reader could mistake for a fifth.
  const permitted = ["supported", "challenged", "developing", "awaiting"];
  const impostors =
    /\b(confirmed|refuted|pending|unresolved|inconclusive|verified|failed|invalidated|correct|incorrect)\b/i;
  for (const line of RENDERED_LINES) {
    const found = permitted.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(line));
    assert.deepEqual(found, ["awaiting"], line);
    assert.equal(impostors.test(line), false, line);
  }
});

test("the thin line carries no em-dash and no en-dash", () => {
  for (const line of [...RENDERED_LINES, noCoverageBriefLine("Allbirds")]) {
    assert.equal(/[–—]/.test(line), false, line);
  }
});

test("the thin line says pool and not corpus, so it cannot claim the company is uncovered", () => {
  // Same discipline as noCoverageBriefLine: the Articles tab reads a wider
  // window with no relevance gate, so a sentence about "no news" would be a
  // claim this function is not in a position to make.
  for (const line of RENDERED_LINES) {
    assert.match(line, /current pool/);
    assert.equal(/\bno (news|coverage|articles exist)\b/i.test(line), false, line);
  }
});

// ---------------------------------------------------------------------------
// 5. The prompt
// ---------------------------------------------------------------------------

const PROMPT = buildMemoSystemPrompt("Allbirds");

test('[MUTATION M2] the system prompt carries a MEMO_MODE "thin" block that points at the supplied line', () => {
  assert.ok(PROMPT.includes('─── MEMO_MODE = "thin"'), "thin block header");
  assert.ok(PROMPT.includes("The input carries a line labelled THIN BRIEF LINE."));
  assert.ok(PROMPT.includes("Reproduce that line EXACTLY, character for character, and output nothing else."));
  assert.ok(PROMPT.includes("THIN BRIEF LINE (thin mode only)"), "declared in the INPUTS line");
});

test("[MUTATION M2] the thin block bans the exact hedge that reached a reader in production", () => {
  const block = sliceBlock(PROMPT, '─── MEMO_MODE = "thin"', "─── UNIVERSAL OPENING RULES");
  assert.match(block, /never a sentence saying a probability is unassessable, unknowable, indeterminate, or cannot be assessed without further information/);
  assert.match(block, /No section label/);
  assert.match(block, /No bullets/);
});

test("[MUTATION M6] the context-led band above the thin threshold also bans the hedge", () => {
  // Roughly one resolved head in eight sits at zero developments with three or
  // more context articles (445 of 3,664 on the re-derived census; the first
  // draft of this comment said 195, off a census taken during the article-pool
  // blackout #816 repaired). They keep the five sections, so the ban has to
  // reach them too or the fix covers only part of the population it measured.
  const block = sliceBlock(PROMPT, '─── MEMO_MODE = "context-led"', '─── UNIVERSAL RULES');
  assert.match(block, /THE PROBABILITY SENTENCE IS NOT AN INVITATION TO SAY THE PROBABILITY CANNOT BE GIVEN/);
  assert.match(block, /Never write that a probability is unassessable, unknowable, indeterminate, unknown, not assessable, or cannot be assessed without further information/);
  assert.match(block, /name the specific filing, print, or announcement that would establish one/);
});

test("REGRESSION: nothing this change added reaches the developments-led section rules", () => {
  // The claim is not "these bytes never change"; a hash pin would go red on an
  // unrelated copy edit and tell the next reader nothing. The claim is that the
  // rich path's own instructions did not learn about this mode, so the three
  // strings this change introduced are asserted absent from that slice. The
  // byte-level proof is the corpus replay in the PR body, which diffs
  // buildMemoContent over every resolved head name.
  const block = sliceBlock(PROMPT, '─── MEMO_MODE = "developments-led"', '─── MEMO_MODE = "context-led"');
  assert.equal(block.includes("THIN BRIEF LINE"), false);
  assert.equal(block.includes("THE PROBABILITY SENTENCE IS NOT AN INVITATION"), false);
  assert.equal(/\bthin\b/i.test(block), false);
  // And it still says what it always said.
  assert.match(block, /\*\*What Just Changed\*\*/);
  assert.match(block, /State probability in the third sentence\. Stop\./);
});

test("[MUTATION M7] the voice override's section-list exception covers thin as well as no-coverage", () => {
  // Without this the override's "use exactly these section labels" would order
  // the model to emit five headers in a mode whose whole point is one line.
  assert.match(BRIEF_VOICE_OVERRIDE, /TWO EXCEPTIONS/);
  assert.match(BRIEF_VOICE_OVERRIDE, /when MEMO_MODE is "thin" the single-line rule in the thin block wins/);
});

// ---------------------------------------------------------------------------
// 6. The page. Asserted on the CALL, not on the identifier, because an import
//    line satisfies a test that only looks for the name.
// ---------------------------------------------------------------------------

const PAGE_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/app/company/[id]/page.tsx"),
  "utf8",
);

test("[MUTATION M3] the company page decides the brief slot with classifyBriefPool", () => {
  assert.match(
    PAGE_SRC,
    /const poolShape = classifyBriefPool\(developmentArticles\.length, contextArticles\.length\);/,
  );
  assert.match(PAGE_SRC, /poolShape === "no-coverage" \?/);
  assert.match(PAGE_SRC, /poolShape === "thin" \?/);
});

test("[MUTATION M3] the company page renders the thin line with the same count the predicate was asked about", () => {
  assert.match(
    PAGE_SRC,
    /thinCoverageBriefLine\(companyDetail\.display, contextArticles\.length\)/,
  );
});

test("[MUTATION M3] no path in the page re-tests the pool lengths instead of asking the predicate", () => {
  // THE FAILURE THIS CHANGE EXISTS TO AVOID REPEATING. Three things in this file
  // read the same fact: the brief slot (which mounts BriefTab or does not),
  // buildMemoContent by way of `poolShape` (which sets the MEMO_MODE the prompt
  // branches on), and the company.page.viewed analytics event. All three used to
  // hold their own copy of `developmentArticles.length === 0 &&
  // contextArticles.length === 0`, so a threshold added to one of them and not
  // the others is a page that renders one line while the modal behind it still
  // asks the model for five sections.
  //
  // WHAT IT CATCHES AND WHAT IT DOES NOT, measured by pasting each candidate
  // into the page and running this file. A LITERAL paste of the comparison goes
  // red. A copy with the operands REORDERED passes clean, and so does a copy
  // that swaps the threshold in. So this is a guard against the exact text
  // coming back, not a proof that no fourth reader can exist. The stronger
  // guarantee is structural and is above: one exported predicate that the other
  // readers import.
  assert.equal(
    /developmentArticles\.length === 0 && contextArticles\.length === 0/.test(PAGE_SRC),
    false,
    "every path must ask classifyBriefPool rather than re-testing the lengths",
  );
  // And the analytics event asks it too, without changing what it records.
  assert.match(
    PAGE_SRC,
    /classifyBriefPool\(developmentArticles\.length, contextArticles\.length\) ===\s*\n?\s*"no-coverage"/,
  );
});

test("[MUTATION M3] the thin branch does not mount BriefTab, so its CTA cannot fire five sections at two headlines", () => {
  const slot = sliceBlock(PAGE_SRC, "briefSlot={", "articles: <ArticlesTab");
  const thinBranch = sliceBlock(slot, 'poolShape === "thin" ? (', ") : (");
  assert.equal(thinBranch.includes("<BriefTab"), false);
  assert.match(thinBranch, /data-testid="brief-thin-coverage"/);
});

// ---------------------------------------------------------------------------
// 7. THE COPY DEFECT: a company whose own name carries a banned token.
//
//    The page renders thinCoverageBriefLine directly and never calls a guard,
//    so this was never broken there. The MODAL is the broken path:
//    CompanyMemoModalListener -> MemoModal -> /api/memo, which runs
//    enforceBriefVoice over the model's reproduction of the line. For
//    "Buy Buy Baby" that read as a call to action, burned a re-ask the model
//    could not satisfy, and then dropped the sentence carrying the count and
//    the name. These tests exercise the shipped guard end to end rather than a
//    restatement of its rules.
// ---------------------------------------------------------------------------

/** Fails the test if the guard reaches for the model at all. */
const NEVER_REGENERATE = async (): Promise<string | null> => {
  throw new Error("enforceBriefVoice asked for a re-ask on a clean line");
};

test("[MUTATION M4 M5] the thin line for a banned-token company survives enforceBriefVoice whole, with no model call", async () => {
  // Not "does not throw": the exact string back, because the failure mode is a
  // SURVIVING PREFIX. Before the fix this returned "Awaiting a direct event."
  // and dropped the sentence a reader needs.
  const line = thinCoverageBriefLine("Buy Buy Baby", 1);
  const res = await enforceBriefVoice(line, { regenerate: NEVER_REGENERATE });
  assert.equal(res.memo, line);
  assert.equal(res.reasked, false, "a clean line must not cost a Gemini call");
  assert.equal(res.stillViolating, false);
  assert.deepEqual(res.violationsBefore.recommendations, []);
});

test("[MUTATION M4 M5] the two-article thin line for Best Buy survives enforceBriefVoice whole", async () => {
  const line = thinCoverageBriefLine("Best Buy", 2);
  const res = await enforceBriefVoice(line, { regenerate: NEVER_REGENERATE });
  assert.equal(res.memo, line);
  assert.equal(res.reasked, false);
});

test("[MUTATION M4 M5] the #816 no-coverage line survives it too, for both names", async () => {
  // Same frame class, same defect, and it predates this change. A fix that
  // covered only the new line would leave the older one broken on the same rows.
  for (const name of ["Best Buy", "Buy Buy Baby"]) {
    const line = noCoverageBriefLine(name);
    const res = await enforceBriefVoice(line, { regenerate: NEVER_REGENERATE });
    assert.equal(res.memo, line, name);
    assert.equal(res.reasked, false, name);
  }
});

test("[MUTATION M5] briefLineCompanyNames reads back exactly the name the builder was given", () => {
  // THE SEAM, not a restatement. The recogniser is generated by calling these
  // builders with a sentinel, so this asserts the generation against the
  // builders themselves. A copy edit to either line that the generator cannot
  // follow fails here rather than silently un-exempting a company.
  const names = ["Best Buy", "Buy Buy Baby", "Allbirds", "Bank of America", "AT&T Inc", "E*TRADE"];
  for (const name of names) {
    assert.deepEqual(briefLineCompanyNames(noCoverageBriefLine(name)), [name], `no-coverage ${name}`);
    for (let n = 1; n <= THIN_CONTEXT_MAX; n++) {
      assert.deepEqual(
        briefLineCompanyNames(thinCoverageBriefLine(name, n)),
        [name],
        `thin ${name} ctx=${n}`,
      );
    }
  }
});

test("[MUTATION M4 M5] a name ending in a period is captured without it, and the masking outcome is unchanged", async () => {
  /* THE KNOWN BOUNDARY, asserted rather than left for the next reader to find.
     "Visa Inc." is a real surface form in this corpus. The frame's own period
     claims the name's last character, so the captured span is one shorter. That
     is deliberate: see nameSlotPattern. What matters is the outcome, and the
     outcome does not move, because every token of the name is still inside the
     span. The company here is constructed to carry a banned token AND a
     terminal period at once; no such row exists today. */
  const name = "Buy Buy Baby Inc.";

  // Only the no-coverage frame ends in the period, so only it truncates.
  const noCov = noCoverageBriefLine(name);
  assert.deepEqual(briefLineCompanyNames(noCov), ["Buy Buy Baby Inc"]);
  assert.equal(hasVoiceViolation(noCov), false);
  assert.equal((await enforceBriefVoice(noCov, { regenerate: NEVER_REGENERATE })).memo, noCov);

  // The thin frame's tail is " and no company-specific ...", so it captures the
  // period and the two frames genuinely differ here.
  const thin = thinCoverageBriefLine(name, 1);
  assert.deepEqual(briefLineCompanyNames(thin), [name]);
  assert.equal((await enforceBriefVoice(thin, { regenerate: NEVER_REGENERATE })).memo, thin);
});

test("briefLineCompanyNames exempts nothing it has not proved", () => {
  // Anything that is not one of our two frames yields no span, so the guard
  // behaves exactly as it did before this change on every other input.
  for (const s of [
    "",
    "Buy the dip here.",
    "Best Buy reported a comparable-sales decline.",
    "The current pool has 1 article tagged to Buy Buy Baby.",
    "Awaiting a direct event.",
  ]) {
    assert.deepEqual(briefLineCompanyNames(s), [], JSON.stringify(s));
  }
});

test("the exemption does not weaken the guard: reader-directed advice still trips it", () => {
  const advice: Array<[string, string]> = [
    ["Buy the dip here.", "buy"],
    ["Sell into strength.", "sell"],
    ["We recommend increasing exposure into the print.", "recommend"],
    ["Reduce exposure if the stock declines 15%.", "reduce exposure"],
    ["Move to overweight.", "overweight"],
  ];
  for (const [text, term] of advice) {
    assert.ok(
      detectVoiceViolations(text).recommendations.includes(term),
      `${text} should still flag ${term}`,
    );
  }
});

test("the exemption is scoped to the one-line frames, so a five-section brief naming Best Buy is NOT exempt", async () => {
  /* STATED AS A LIMIT, not sold as covered. A rich brief about Best Buy still
     trips on the company's own name, because nothing in that text proves the
     token is a proper noun. Fixing that case needs the company name threaded
     into enforceBriefVoice from /api/memo/route.ts, which is propose-only, so
     the route diff is proposed in the PR and not applied here. */
  const rich =
    "**Analyst Brief**\nBest Buy reported a comparable-sales decline.\n\n**What To Watch**\nWe recommend increasing exposure.";
  assert.ok(detectVoiceViolations(rich).recommendations.includes("buy"));
  const res = await enforceBriefVoice(rich, { regenerate: async () => null });
  assert.equal(res.memo.includes("comparable-sales decline"), false);
});

// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sliceBlock(src: string, from: string, to: string): string {
  const i = src.indexOf(from);
  assert.ok(i >= 0, `missing block start: ${from}`);
  const j = src.indexOf(to, i + from.length);
  assert.ok(j >= 0, `missing block end: ${to}`);
  return src.slice(i, j);
}
