import type { SentimentTone } from "@/components/ui/sentiment-pill";
import type { Resolution } from "@/lib/desk-record";
import {
  DASH_BRIEF_TITLE,
  DASH_DESK_RECORD_INTRO,
  DASH_DISCLAIMER,
  DASH_WAITING_EYEBROW,
  DASH_YOUR_RECORD_INTRO,
} from "./copy";

/**
 * The mobile Dashboard's data contract, and sample content shaped to it.
 *
 * `DashboardData` is what the screen paints and the only thing it paints. The
 * real loader lives in `from-dashboard.ts`, which maps `/dashboard`'s existing
 * page-level reads plus the reader's own record into this shape; the desktop
 * loaders are not rewired and the desktop layout is untouched.
 *
 * EVERY FIELD THAT CAN BE ABSENT IS NULLABLE, and that is the point of the
 * type. A field the loader could not source is null, and the screen draws
 * nothing for it. There is no branch anywhere below the loader that can invent
 * a sentence about the reader, because there is no non-null value to invent
 * one from.
 *
 * The sample content is a development and preview affordance for parity
 * fingerprinting. It is reached only through a dynamic import behind
 * `DASH_FIXTURES_ALLOWED` and an explicit `?stage=` in the URL, so production
 * never downloads it and never renders it.
 *
 * Compliance note on sample content: the rule against an aggregate figure
 * reaches sample data too. Nothing here is a rate. Every record figure is a
 * count, the desk's denominator is a count, and the two market deltas are one
 * instrument's own move over one session.
 */

export type DashStage = "ready" | "loading" | "error" | "empty" | "stale";

/** One cell of the market band. */
export interface DashMarketCell {
  /** Stable key. The desktop page calls the same thing a market card symbol. */
  symbol: string;
  label: string;
  value: string;
  /** The line under the value. Absent when there is no quote to state. */
  delta?: string;
  /**
   * The colour of the delta, and it reads the DIRECTION OF THE MOVE, not
   * whether the move is good news. The real loader takes it straight from
   * `formatChange().isPositive` and inverts nothing, so a falling VIX renders
   * red here exactly as it does on `stat-card.tsx`. An earlier comment here
   * said the opposite; the code was right and the comment was wrong.
   */
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
   * control at all. The real loader reads this off the reader's own watchlist
   * and sectors, the same two inputs the desk's For You tab scores on.
   */
  forYou: boolean;
  tone: SentimentTone;
  toneLabel: string;
  /** Null when the article carries no sector. The chip is then not drawn. */
  sector: string | null;
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
   * The reader's initials, for the profile control in the screen head. Null
   * when no name is known, and the control then draws an empty disc rather
   * than someone else's letters.
   */
  initials: string | null;
  /**
   * The line under the greeting. Nullable by design, matching
   * `greeting.tsx`'s contract: a hardcoded fallback reads as a measured
   * observation and is not one, so when nothing true can be said about the
   * tape the greeting says nothing about it.
   */
  context: string | null;
  /**
   * One cell per instrument the reader actually has a quote for. A symbol the
   * feed never answered on is omitted rather than drawn as "no quote", which
   * would claim the feed answered and had nothing.
   */
  market: DashMarketCell[];
  /** The overnight resolution, or null when nothing of the reader's moved. */
  waiting: { eyebrow: string; line: string } | null;
  /** `sub` is null until a real brief headline has been read. */
  brief: { title: string; sub: string | null };
  /** Null while the reader's own record has not been read, or the read failed. */
  yourRecord: (DashRecordCounts & { intro: string }) | null;
  /** Null while the desk's record has not been read, or the read failed. */
  deskRecord: { intro: string; byResolution: Record<Resolution, number>; total: number } | null;
  /**
   * The Top Stories read, in three states, because three things can be true
   * of it and each one is drawn differently.
   *
   *   an array   the read ANSWERED. An empty one draws the empty state, which
   *              says the overnight read has not published, and only a read
   *              that came back empty can support that sentence.
   *   null       the read HAS NOT ANSWERED. No section at all, rule and lens
   *              and tail link included.
   *   "failed"   the read ANSWERED WITH AN ERROR. The section says so, and
   *              only that section does.
   *
   * The third state used to be a whole-screen stage. A failed Top Stories read
   * set `stage="error"` on the screen, which discarded the market band, the
   * brief and both records even when all four had answered. A reader whose
   * story read failed lost their own record, which they can have, over a
   * section they cannot. Same rule as the null path, applied to failure: the
   * section that broke says so and the rest of the morning stands.
   */
  stories: DashStory[] | null | "failed";
  /** Published only when the reader is looking at yesterday's briefing. */
  staleNotice: string | null;
  disclaimer: string;
}

