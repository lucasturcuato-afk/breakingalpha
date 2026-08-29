/**
 * The shape Watch draws, and sample content for the paths that have no reader.
 *
 * THE SCREEN IS WIRED. `src/lib/watch-data.ts` reads the real watchlist, the
 * real articles behind it and the reader's real follows, and gives back the
 * shape below. The sample objects at the bottom are reachable only where
 * `/ledger` allows its own: a non-production build with nobody signed in, which
 * is the parity harness, the width audits and a signed-out local browse. A
 * signed-in reader always takes the loader, in every environment.
 *
 * Compliance note on sample content: the rule against an aggregate figure
 * reaches sample data too. Nothing here is a rate. Every figure is a count of
 * things. Where the screen can derive a count from the array it describes it
 * does, so the figure and the list cannot drift apart; the four that cannot be
 * derived from anything rendered - `followsWithCoverage`, `followsQuiet`,
 * `followsMuted` and `quietShown` - are fields the loader owns and each says
 * what it counts.
 */

/**
 * A view the desk is watching with no direction and no window on it.
 *
 * THE TIER IS NOT DRAWN and `WatchData` carries no `trackedViews` field. This
 * interface stays because it is the contract the tier would need, and the
 * missing half of it is the whole reason the tier is absent: `note` and `date`
 * are readable off `user_claims`, and `headline` is not. That table
 * (`sql/0012_radar_user_claims.sql`) has no article foreign key, no article_id
 * and no title column, so the story a note was written against cannot be
 * recovered from it. A note without its story has lost the thing that made it a
 * tracked view, and inventing a plausible headline beside a real note is the
 * `/ledger` invented-brief defect (see #670) by another route.
 *
 * Two ways out, both needing an owner and a migration:
 *   1. add an article foreign key to `user_claims` and backfill what can be
 *      recovered;
 *   2. amend this interface to drop `headline` and redraw the tier around note
 *      plus date alone.
 */
