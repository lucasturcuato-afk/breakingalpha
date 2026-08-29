/**
 * watch-data - the read path behind the mobile Watch screen.
 *
 * Watch was built against `src/components/watch/fixture.ts`, whose header says
 * the shape below IS the contract a real loader has to satisfy. This is that
 * loader. It runs on the server, it makes no model call, and it writes nothing.
 *
 * WHAT IT READS
 *   watchlist           the reader's own tracked identifiers. RLS-scoped, and
 *                       additionally filtered on user_id the way
 *                       `/api/watchlist` does, so the two cannot disagree.
 *   watchlist_articles  the pipeline's pre-fetched articles, per identifier,
 *                       for ticker and company entries.
 *   articles            for SECTOR entries only, through the taxonomy filter
 *                       `buildArticleOrFilter` already builds for the desk.
 *                       `backend/watchlist_sync.py:718` selects the watchlist
 *                       with `.neq("type", "sector")`, so `watchlist_articles`
 *                       has never held a single row for an industry and never
 *                       will. Reading industries out of it would report every
 *                       industry on every desk as quiet, forever, which is a
 *                       false claim about the reader's own list.
 *   follows             the reader's own follows, matched against the ingested
 *                       corpus by `matchFollow` in `src/lib/radar-following.ts`.
 *                       Called DIRECTLY rather than through
 *                       `/api/radar/following-feed`: that route is a thin
 *                       wrapper over the same function and a server component
 *                       calling its own HTTP route is a round trip for nothing.
 *
 * WHAT IT REFUSES TO DO
 *
 * TRACKED VIEWS ARE NOT LOADED, and the tier is not drawn. `TrackedView` needs
 * `{ id, note, headline, date }`. `note` and `date` are readable off
 * `user_claims`; `headline` is not. That table (`sql/0012_radar_user_claims.sql`)
 * carries no article foreign key, no article_id and no title column, so the
 * headline a note was written against is not recoverable from it. A note
 * rendered without the story it answers has lost the thing that made it a
 * tracked view, and synthesising a plausible headline beside a real note is the
 * invented-brief defect (see #670) with a different table under it. Two ways out,
 * both needing an owner and a migration this unit will not write:
 *   1. add an article FK to `user_claims` and backfill what can be recovered;
 *   2. amend the `TrackedView` contract to drop `headline`, and redraw the tier
 *      around note plus date alone.
 * Until one of those lands the tier is absent rather than approximated.
 *
 * NO THEME CLUSTERING on following. Cluster labels come from
 * `POST /api/radar/clusters` and are `null` until a lazy model pass names them
 * (`src/lib/radar-clusters.ts:31-32`), so the headings would be either absent or
 * invented. The rows ship under one unlabelled rule instead.
 *
 * NO PRICE. `move` and `moveDirection` are not set here. They come from
 * `/api/watchlist-quotes`, which reaches Finnhub and Yahoo, and blocking the
 * server render on a third party for the value the design itself calls "the
 * quiet part" trades the whole screen's time to first byte for a decoration.
 * The screen reads them client-side and draws nothing until they land.
 *
 * NO STALENESS. `stage` is never `"stale"` from here. Nothing records when the
 * watchlist sync last ran for a given desk, and "today's pass has not run yet"
 * is a claim about the pipeline this file cannot check.
 *
 * THE TRI-STATE, WHICH IS THE POINT
 *
 * Tier 2 is 1+N reads: one for the rows, one per entry for the articles. A read
 * that has not finished is not a name with no news, and a read that faulted is
 * not a quiet name. Server-side that discipline is cheaper than it was on the
 * client (`src/app/radar/watchlist/page.tsx:160-177`, whose machinery is
 * page-local and unexported): every read is awaited before anything is
 * returned, so there is no "pending" in the shape at all and a mid-flight zero
 * cannot reach a render. What survives is the other half, and it is the half
 * that matters: a per-entry FAULT becomes a per-entry OMISSION with its reason
 * named on screen, never a quiet name.
 *
 * Nothing here is averaged, divided or scored. Every figure it produces is a
 * count of real rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildArticleOrFilter } from "./watchlist-utils";
import { matchFollow, type FollowRow } from "./radar-following";
import { formatPTClock, formatPTDateShort } from "./format-pt";
import { WATCH_RECENCY_DAYS } from "@/components/watch/recency";
import type { WatchStage } from "@/components/watch/watch-screen";
import type {
  FollowCluster,
  FollowRow as WatchFollowRow,
  WatchData,
  WatchlistItem,
  WatchlistKind,
} from "@/components/watch/fixture";

export interface WatchLoad {
  /** Null only when there is no reader to scope the tiers to. */
  data: WatchData | null;
  stage: WatchStage;
}

