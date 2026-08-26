import { SUGGESTED_PROMPTS, type AskAnswerData, type AskBrowseData } from "./ask-data";

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
 * Neither Ask screen has a data source yet. `briefs/batch-4.md` open questions
 * 4, 5 and 6 record why: nothing in the repo stores which companies a user
 * looked up, the three directory counters have no defined query or interval,
 * and the record citation on the answer screen needs the intelligence route to
 * retrieve the user's own claims, which it does not do today. Until those land,
 * both screens render from here.
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
  lookups: [
    {
      ticker: "CEG",
      name: "Constellation Energy",
      href: "/company/constellation-energy",
      entries: "2 of your entries",
    },
    {
      ticker: "NVO",
      name: "Novo Nordisk",
      href: "/company/novo-nordisk",
      entries: "1 of your entries",
    },
    { ticker: "XYL", name: "Xylem", href: "/company/xylem", entries: "no entries yet" },
  ],
  prompts: [SUGGESTED_PROMPTS[0], SUGGESTED_PROMPTS[2]],
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
  prompts: [SUGGESTED_PROMPTS[1], SUGGESTED_PROMPTS[2]],
  answeredAt: "Answered from intelligence gathered before 12:45.",
};
