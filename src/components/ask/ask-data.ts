/**
 * Ask's SHAPE, its directory and the two pieces of real product copy it uses.
 *
 * Split out of `./fixture` so both screens and anything downstream of them can
 * reach this without pulling the invented answer into the browser bundle. A
 * `"use client"` module that value-imports from `./fixture` downloads every
 * string in it: the gate stops the render, not the download. Neither Ask
 * screen carries `"use client"` today, which is the only reason that had not
 * already happened, and that is too thin a thing to rely on.
 *
 * Nothing in this file is invented. The directory rows are real destinations
 * that exist on this branch, `SUGGESTED_PROMPTS` is the live chat's own copy
 * and `EMPTY_KB_ANSWER` is the intelligence route's own copy. That is the
 * property that makes it safe on both sides of the boundary, and it is the
 * property to check before adding anything to it.
 */

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
 * `/trends` is a deliberate stand-in, and it is the one row here that is
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

/** The route's own copy for a knowledge base with nothing in it yet. */
export const EMPTY_KB_ANSWER =
  "I don't have enough research data yet. The knowledge base will populate after the next pipeline run.";