/** Rows read per identifier. Matches `/api/watchlist-articles`. */
const ARTICLE_LIMIT = 30;
/** The follow window. Matches `/api/radar/following-feed`'s default. */
const FOLLOW_WINDOW_DAYS = 7;
/** Quiet names drawn before the "+N more" tail. The design draws four. */
const QUIET_SHOWN = 4;

const DAY_MS = 86_400_000;

/* ── row shapes ─────────────────────────────────────────────────────── */

interface WatchlistRow {
  id: string;
  identifier: string;
  /** "ticker" | "company" | "sector". Text in the column, not an enum. */
  type: string;
  display_name: string | null;
  created_at: string | null;
}

interface ReadArticle {
  title: string | null;
  source: string | null;
  published_at: string | null;
  relevance_score: number | null;
  fetched_at?: string | null;
}

/**
 * A per-entry article read, in the only two states a settled read can be in.
 * There is no "pending" member on purpose: everything is awaited before this
 * module gives anything back, so a caller can never observe one.
 */
type EntryRead = { status: "ready"; articles: ReadArticle[] } | { status: "failed" };

/* ── helpers ────────────────────────────────────────────────────────── */

function sinceIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/**
 * The lens key for a stored `type`. This predicate ALREADY EXISTS at
 * `src/components/radar/WatchlistGallery.tsx:161-168` and this is the same one,
 * not a second one: ticker is public, company is private, everything else is an
 * industry. Written as a mapping rather than a nested ternary so a fourth
 * `type` value is a visible fallthrough rather than a silent industry.
 */
function kindFor(type: string): WatchlistKind {
  if (type === "ticker") return "public";
  if (type === "company") return "private";
  return "industry";
}

/** Ticker monogram, matching `monogram()` in the gallery. */
function monogram(identifier: string): string {
  return identifier.slice(0, 4).toUpperCase();
}

function badgeFor(row: WatchlistRow, kind: WatchlistKind): string {
  if (kind === "public") return monogram(row.identifier);
  if (kind === "private") return row.display_name ?? row.identifier;
  return row.identifier.toUpperCase();
}

/**
 * The window, said the way the screen says it. `RECENCY_LABEL` in
 * `watch-screen.tsx` derives the same phrase from the same constant in
 * `recency.ts`; both read the constant, neither types the word beside it.
 */
const WINDOW_WORD = WATCH_RECENCY_DAYS === 1 ? "today" : `in ${WATCH_RECENCY_DAYS} days`;

function qualifierFor(
  row: WatchlistRow,
  kind: WatchlistKind,
  recentCount: number,
): string {
  if (kind === "public") return row.display_name ?? row.identifier;
  if (kind === "private") return "Private";
  return `Industry · ${recentCount} ${WINDOW_WORD}`;
}

/** Newest first, strongest first. The gallery's `topStory` ordering. */
function topStory(articles: ReadArticle[]): ReadArticle | null {
  if (articles.length === 0) return null;
  return [...articles].sort(
    (a, b) =>
      (b.relevance_score ?? 0) - (a.relevance_score ?? 0) ||
      new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime(),
  )[0];
}

/**
 * "Reuters · 2 more today". The convention is
 * `WatchlistGallery.tsx:242`'s verbatim, so the phone and the desk read alike:
 * the count is the OTHER articles in the window, never the total.
 */
function sourceLine(story: ReadArticle, recent: ReadArticle[]): string {
  const attribution = story.source ?? "Source not recorded";
  const others = recent.length - 1;
  return others > 0 ? `${attribution} · ${others} more ${WINDOW_WORD}` : attribution;
}

function isRecent(a: ReadArticle): boolean {
  if (!a.published_at) return false;
  return Date.now() - new Date(a.published_at).getTime() <= WATCH_RECENCY_DAYS * DAY_MS;
}

/**
 * "REUTERS · JUL 29", already uppercased, as `FollowRow.meta` wants it.
 *
 * THE DATE IS PINNED TO PT, and the pinning is the point. An `Intl` formatter
 * with no `timeZone` formats in the host zone, and Node on Vercel is UTC, so a
 * story published 6:30 PM PT stamped as the NEXT day for every reader.
 * `src/lib/format-pt.ts` exists because this exact defect shipped once on the
 * brief paths, and `src/lib/ledger-data.ts:67-68`, the shape this file's header
 * says it followed, pins a zone on every formatter it has. This one now does
 * too, through `format-pt.ts` rather than beside it.
 */
function followMeta(source: string | null, publishedAt: string | null): string {
  const parts: string[] = [];
  if (source) parts.push(source.toUpperCase());
  const day = formatPTDateShort(publishedAt);
  if (day) parts.push(day.toUpperCase());
  return parts.join(" · ");
}

