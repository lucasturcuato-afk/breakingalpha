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
 * TRENDS NOW POINTS AT THE MOBILE SCREEN. `/trends` was a deliberate
 * stand-in: the mobile Trends screen was a separate unit, open as PR #657,
 * and `/trends-mobile` did not exist on `main`, so aiming this row at it
 * would have aimed it at a 404. A working desk page beat a dead link.
 *
 * That precondition is spent. `/trends-mobile` is on `main`, builds, and
 * renders live clusters with `FIXTURE_ALLOWED` closed in production. The
 * stand-in outlived its reason, which is the only interesting part: a TODO
 * whose condition has been met reads exactly like one whose condition has
 * not, so it was not the TODO that caught this, it was walking the route at
 * 390. `/trends` carries no breakpoint prefixes at all and does not pass
 * `mobileFullBleed`; a phone reader landed on the desk mood bar, a search
 * placeholder over three lines and clipped filter rows.
 *
 * The desk page keeps its route and is not edited by this. It is fenced under
 * CLAUDE.md, and `trends-mobile/page.tsx` already links back to it above the
 * breakpoint, so the desk surface stays reachable from a wide viewport.
 *
 * All three destinations are already in the Ask pole's `owns` list in
 * `mobile-tab-bar.tsx`, so the pole lights on arrival at any of them:
 * `isActive` reads `owns` alone and never `href`.
 */
export const ASK_DIRECTORY: AskDirectoryRoute[] = [
  { id: "deals", label: "Deal Flow", href: "/deal-flow" },
  { id: "trends", label: "Trends", href: "/trends-mobile" },
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

/**
 * The two the browse chip row offers, and the ONE definition of that pair.
 *
 * It moved here out of the fixture, and the move is the point. The pair was
 * only reachable through `ASK_BROWSE_FIXTURE.prompts`, so with the gate closed
 * production drew no chips at all: the screen's own intro promised a question
 * would be answered and the screen carried nothing that asked one. These are
 * the live chat's own strings, invented nothing, so they have no business
 * behind a fixture gate. The fixture reads this constant rather than repeating
 * it, so there is still exactly one pair.
 *
 * Which two: the design draws the first and the third at prototype line 2523.
 */
export const CHIP_PROMPTS: readonly [string, string] = [
  SUGGESTED_PROMPTS[0],
  SUGGESTED_PROMPTS[2],
];

/**
 * The answer screen's pair, and it matters MORE than the browse pair does.
 *
 * Same defect, same fix, one screen later. It was reachable only through
 * `ASK_ANSWER_FIXTURE.prompts`, so with the gate closed the answer screen drew
 * no chips at all. Measured on a production build, `/ask?q=test` renders "This
 * surface does not answer yet" with ZERO visible links to `/intelligence` on
 * it. That is the worst screen in the product to strand someone on: they typed
 * a question, they were told nothing answers it, and the surface that does
 * answer it was one tap away with no control pointing at it.
 *
 * A different two from the browse pair because the design draws a different
 * two at prototype line 2569. Both pairs are the live chat's own strings.
 */
export const ANSWER_CHIP_PROMPTS: readonly [string, string] = [
  SUGGESTED_PROMPTS[1],
  SUGGESTED_PROMPTS[2],
];

export type DirectoryDetail = {
  /** Reads as a count, never as a rate. */
  counter: string;
  summary: string;
};

/**
 * `AskLookup` IS GONE, and its absence is the point of this note.
 *
 * It described a row in a RECENT LOOKUPS list. Nothing in the product records
 * that a company was viewed, so that list could never be filled for anyone,
 * and the shipped screen said as much in a notice under an empty group. The
 * block is a company DIRECTORY now, its rows come from a real read in
 * `src/lib/ask-companies-data.ts`, and its shape lives beside that read rather
 * than in this file: nothing about it is a fixture, so it does not belong in
 * the fixture's shape.
 */
export type AskBrowseData = {
  detail: Record<DirectoryId, DirectoryDetail>;
  /** Which two of the three prompts the chip row offers. */
  prompts: readonly [string, string];
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
  prompts: readonly [string, string];
  answeredAt: string;
};

/** The route's own copy for a knowledge base with nothing in it yet. */
export const EMPTY_KB_ANSWER =
  "I don't have enough research data yet. The knowledge base will populate after the next pipeline run.";