export interface TrackedView {
  id: string;
  /** The user's own words, in their own voice. Set in italic serif. */
  note: string;
  /** The headline the note was written against. NO SOURCE. See above. */
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

/**
 * One signed move, for one ticker.
 *
 * NOT part of `WatchData`, and not read by the server loader. Price reaches
 * Finnhub and Yahoo through `/api/watchlist-quotes`, and blocking the whole
 * screen's first byte on a third party for the value the design itself calls
 * "the quiet part" is the wrong trade. The screen reads it after mount and
 * draws nothing at all until it lands, so an absent quote is an absent row and
 * never a wrong number.
 */
export interface WatchQuote {
  /** Signed and formatted, e.g. "+1.24%". */
  move: string;
  direction: "up" | "down";
}

/** A quote per ticker, keyed by the identifier on the watchlist row. */
export type WatchQuotes = Record<string, WatchQuote>;

export interface WatchlistItem {
  /** The `watchlist` row id. */
  id: string;
  /** The stored identifier, which is also the quote key for a public name. */
  identifier: string;
  kind: WatchlistKind;
  /** Ticker monogram, private wordmark, or industry tag, by kind. */
  badge: string;
  /** "Constellation Energy" for a name, "Private", "Industry / N today". */
  qualifier: string;
  headline: string;
  /** "Reuters / 2 more today". Attribution, not a claim. */
  source: string;
  /**
   * Where the card opens, or NULL when it opens nothing.
   *
   * DECIDED BY THE LOADER, not by the card, and PROVED before it is set. A
   * public name resolves to `/company/<identifier>` only when
   * `src/lib/watch-links.ts` has established that the route's own
   * reconstruction lands on a real company; a private company and an industry
   * are always null. The card renders this value and never derives one, so a
   * destination cannot be invented in a client component that has no way to
   * check it.
   *
   * Null is not a bug and not an absence to paper over. `/company/BRK.B` is a
   * 200 that says Berkshire Hathaway is not on Signalera, and a card with no
   * link is better than a link that says that.
   */
  href: string | null;
}

export interface FollowRow {
  id: string;
  headline: string;
  /** "REUTERS / JUL 29", already uppercased. Rendered in mono. */
  meta: string;
}

export interface FollowCluster {
  id: string;
  /**
   * Uppercase theme label, or NULL for an unlabelled group.
   *
   * Null is what the loader ships. Cluster names come from
   * `POST /api/radar/clusters` and stay null until a lazy model pass writes
   * them (`src/lib/radar-clusters.ts:31-32`), so a heading here would be either
   * blank or invented. The screen omits the heading entirely rather than
   * drawing an empty one.
   */
  label: string | null;
  rows: FollowRow[];
}

/** Whether a tier's ROW read answered at all. Absence is not a third value. */
export type TierRead = "ok" | "failed";

export interface WatchData {
  watchlist: WatchlistItem[];
  /** A failed row read is not an empty watchlist, and the screen says which. */
  watchlistRead: TierRead;
  /**
   * Entries whose per-entry article read faulted, by name.
   *
   * These are omitted from `watchlist` AND from `quietNames`, and named on
   * screen with the reason. A faulted read is not a name with no news, and
   * counting one quiet would make `quietNames` a false claim about the
   * reader's own list, in prose.
   */
  watchlistCouldNotRead: string[];
  /**
   * Names on the watchlist whose read answered with nothing published inside
   * the recency window. Quiet is a real answer and a distinct state both from
   * an empty watchlist and from a read that did not answer.
   */
  quietNames: string[];
  /** Names drawn before the "+N more" tail. The prototype draws four. */
  quietShown: number;
  following: FollowCluster[];
  /** A failed follows read is not an empty follow list. */
  followingRead: TierRead;
  /**
   * Follows that produced coverage this week. Not the cluster count and not
   * the story count: several follows can land in one theme, and one follow can
   * produce several stories, so neither derivation describes the set the tail
   * copy speaks about.
   */
  followsWithCoverage: number;
  /**
   * Follows that were checked and had no coverage this week. An empty week,
   * not a failure. Muted follows are NOT counted here:
   * `radar/following/page.tsx:196-201` folds them in, and a follow that was
   * never checked has no coverage answer to report.
   */
  followsQuiet: number;
  /** Follows the reader muted. Not checked, therefore neither loud nor quiet. */
  followsMuted: number;
  /**
   * Follows whose match query errored. These are NOT quiet and must never be
   * counted as quiet: `radar/following/page.tsx` lines 191 to 205 exist to stop
   * exactly that, and the prototype's tail copy makes the false claim out loud.
   */
  followsCouldNotCheck: string[];
  /** When the tiers were last refreshed. Used by the stale notice only. */
  lastCheckedLabel: string;
}


export const WATCH_FIXTURE: WatchData = {
  watchlist: [
    {
      id: "wl-ceg",
      identifier: "CEG",
      kind: "public",
      badge: "CEG",
      qualifier: "Constellation Energy",
      headline:
        "Constellation lifts contracted volume guidance after fourth data centre agreement",
      source: "Reuters · 2 more today",
      href: "/company/CEG",
    },
    {
      id: "wl-nvda",
      identifier: "NVDA",
      kind: "public",
      badge: "NVDA",
      qualifier: "Nvidia",
      headline: "Blackwell output guidance lifted for the January quarter",
      source: "Bloomberg · 4 more today",
      href: "/company/NVDA",
    },
    {
      id: "wl-anthropic",
      identifier: "Anthropic",
      kind: "private",
      badge: "Anthropic",
      qualifier: "Private",
      headline: "Second debt package sounded for the chip financing",
      source: "Financial Times",
      href: null,
    },
    {
      id: "wl-grid",
      identifier: "Technology",
      kind: "industry",
      badge: "TECHNOLOGY",
      qualifier: "Industry · 6 today",
      headline: "Contracting accelerates across four utilities in eleven days",
      source: "Reuters · 5 more today",
      href: null,
    },
    {
      id: "wl-glp1",
      identifier: "Healthcare & Biotech",
      kind: "industry",
      badge: "HEALTHCARE & BIOTECH",
      qualifier: "Industry · 1 today",
      headline: "Three plants clear qualification as constraints ease",
      source: "Bloomberg",
      href: null,
    },
  ],
  watchlistRead: "ok",
  watchlistCouldNotRead: [],
  quietNames: ["BRK.B", "VLO", "ZION", "ETN", "PSX", "TRV", "WEC", "AEE", "LNT"],
  quietShown: 4,
  following: [
    {
      id: "follows-all",
      label: null,
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
        {
          id: "fr-hologic",
          headline: "Blackstone and TPG weigh a joint take-private of Hologic",
          meta: "BLOOMBERG · AUG 4",
        },
      ],
    },
  ],
  followingRead: "ok",
  followsWithCoverage: 3,
  followsQuiet: 3,
  followsMuted: 1,
  followsCouldNotCheck: [],
  lastCheckedLabel: "Aug 27 at 6:41 PM",
};

/* THE EVERY-TIER-EMPTY CONSTANT IS GONE, deliberately. It existed so the route
   could mount the screen over an all-zero shape while there was no loader, and
   that is precisely how three empty states about a reader shipped with no read
   behind them. `src/lib/watch-data.ts` now builds the empty shape out of real
   reads that came back with nothing, so a hand-written stand-in for it is a
   second way to draw those states, with nothing keeping the two in step. */

/**
 * Sample content is development and preview only, and the gate that decides
 * that is `mobileFixtureScreensEnabled()` in `src/lib/mobile-fixture-gate.ts`,
 * narrowed further by `user === null` the way `/ledger` narrows it. The caller
 * resolves the gate and passes the result down; nothing here reads the
 * environment.
 */
