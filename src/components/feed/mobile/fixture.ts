import type { FeedData, FeedStory } from "./types";

/**
 * The design's own Live Feed content, transcribed from the rendered prototype.
 *
 * This is NOT what the screen renders. `/live-feed` has a live query behind it
 * and the mobile screen draws that query, the same rows the desk draws. The
 * fixture exists for one reason: scoped parity keys an element on its tag, its
 * text and its ordinal, so the design and the build have to be showing the
 * same strings before a font size or a colour can be compared at all. Point
 * the screen at real articles and every element reports as unmatched, which is
 * a clean number that proves nothing.
 *
 * It is therefore reachable only from a development or preview build, behind
 * `?fixture=1`, and the gate fails closed. `/live-feed` is public signed out,
 * so an ungated fixture would show invented coverage to anyone on the
 * internet. See FIXTURE_ALLOWED in feed-mobile-screen.tsx.
 *
 * The lens is the prototype's default, `yours`: rows A, B, C and D drawn,
 * row E hidden, both time rules shown, the empty block closed. Those are the
 * values the prototype's own stylesheet sets at lines 23 and 24.
 */

const ROW_A: FeedStory = {
  id: "fx-a",
  headline:
    "Constellation lifts contracted volume guidance after fourth data centre agreement",
  summary:
    "Management framed the agreement as structural rather than opportunistic, citing a pipeline of similar negotiations across the fleet.",
  source: "Reuters",
  timeAgo: "12m ago",
  sentiment: "bullish",
  badge: "saved",
  entity: { label: "CEG", href: "/company/constellation-energy" },
  url: "https://www.reuters.com",
  isNew: true,
  duplicates: [
    {
      id: "fx-a1",
      title: "Constellation raises contracted volume outlook on Illinois deal",
      source: "Bloomberg",
      timeAgo: "18m ago",
      url: "https://www.bloomberg.com",
    },
    {
      id: "fx-a2",
      title: "Nuclear operator signs twenty-year hyperscaler supply pact",
      source: "Financial Times",
      timeAgo: "24m ago",
      url: "https://www.ft.com",
    },
  ],
};

const ROW_B: FeedStory = {
  id: "fx-b",
  headline: "PJM sets late-August window for capacity auction results",
  summary:
    "The timetable removes one uncertainty from a market that has been pricing a range of clearing outcomes since June.",
  source: "WSJ",
  timeAgo: "41m ago",
  sentiment: "neutral",
  badge: null,
  cluster: "Grid capacity",
  url: "https://www.wsj.com",
  isNew: true,
  duplicates: [],
};

const ROW_C: FeedStory = {
  id: "fx-c",
  headline:
    "Vista walks from Smartsheet process as debt package fails to syndicate",
  summary:
    "The second sponsor to exit. Lenders cited leverage against a decelerating subscription base.",
  source: "FT",
  timeAgo: "4h ago",
  sentiment: "bearish",
  badge: "alert",
  entity: { label: "SMAR", href: "/company/smartsheet" },
  url: "https://www.ft.com",
  isNew: false,
  duplicates: [],
};

const ROW_D: FeedStory = {
  id: "fx-d",
  headline:
    "Applied Materials guides semicap orders higher on HBM capacity adds",
  summary:
    "Order book commentary pointed to memory rather than logic as the driver into the March quarter.",
  source: "Bloomberg",
  timeAgo: "6h ago",
  sentiment: "bullish",
  badge: "saved",
  entity: { label: "AMAT" },
  url: "https://www.bloomberg.com",
  isNew: false,
  duplicates: [],
};

export const FEED_FIXTURE: FeedData = {
  updatedAt: "12:41",
  standfirst: "142 articles today, filtered to the 28 things you follow.",
  buckets: [
    { id: "LAST HOUR", label: "Last hour", stories: [ROW_A, ROW_B] },
    { id: "TODAY", label: "Today", stories: [ROW_C, ROW_D] },
  ],
  counts: { yours: 142, alerts: 6, saved: 9 },
  gated: false,
  empty: null,
};
