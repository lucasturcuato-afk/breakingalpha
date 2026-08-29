import {
  ANSWER_CHIP_PROMPTS,
  CHIP_PROMPTS,
  type AskAnswerData,
  type AskBrowseData,
} from "./ask-data";

/**
 * Ask fixtures. SERVER ONLY.
 *
 * NOTHING IN THIS FILE MAY BE IMPORTED BY A CLIENT COMPONENT. The gate in
 * `./fixture-gate` is a runtime constant, so it stops the render and not the
 * download: every string below would reach `.next/static` the moment a
 * `"use client"` module imports this path, whether or not it can ever paint.
 * An answer screen showing a made-up citation to a real user is the exact
 * failure the gate prevents, and a downloadable copy of that citation is the
 * failure the boundary prevents.
 *
 * `src/app/ask/page.tsx` is a server component, resolves the gate there and
 * passes both fixtures down as required, nullable props. The shape, the
 * directory and the two pieces of real product copy live in `./ask-data`,
 * which is invented nothing and safe to import anywhere.
 *
 * WHAT LEFT THIS FILE. The three invented lookup rows are gone, and so is the
 * question they could not answer. `briefs/batch-4.md` open question 4 records
 * it: nothing in the repo stores which companies a user looked up. That block
 * is a company directory now, read live in `src/lib/ask-companies-data.ts`, so
 * it needs no fixture in any environment and has none.
 *
 * WHAT IS STILL INVENTED HERE. The three browse counters and their summaries
 * (open question 5: no defined query, no defined interval) and the answer
 * screen's whole turn including the citation (open question 6: the
 * intelligence route does not retrieve the reader's own claims). Both still
 * render from here, behind the gate.
 */

export const ASK_BROWSE_FIXTURE: AskBrowseData = {
  detail: {
    deals: {
      counter: "4 new",
      summary:
        "Every deal, not only the ones you follow. Largest since yesterday: Hologic, $18.3B, under LOI.",
    },
    trends: {
      counter: "3 moved",
      summary:
        "Grid capacity, GLP-1 supply and private credit spreads all shifted this week.",
    },
    feed: {
      counter: "142 today",
      summary: "Filtered to your 28 followed names by default.",
    },
  },
  prompts: CHIP_PROMPTS,
  countedAt: "Counted at 06:52 against yesterday's close.",
};

export const ASK_ANSWER_FIXTURE: AskAnswerData = {
  question: "What are the strongest theses this week?",
  blocks: [
    {
      kind: "para",
      text: "Two theses carry the most supporting evidence this week, and both are second-order reads on the same datacentre buildout, one through power and one through memory.",
    },
    { kind: "head", text: "Fixed-price nuclear supply" },
    {
      kind: "para",
      text: "Nine filings and 41 articles in eleven days describe long-dated agreements between merchant generators and data centre operators. Four issuers, one structure, and the coverage has read it as structural rather than opportunistic in six of the last seven pieces.",
    },
    { kind: "head", text: "Memory-led semicap orders" },
    {
      kind: "para",
      text: "Order book commentary has pointed to HBM rather than logic in four of six reviews since July, and the March quarter guides have moved with it.",
    },
  ],
  record: {
    eyebrow: "YOU ALREADY HAVE A CALL HERE · CALL-0409",
    claim: "Semicap orders reaccelerate on HBM capacity adds into the March quarter.",
    /* `supported`, not a fifth word for it. The outcome vocabulary is exactly
       supported / challenged / developing / awaiting (`OUTCOME_STATES`), and
       this is the one card on the screen whose whole purpose is citing the
       reader's own call, so it is the last place a synonym belongs.

       The design says "evidence strengthening" at prototype line 2563 and
       "Strengthening" at line 2037, and the second is drawn in
       `--c-greenink`, which is the ink token `supported` already carries. So
       the prototype is describing the supported state in two paraphrases of
       its own, and neither is reproduced. */
    meta: "Entered Jul 22, supported, settles Sep 12.",
  },
  prompts: ANSWER_CHIP_PROMPTS,
  answeredAt: "Answered from intelligence gathered before 12:45.",
};
