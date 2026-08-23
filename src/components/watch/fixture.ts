/**
 * Sample content for Watch, taken verbatim from the rendered prototype.
 *
 * This screen has no data source in this unit. The three tiers read from three
 * different places today (`/api/watchlist` plus `buildArticleOrFilter` for the
 * watchlist, `src/lib/radar-following.ts` for follows, and the user's own
 * ungraded notes for tracked views), and none of those loaders is in scope
 * here. So the screen is built against a typed fixture and the shape below IS
 * the contract a real loader has to satisfy. Swapping the fixture for a fetch
 * should not touch a single component.
 *
 * Compliance note on sample content: the rule against an aggregate figure
 * reaches sample data too. Nothing here is a rate. Every figure is a count of
 * things. Where the screen can derive a count from the array it describes it
 * does, so the figure and the list cannot drift apart; the two that cannot be
 * derived from anything rendered, `followsWithCoverage` and `followsQuiet`,
 * are fields the loader owns and each says what it counts.
 */

/** A view the desk is watching with no direction and no window on it. */
export interface TrackedView {
  id: string;
  /** The user's own words, in their own voice. Set in italic serif. */
  note: string;
  /** The headline the note was written against. */
  headline: string;
  /** Date stamp only. The second half of the meta line is invariant. */
  date: string;
}

export type WatchlistKind = "public" | "private" | "industry";

/**
 * The four lens keys.
 *
 * `WatchlistGallery.tsx` names its fourth key `industries`; the prototype names
 * the same lens `ind`. One had to win. `industries` wins because it is the key
 * already shipped in production and the prototype's is an abbreviation with no
 * consumer outside its own dev strip.
 */
export type WatchLens = "all" | "public" | "private" | "industries";

export interface WatchlistItem {
  id: string;
  kind: WatchlistKind;
  /** Ticker monogram, private wordmark, or industry tag, by kind. */
  badge: string;
  /** "Constellation Energy" for a name, "Private", "Industry / N this week". */
  qualifier: string;
  /** Signed move, public names only. Price is the quiet part, never the hero. */
  move?: string;
  moveDirection?: "up" | "down";
  headline: string;
  /** "Reuters / 2 more today". Attribution, not a claim. */
  source: string;
  /** Exactly one item may be the hero: the strongest story today. */
  hero?: boolean;
}

export interface FollowRow {
  id: string;
  headline: string;
  /** "REUTERS / JUL 29", already uppercased. Rendered in mono. */
  meta: string;
}

export interface FollowCluster {
  id: string;
  /** Uppercase theme label, from the shared cluster tree. */
  label: string;
  rows: FollowRow[];
}

export interface WatchData {
  trackedViews: TrackedView[];
  watchlist: WatchlistItem[];
  /**
   * Names on the watchlist with nothing published inside the recency window.
   * Quiet is a real answer and a distinct state from an empty watchlist.
   */
  quietNames: string[];
  /** Names drawn before the "+N more" tail. The prototype draws four. */
  quietShown: number;
  following: FollowCluster[];
  /**
   * Follows that produced coverage this week. Not the cluster count and not
   * the story count: several follows can land in one theme, and one follow can
   * produce several stories, so neither derivation describes the set the tail
   * copy speaks about.
   */
  followsWithCoverage: number;
  /** Follows with no coverage this week. An empty week, not a failure. */
  followsQuiet: number;
  /**
   * Follows whose match query errored. These are NOT quiet and must never be
   * counted as quiet: `radar/following/page.tsx` lines 191 to 205 exist to stop
   * exactly that, and the prototype's tail copy makes the false claim out loud.
   */
  followsCouldNotCheck: string[];
  /** When the tiers were last refreshed. Used by the stale notice only. */
  lastCheckedLabel: string;
}

/**
 * The recency window the watchlist counts against, in days.
 *
 * `WatchlistGallery.tsx` line 155 filters at two days and says "in the last two
 * days"; the mobile design's collapse says "No news today". The copy and the
 * window have to agree, so mobile ships at one day and says today. Flagged in
 * the PR body as an unresolved product difference with the desktop surface.
 */
