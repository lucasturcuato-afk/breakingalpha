/**
 * Ask fixtures.
 *
 * Neither Ask screen has a data source yet. `briefs/batch-4.md` open questions
 * 4, 5 and 6 record why: nothing in the repo stores which companies a user
 * looked up, the three directory counters have no defined query or interval,
 * and the record citation on the answer screen needs the intelligence route to
 * retrieve the user's own claims, which it does not do today. Until those land,
 * both screens render from here.
 *
 * Everything below the routes is invented. An answer screen showing a made-up
 * citation to a real user is the exact failure the gate prevents.
 */

/**
 * Fixture rendering is allowed in local development and on preview deploys, and
 * nowhere else. Fails closed: an unset NODE_ENV is not production, and any
 * production build that is not a preview gets nothing.
 */
export const ASK_FIXTURE_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

export type DirectoryId = "deals" | "trends" | "feed";

export type AskDirectoryRoute = {
  id: DirectoryId;
  label: string;
  href: string;
};

/**
 * Not fixture data. These three destinations exist in production and the row
 * renders with or without the gate; only the counter and the summary are
 * invented.
 *
 * `/trends` is a deliberate placeholder, and it is the one row here that is
 * knowingly aimed at a desk page rather than a mobile one. The mobile Trends
 * screen is a separate unit, is open as PR #657, and lands at
 * `/trends-mobile`. That route does not exist on `main`, so pointing at it
 * from here before it merges aims the row at a 404, and merge order between
 * the two is not something this file can depend on. A working desk page beats
 * a dead link; a dead link is not a smaller defect for being aspirational.
 *
 * Both routes are already in the Ask pole's `owns` list
 * (`mobile-tab-bar.tsx:128` and `:135`), so the pole lights either way and the
 * swap is this one string and nothing else.
 *
 * TODO(when the mobile Trends screen merges): change this href to
 * `/trends-mobile`. There is nothing else to change.
 */
export const ASK_DIRECTORY: AskDirectoryRoute[] = [
  { id: "deals", label: "Deal Flow", href: "/deal-flow" },
  { id: "trends", label: "Trends", href: "/trends" },
  { id: "feed", label: "Live Feed", href: "/live-feed" },
];

/**
 * The three strings the live chat already offers, copied from
 * `src/app/intelligence/IntelligenceChat.tsx` SUGGESTED_PROMPTS. Real product
 * copy, so it is not gated.
 */
export const SUGGESTED_PROMPTS = [
  "What are the strongest theses this week?",
  "Summarize recent M&A activity",
  "Which sectors show the most momentum?",
] as const;

export type DirectoryDetail = {
  /** Reads as a count, never as a rate. */
  counter: string;
  summary: string;
};

export type AskLookup = {
  ticker: string;
  name: string;
  href: string;
  /** Prose, not a figure, because zero reads as "no entries yet". */
  entries: string;
};

export type AskBrowseData = {
  detail: Record<DirectoryId, DirectoryDetail>;
  lookups: AskLookup[];
  /** Which two of the three prompts the chip row offers. */
  prompts: [string, string];
  /** Formatted, never a clock. Drives the stale notice only. */
  countedAt: string;
};

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

export type AnswerBlock = { kind: "para" | "head"; text: string };

/**
 * The citation. The design cites the reader's own ledger and nothing else, and
 * it sits at the end of the prose where the design draws it. Article and thesis
 * citations are deliberately absent: the intelligence route already emits a
 * `sources` array that nothing renders, and putting it above this block would
 * reorder the one citation the screen exists to make.
 */
export type AnswerRecordCitation = {
  eyebrow: string;
  claim: string;
  meta: string;
};

export type AskAnswerData = {
  question: string;
  blocks: AnswerBlock[];
  record: AnswerRecordCitation | null;
  prompts: [string, string];
  answeredAt: string;
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

/** The route's own copy for a knowledge base with nothing in it yet. */
export const EMPTY_KB_ANSWER =
  "I don't have enough research data yet. The knowledge base will populate after the next pipeline run.";
