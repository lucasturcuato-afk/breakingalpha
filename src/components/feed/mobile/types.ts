/**
 * The shape the mobile Live Feed screen renders.
 *
 * This is a view model, not a row. `src/app/live-feed/page.tsx` already owns
 * the query, the dedupe, the time bucketing and the signed-out gate; this file
 * states what that page has to hand over and nothing more. Keeping the screen
 * behind a plain data contract is what lets the fixture stand in for the
 * loader during parity without a single branch inside a component.
 */

export type FeedSentiment = "bullish" | "bearish" | "neutral";

/** The four lenses the design draws, in the order it draws them. */
export type FeedLens = "yours" | "all" | "alerts" | "saved";

/**
 * The one badge a row may carry beside its sentiment word.
 *
 * The design draws three and never two at once, so this is a single value
 * rather than a list. Precedence, highest first: alert, saved, unfollowed.
 */
export type FeedRowBadge = "alert" | "saved" | "unfollowed";

export interface FeedDuplicateSource {
  id: string;
  title: string;
  /** Rendered as drawn. The screen uppercases it for the mono provenance line. */
  source: string;
  /** Already elapsed, never a clock. */
  timeAgo: string;
  url?: string;
}

export interface FeedStory {
  id: string;
  headline: string;
  /** Plain text. HTML is stripped before it reaches here. */
  summary?: string;
  source: string;
  timeAgo: string;
  sentiment: FeedSentiment;
  badge: FeedRowBadge | null;
  /**
   * The entity slot under the headline. Production carries a company name,
   * the design draws a ticker; either renders the same way.
   */
  entity?: { label: string; href?: string };
  /**
   * The cluster slot the design draws on its second row. Nothing in production
   * populates it, and the screen that would open it is unit 20, which is
   * unruled. See the comment at its render site.
   */
  cluster?: string;
  url?: string;
  duplicates: FeedDuplicateSource[];
  /**
   * Arrived on the last poll. The screen counts these per bucket to draw the
   * new marker, so the number always describes the rows under it: the marker
   * is not a wire-wide total pinned to whichever bucket happens to be first.
   */
  isNew: boolean;
}

export interface FeedBucket {
  /** LAST HOUR / TODAY / YESTERDAY / EARLIER, as the page produces them. */
  id: string;
  /** Sentence case, as the design draws it. */
  label: string;
  stories: FeedStory[];
}

export type FeedStage = "ready" | "loading" | "error" | "empty" | "stale";

export interface FeedData {
  /** Formatted, no seconds. Null before the first poll lands. */
  updatedAt: string | null;
  /** The sentence under the masthead. Derived per lens by the page. */
  standfirst: string;
  buckets: FeedBucket[];
  counts: { yours: number; alerts: number; saved: number };
  /** The signed-out reader saw a truncated feed. */
  gated: boolean;
  empty: { title: string; body: string } | null;
}
