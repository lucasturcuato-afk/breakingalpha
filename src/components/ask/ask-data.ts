/**
 * Ask's SHAPE, its destination table and the product copy it uses.
 *
 * NOTHING IN THIS FILE IS INVENTED, and that is the property to check before
 * adding anything to it. The destination rows are real routes that exist on
 * this branch, `SUGGESTED_PROMPTS` is the live chat's own copy, and
 * `ASSISTANT_HREF` is where that chat lives.
 *
 * WHAT LEFT THIS FILE. `AskBrowseData`, `AskAnswerData`, `AnswerBlock`,
 * `AnswerRecordCitation`, `DirectoryDetail`, `ANSWER_CHIP_PROMPTS` and
 * `EMPTY_KB_ANSWER` are gone, along with `./fixture` and `./fixture-gate`.
 * Every one of them existed to serve two things that no longer exist: an answer
 * screen that answered nothing, and three destination counters with no source.
 * The answer screen is deleted and the three counters are real reads in
 * `src/lib/ask-counters.ts`, so a wired block's states are now reached by
 * reproducing its conditions rather than by a `?state=` parameter, which is
 * what a wired block is for.
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
 * The two the prompt row offers, and the ONE definition of that pair.
 *
 * It moved here out of the fixture, and the move is the point. The pair was
 * only reachable through `ASK_BROWSE_FIXTURE.prompts`, so with the gate closed
 * production drew no chips at all: the screen's own intro promised a question
 * would be answered and the screen carried nothing that asked one. These are
 * the live chat's own strings, invented nothing, so they have no business
 * behind a fixture gate, and there is no fixture gate on this screen any more.
 *
 * Which two: the design draws the first and the third at prototype line 2523,
 * and the Direction C artboards draw the same pair.
 */
export const CHIP_PROMPTS: readonly [string, string] = [
  SUGGESTED_PROMPTS[0],
  SUGGESTED_PROMPTS[2],
];

/**
 * Where a QUESTION goes, from the jump row, from the prompt chips and from the
 * `?q=` notice. One definition, because all three mean the same thing.
 *
 * `/intelligence` and not `/ask?q=`. The answer screen that `?q=` used to draw
 * is deleted, and pointing anything at that URL again is what Ruling 20
 * forbids: a `next/link` to `/ask?q=` is a route the RSC prefetcher walks with
 * no interaction at all. `/intelligence` is the surface that actually answers,
 * and it renders `SUGGESTED_PROMPTS` as buttons on its own empty state
 * (`IntelligenceChat.tsx:212`), so a reader who taps "Which sectors show the
 * most momentum?" here arrives on a screen offering that exact prompt. The
 * words survive the tap as a control rather than as a query string, which is
 * why no `?q=` is needed to carry them.
 *
 * It is NOT `ASK_POLE_HREF`. That constant is the Ask pole's own destination
 * and lives in `mobile-tab-bar.tsx`, which is a `"use client"` module; this is
 * the assistant's destination, a different rule that must not follow the pole
 * if the pole moves again.
 */
export const ASSISTANT_HREF = "/intelligence";