export const WATCH_RECENCY_DAYS: number = 1;

export const WATCH_FIXTURE: WatchData = {
  trackedViews: [
    {
      id: "tv-bx-anthropic",
      note: "A second package suggests the first was undersubscribed. Watching who takes the paper before I say anything about direction.",
      headline: "Blackstone mulls a second debt package for the Anthropic chip deal.",
      date: "JUL 30",
    },
    {
      id: "tv-ea-take-private",
      note: "Precedent for sovereign capital in interactive entertainment. Want the comp set before I form a view.",
      headline: "Electronic Arts' Saudi-backed take-private officially closes.",
      date: "JUL 24",
    },
  ],
  watchlist: [
    {
      id: "wl-ceg",
      kind: "public",
      badge: "CEG",
      qualifier: "Constellation Energy",
      move: "+1.24%",
      moveDirection: "up",
      headline:
        "Constellation lifts contracted volume guidance after fourth data centre agreement",
      source: "Reuters · 2 more today",
      hero: true,
    },
    {
      id: "wl-nvda",
      kind: "public",
      badge: "NVDA",
      qualifier: "Nvidia",
      move: "+3.43%",
      moveDirection: "up",
      headline: "Blackwell output guidance lifted for the January quarter",
      source: "Bloomberg · 4 more",
    },
    {
      id: "wl-anthropic",
      kind: "private",
      badge: "Anthropic",
      qualifier: "Private",
      headline: "Second debt package sounded for the chip financing",
      source: "Financial Times",
    },
    {
      id: "wl-grid",
      kind: "industry",
      badge: "GRID CAPACITY",
      qualifier: "Industry · 6 this week",
      headline: "Contracting accelerates across four utilities in eleven days",
      source: "Signalera cluster · critical",
    },
    {
      id: "wl-glp1",
      kind: "industry",
      badge: "GLP-1 SUPPLY",
      qualifier: "Industry · 1 this week",
      headline: "Three plants clear qualification as constraints ease",
      source: "Signalera cluster · high",
    },
  ],
  quietNames: [
    "BRK.B",
    "VLO",
    "ZION",
    "ETN",
    "PSX",
    "TRV",
    "WEC",
    "AEE",
    "LNT",
  ],
  quietShown: 4,
  following: [
    {
      id: "fc-datacentre-power",
      label: "DATACENTRE POWER",
      rows: [
        {
          id: "fr-vistra",
          headline:
            "Vistra commits Comanche Peak capacity under a fifteen-year contract",
          meta: "REUTERS · JUL 29",
        },
        {
          id: "fr-talen",
          headline: "Talen discloses a co-location amendment at Susquehanna",
          meta: "WSJ · JUL 24",
        },
      ],
    },
    {
      id: "fc-sponsor-activity",
      label: "SPONSOR ACTIVITY",
      rows: [
        {
          id: "fr-hologic",
          headline: "Blackstone and TPG weigh a joint take-private of Hologic",
          meta: "BLOOMBERG · AUG 4 · UNDER LOI",
        },
      ],
    },
  ],
  followsWithCoverage: 3,
  followsQuiet: 3,
  followsCouldNotCheck: [],
  lastCheckedLabel: "yesterday at 6:41 PM",
};

/** Every tier empty. What a first-run desk sees, and what production renders. */
export const WATCH_EMPTY: WatchData = {
  trackedViews: [],
  watchlist: [],
  quietNames: [],
  quietShown: 4,
  following: [],
  followsWithCoverage: 0,
  followsQuiet: 0,
  followsCouldNotCheck: [],
  lastCheckedLabel: "not yet",
};

/**
 * Sample content is development and preview only, and the gate fails closed.
 *
 * The tiers draw a desk's own tracked views, watchlist and follows. Shipping
 * invented ones to a signed-in user in production would put words in their
 * mouth, so production gets the empty data and the empty states until a real
 * loader lands.
 */
export const WATCH_FIXTURE_ALLOWED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