/**
 * "Aug 27 at 6:41 PM" off the newest `fetched_at` the reads actually saw.
 *
 * PT-pinned for the reason `followMeta` is. This line is unreachable today,
 * because the loader never gives back `stage: "stale"`, and that makes a wrong
 * wall clock worse rather than harmless: nobody is looking at it, and it goes
 * live the moment staleness ships.
 */
function lastCheckedFrom(iso: string | null): string {
  const day = formatPTDateShort(iso);
  if (!day) return "not yet";
  return `${day} at ${formatPTClock(iso)}`;
}

/* ── tier 2: the watchlist ──────────────────────────────────────────── */

/**
 * One entry's articles.
 *
 * A query error is `failed` and is never an empty list: the caller names the
 * entry as unread rather than counting it quiet. `/api/watchlist-articles`
 * answers 500 rather than `200 []` on exactly this distinction
 * (`route.ts:26-28`), and this is the server-side half of the same rule.
 *
 * An entry with nothing searchable behind it is `ready` with no articles, not
 * `failed`. That is deterministic, not a fault, and the desk says so at
 * `src/app/radar/watchlist/page.tsx:373`.
 */
async function readEntryArticles(sb: SupabaseClient, row: WatchlistRow): Promise<EntryRead> {
  const since = sinceIso(WATCH_RECENCY_DAYS);

  if (kindFor(row.type) === "industry") {
    const orFilter = buildArticleOrFilter(row.identifier, row.display_name, "sector");
    if (!orFilter) return { status: "ready", articles: [] };
    const { data, error } = await sb
      .from("articles")
      .select("title, source, published_at, relevance_score")
      .or(orFilter)
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(ARTICLE_LIMIT);
    if (error) return { status: "failed" };
    return { status: "ready", articles: (data as ReadArticle[] | null) ?? [] };
  }

  const { data, error } = await sb
    .from("watchlist_articles")
    .select("title, source, published_at, relevance_score, fetched_at")
    .eq("identifier", row.identifier)
    .order("published_at", { ascending: false })
    .limit(ARTICLE_LIMIT);
  if (error) return { status: "failed" };
  return { status: "ready", articles: (data as ReadArticle[] | null) ?? [] };
}

interface WatchlistTier {
  items: WatchlistItem[];
  quietNames: string[];
  couldNotRead: string[];
  newestFetchedAt: string | null;
}

async function loadWatchlist(
  sb: SupabaseClient,
  rows: WatchlistRow[],
): Promise<WatchlistTier> {
  /* Every read is awaited before anything below runs. That is what makes a
     mid-flight zero unreachable rather than merely unlikely. */
  const reads = await Promise.all(rows.map((row) => readEntryArticles(sb, row)));

  const items: WatchlistItem[] = [];
  const quietNames: string[] = [];
  const couldNotRead: string[] = [];
  let newestFetchedAt: string | null = null;

  rows.forEach((row, i) => {
    const read = reads[i];
    if (read.status === "failed") {
      couldNotRead.push(row.display_name ?? row.identifier);
      return;
    }

    for (const a of read.articles) {
      if (a.fetched_at && (newestFetchedAt === null || a.fetched_at > newestFetchedAt)) {
        newestFetchedAt = a.fetched_at;
      }
    }

    const recent = read.articles.filter(isRecent);
    const story = topStory(recent);
    const kind = kindFor(row.type);

    if (story === null || !story.title) {
      quietNames.push(row.display_name ?? row.identifier);
      return;
    }

    items.push({
      id: row.id,
      identifier: row.identifier,
      kind,
      badge: badgeFor(row, kind),
      qualifier: qualifierFor(row, kind, recent.length),
      headline: story.title,
      source: sourceLine(story, recent),
    });
  });

  return { items, quietNames, couldNotRead, newestFetchedAt };
}

/* ── tier 3: following ──────────────────────────────────────────────── */

interface FollowingTier {
  clusters: FollowCluster[];
  withCoverage: number;
  quiet: number;
  muted: number;
  couldNotCheck: string[];
}

function followName(f: FollowRow): string {
  return f.display_name ?? f.target;
}