/**
 * The opening overlay's sample copy.
 *
 * It lives here, with the rest of the invented content, because both of its
 * lines are invented: a story count nothing read and a check against a record
 * nobody looked at. Kept out of `dashboard-route.tsx` so the only way to reach
 * it is the same dynamic import behind the same gate.
 */
export const DASH_SPLASH = {
  date: "THURSDAY, AUGUST 6",
  headline: "Your briefing is ready.",
  detail: "142 stories read overnight. One of your calls was checked.",
};

export const DASH_FIXTURE: DashboardData = {
  date: "Thursday, August 6",
  clock: "6:52",
  eyebrow: "Your morning briefing",
  greeting: "Good morning, Maya.",
  initials: "MR",
  context: "142 high-signal stories worth your attention.",
  /* The prototype colours the VIX and yield rows green on a negative move,
     and these two rows reproduce it so parity fingerprints the same thing on
     both sides. THE REAL LOADER DOES NOT DO THIS. It takes `tone` from
     `formatChange().isPositive` and inverts nothing, so a falling VIX renders
     red on the live screen, matching `stat-card.tsx`. Sample content only. */
  market: [
    { symbol: "SPY", label: "S&P 500", value: "6,412.08", delta: "−0.17%", tone: "down" },
    { symbol: "VIX", label: "VIX", value: "15.80", delta: "−4.20%", tone: "up" },
    { symbol: "TNX", label: "10Y YIELD", value: "4.62%", delta: "−1.0 bps", tone: "up" },
    { symbol: "SIGNALS", label: "SIGNALS TODAY", value: "142", counts: { up: "58↑", down: "41↓" } },
  ],
  waiting: {
    eyebrow: DASH_WAITING_EYEBROW,
    line: "One of your calls was checked.",
  },
  brief: {
    title: DASH_BRIEF_TITLE,
    sub: "Five calls, none decided yet",
  },
  yourRecord: {
    intro: DASH_YOUR_RECORD_INTRO,
    byResolution: { supported: 17, challenged: 12, noCleanRead: 5, notGraded: 0 },
    awaiting: 7,
  },
  deskRecord: {
    intro: DASH_DESK_RECORD_INTRO,
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
  disclaimer: DASH_DISCLAIMER,
};

/**
 * Day one. A reader who has never made a call, on a desk that has not graded
 * anything yet. The prototype draws populated counts in every state, so this
 * is the state the design does not depict, built from copy that already
 * exists in `your-record.ts` and `desk-record.ts` rather than invented here.
 *
 * Written out in full rather than spread over DASH_FIXTURE. A spread kept the
 * populated market band and a brief line reading "Five calls, none decided
 * yet", which is a specific claim about a morning with nothing behind it.
 */
export const DASH_FIXTURE_EMPTY: DashboardData = {
  date: DASH_FIXTURE.date,
  clock: DASH_FIXTURE.clock,
  eyebrow: DASH_FIXTURE.eyebrow,
  greeting: DASH_FIXTURE.greeting,
  initials: DASH_FIXTURE.initials,
  context: null,
  market: [],
  waiting: null,
  brief: { title: DASH_BRIEF_TITLE, sub: null },
  yourRecord: {
    intro: DASH_YOUR_RECORD_INTRO,
    byResolution: { supported: 0, challenged: 0, noCleanRead: 0, notGraded: 0 },
    awaiting: 0,
  },
  deskRecord: {
    intro: DASH_DESK_RECORD_INTRO,
    byResolution: { supported: 0, challenged: 0, noCleanRead: 0, notGraded: 0 },
    total: 0,
  },
  stories: [],
  staleNotice: null,
  disclaimer: DASH_DISCLAIMER,
};
