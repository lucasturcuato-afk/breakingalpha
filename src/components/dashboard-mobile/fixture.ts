import type { SentimentTone } from "@/components/ui/sentiment-pill";
import type { Resolution } from "@/lib/desk-record";

/**
 * Sample content for the mobile Dashboard, taken verbatim from the rendered
 * prototype.
 *
 * The screen has no data source in this unit. The desktop page's four loaders
 * stay exactly where they are and are not rewired here, so the mobile screen
 * is built against a typed fixture and the shape below IS the contract a real
 * loader has to satisfy. Swapping the fixture for a fetch should not touch a
 * single component.
 *
 * Compliance note on sample content: the rule against an aggregate figure
 * reaches sample data too. Nothing here is a rate. Every record figure is a
 * count, the desk's denominator is a count, and the two market deltas are one
 * instrument's own move over one session.
 */

/**
 * Whether sample content may render at all.
 *
 * One constant, imported by every consumer, because the first version of this
 * gate lived inline in `dashboard-screen.tsx` and the splash rendered beside
 * that screen rather than inside it. The screen was gated and the splash was
 * not, so production still opened on a full-screen overlay asserting a story
 * count and a check against the reader's own record. A gate that has to be
 * remembered at each call site is a gate that gets missed at one of them.
 *
 * Fails closed: production renders no sample content anywhere.
 */
export const DASH_FIXTURES_ALLOWED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

export type DashStage = "ready" | "loading" | "error" | "empty" | "stale";

/** One cell of the market band. */
export interface DashMarketCell {
  /** Stable key. The desktop page calls the same thing a market card symbol. */
  symbol: string;
  label: string;
  value: string;
  /** The line under the value. Absent when there is no quote to state. */
  delta?: string;
  /** Reads the figure, not the direction: a falling VIX is calm. */
  tone?: "up" | "down";
  /** The signals cell states a pair rather than one delta. */
  counts?: { up: string; down: string };
  /**
   * The absence markers `stat-card.tsx` already draws: "no quote" when the
   * change could not be read, "last close" when the session is shut.
   */
  note?: string;
}

export interface DashStory {
  id: string;
  ordinal: number;
  /** The 3px gold rule down the leading edge of an unread row. */
  unread: boolean;
  /**
   * Whether the story survives the For You lens.
   *
   * The lens has to filter something. A control that restyles itself and
   * leaves the identical list is a filter that silently did nothing, which on
   * a product whose claim is that nothing is curated away is worse than no
   * control at all. The real screen will read this off the personalization
   * scorer; the fixture states it per story so the lens is honest today.
   */
  forYou: boolean;
  tone: SentimentTone;
  toneLabel: string;
  sector: string;
  source: string;
  age: string;
  headline: string;
}

export interface DashRecordCounts {
  byResolution: Record<Resolution, number>;
  /**
   * Kept apart from the four buckets on purpose. `awaiting` is not a
   * resolution: it is the count of calls whose window has not closed, and
   * `your-record.ts` carries it outside `byResolution` for exactly that
   * reason.
   */
  awaiting: number;
}

export interface DashboardData {
  date: string;
  clock: string;
  eyebrow: string;
  greeting: string;
  /**
   * The line under the greeting. Nullable by design, matching
   * `greeting.tsx`'s contract: a hardcoded fallback reads as a measured
   * observation and is not one, so when nothing true can be said about the
   * tape the greeting says nothing about it.
   */
  context: string | null;
  market: DashMarketCell[];
  /** The overnight resolution, or null when nothing of the reader's moved. */
  waiting: { eyebrow: string; line: string } | null;
  brief: { title: string; sub: string };
  yourRecord: DashRecordCounts & { intro: string };
  deskRecord: { intro: string; byResolution: Record<Resolution, number>; total: number };
  stories: DashStory[];
  /** Published only when the reader is looking at yesterday's briefing. */
  staleNotice: string;
  disclaimer: string;
}

export const DASH_FIXTURE: DashboardData = {
  date: "Thursday, August 6",
  clock: "6:52",
  eyebrow: "Your morning briefing",
  greeting: "Good morning, Maya.",
  context: "142 high-signal stories worth your attention.",
  market: [
    { symbol: "SPY", label: "S&P 500", value: "6,412.08", delta: "−0.17%", tone: "down" },
    { symbol: "VIX", label: "VIX", value: "15.80", delta: "−4.20%", tone: "up" },
    { symbol: "TNX", label: "10Y YIELD", value: "4.62%", delta: "−1.0 bps", tone: "up" },
    { symbol: "SIGNALS", label: "SIGNALS TODAY", value: "142", counts: { up: "58↑", down: "41↓" } },
  ],
  waiting: {
    eyebrow: "RESOLVED OVERNIGHT",
    line: "One of your calls was checked.",
  },
  brief: {
    title: "This morning's brief",
    sub: "Five calls, none decided yet",
  },
  yourRecord: {
    intro: "Your own calls, graded on their own outcomes. Nothing here borrows the desk's result.",
    byResolution: { supported: 17, challenged: 12, noCleanRead: 5, notGraded: 0 },
    awaiting: 7,
  },
  deskRecord: {
    intro: "Signalera's own graded calls. A separate record from yours, on the same four states.",
    byResolution: { supported: 19, challenged: 11, noCleanRead: 6, notGraded: 5 },
    total: 41,
  },
  stories: [
    {
      id: "s1",
      ordinal: 1,
      unread: true,
      forYou: true,
      tone: "BULLISH",
      toneLabel: "Bullish",
      sector: "Utilities",
      source: "Reuters",
      age: "2h",
      headline: "Nuclear Supply Deals Reshape How Utilities Contract Power",
    },
    {
      id: "s2",
      ordinal: 2,
      unread: false,
      forYou: false,
      tone: "MIXED",
      toneLabel: "Mixed",
      sector: "Medtech",
      source: "Bloomberg",
      age: "5h",
      headline: "Sponsors Weigh a Joint Take-Private of Hologic at $18.3B",
    },
  ],
  staleNotice:
    "Today's briefing has not published yet. This is yesterday's, generated 6:45 AM ET. Your review dates are unaffected.",
  disclaimer:
    "Informational only and never investment advice. No rate, ratio or score is computed over either record.",
};

/**
 * Day one. A reader who has never made a call, on a desk that has not graded
 * anything yet. The prototype draws populated counts in every state, so this
 * is the state the design does not depict, built from copy that already
 * exists in `your-record.ts` and `desk-record.ts` rather than invented here.
 */
export const DASH_FIXTURE_EMPTY: DashboardData = {
  ...DASH_FIXTURE,
  context: null,
  waiting: null,
  brief: { title: "This morning's brief", sub: "Five calls, none decided yet" },
  yourRecord: {
    intro: DASH_FIXTURE.yourRecord.intro,
    byResolution: { supported: 0, challenged: 0, noCleanRead: 0, notGraded: 0 },
    awaiting: 0,
  },
  deskRecord: {
    intro: DASH_FIXTURE.deskRecord.intro,
    byResolution: { supported: 0, challenged: 0, noCleanRead: 0, notGraded: 0 },
    total: 0,
  },
  stories: [],
};