async function loadFollowing(sb: SupabaseClient, follows: FollowRow[]): Promise<FollowingTier> {
  /* The `{ follow, articles, failed }` triple, built the way
     `/api/radar/following-feed/route.ts:52-54` builds it. `failed` exists so an
     errored follow is never counted quiet, and `matchFollow` throws rather than
     returning `[]` (`radar-following.ts:201-206`) precisely so this is
     possible. A muted follow is not matched at all, same as the route. */
  const settled = await Promise.all(
    follows.map(async (follow) => {
      if (follow.muted) return { follow, articles: [], failed: false };
      try {
        return {
          follow,
          articles: await matchFollow(sb, follow, FOLLOW_WINDOW_DAYS),
          failed: false,
        };
      } catch (e) {
        console.error("[watch-data] follow match failed", follow.id, e);
        return { follow, articles: [], failed: true };
      }
    }),
  );

  /* MUTED IS A THIRD STATE, split out rather than folded in.
     `src/app/radar/following/page.tsx:196-201` counts a muted follow as quiet,
     but `fixture.ts` defines quiet as "no coverage this week" and a muted
     follow was never checked, so it has no coverage answer either way. The
     desktop's conflation is not ported. */
  const withCoverage = settled.filter(
    (d) => !d.failed && !d.follow.muted && d.articles.length > 0,
  ).length;
  const quiet = settled.filter(
    (d) => !d.failed && !d.follow.muted && d.articles.length === 0,
  ).length;
  const muted = settled.filter((d) => d.follow.muted).length;
  const couldNotCheck = settled.filter((d) => d.failed).map((d) => followName(d.follow));

  /* One row per article, deduped across follows, newest first. Not capped:
     `matchFollow` already bounds each follow at eight, and a silent truncation
     is exactly what makes `/api/watchlist-feed` unable to answer this question
     honestly. */
  const seen = new Set<string>();
  const rows: WatchFollowRow[] = [];
  const flat = settled
    .filter((d) => !d.failed && !d.follow.muted)
    .flatMap((d) => d.articles)
    .sort(
      (a, b) =>
        new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime(),
    );
  for (const a of flat) {
    if (seen.has(a.id) || !a.title) continue;
    seen.add(a.id);
    rows.push({ id: a.id, headline: a.title, meta: followMeta(a.source, a.published_at) });
  }

  /* ONE cluster, deliberately unlabelled. See the header: cluster names are
     null until a model pass writes them, so a heading here would be either
     invented or blank. */
  const clusters: FollowCluster[] = rows.length > 0 ? [{ id: "follows-all", label: null, rows }] : [];

  return { clusters, withCoverage, quiet, muted, couldNotCheck };
}

/* ── the loader ─────────────────────────────────────────────────────── */

/**
 * Read every tier Watch draws, for one reader.
 *
 * `userId` is passed rather than re-derived so this file and the page cannot
 * end up scoping to two different sessions, which is the shape
 * `src/lib/ledger-data.ts` already set.
 */
export async function loadWatch(
  sb: SupabaseClient,
  userId: string | null,
): Promise<WatchLoad> {
  /* No reader, no tiers. Not an empty watchlist and not a failed query: there
     is nobody to scope the rows to. The screen says so and offers a retry. */
  if (!userId) return { data: null, stage: "error" };

  const [watchlistRes, followsRes] = await Promise.all([
    sb
      .from("watchlist")
      .select("id, identifier, type, display_name, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    sb
      .from("follows")
      .select("id, follow_type, target, display_name, matched_keywords, embedding, muted, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  const watchlistRows = (watchlistRes.data as WatchlistRow[] | null) ?? [];
  const followRows = (followsRes.data as FollowRow[] | null) ?? [];

  const [tier2, tier3] = await Promise.all([
    watchlistRes.error
      ? Promise.resolve<WatchlistTier>({
          items: [],
          quietNames: [],
          couldNotRead: [],
          newestFetchedAt: null,
        })
      : loadWatchlist(sb, watchlistRows),
    followsRes.error
      ? Promise.resolve<FollowingTier>({
          clusters: [],
          withCoverage: 0,
          quiet: 0,
          muted: 0,
          couldNotCheck: [],
        })
      : loadFollowing(sb, followRows),
  ]);

  if (watchlistRes.error) console.error("[watch-data] watchlist read", watchlistRes.error.message);
  if (followsRes.error) console.error("[watch-data] follows read", followsRes.error.message);

  return {
    stage: "ready",
    data: {
      watchlist: tier2.items,
      /* A failed ROW read is not an empty watchlist, and the screen draws a
         failure notice rather than "Nothing on your watchlist yet". The flags
         are per tier because one tier failing says nothing about the other. */
      watchlistRead: watchlistRes.error ? "failed" : "ok",
      watchlistCouldNotRead: tier2.couldNotRead,
      quietNames: tier2.quietNames,
      quietShown: QUIET_SHOWN,
      following: tier3.clusters,
      followingRead: followsRes.error ? "failed" : "ok",
      followsWithCoverage: tier3.withCoverage,
      followsQuiet: tier3.quiet,
      followsMuted: tier3.muted,
      followsCouldNotCheck: tier3.couldNotCheck,
      lastCheckedLabel: lastCheckedFrom(tier2.newestFetchedAt),
    },
  };
}
