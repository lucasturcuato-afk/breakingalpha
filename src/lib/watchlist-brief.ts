/**
 * Per-user watchlist-brief section.
 *
 * Assembles up to four single-line bullets, one per watchlist company with
 * material news in the last 72h, for the top of the morning/evening brief.
 * Pure assembly off pre-computed article fields: NO Gemini call, no model cost
 * in the per-user path. The cost delta of this feature over the shared brief is
 * one DB read per user plus in-memory filter/dedup/cap.
 *
 * Parameters are locked by docs/recon/watchlist-brief-data-recon.md:
 *  - Match: parse the ticker from articles.source ("Google News (ZTS)" -> ZTS)
 *    and match it against the user's watchlist tickers. companies[] and
 *    primary_company are NOT used to match (they are names; matching them adds
 *    co-mention false positives). Tickers are normalized on both sides.
 *  - Floor: relevance_score >= 8. Recency: ingested within 72h.
 *  - Candidate set then cap: top ~24 matched by
 *    (relevance_score desc, ingested_at desc, published_at desc, id asc),
 *    collapseSameEvent, THEN take 4 so the cap stays full after collapsing.
 *  - Why-tag: articles.relevance_reason (always populated).
 *  - Watchlist source: TABLE-PRIMARY, PROFILE-FALLBACK. If the user's watchlist
 *    table (type=ticker) is non-empty, use it and ignore watchlist_tickers; only
 *    if the table is empty, fall back to user_profiles.watchlist_tickers.
 *
 * RLS-agnostic: works with either an authed (cookie) client scoped to the user,
 * or a service-role client (email/cron). On any internal error every function
 * fails soft (returns a safe empty result) rather than throwing, so a brief is
 * never blocked on this section.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  collapseSameEvent,
  TOP_STORIES_COLUMNS,
  TOP_STORIES_CANDIDATE_LIMIT,
  TOP_STORIES_LIMIT,
  TOP_STORIES_PRIMARY_WINDOW_HOURS,
  type TopStoryRow,
} from "@/lib/top-stories";

export const WATCHLIST_BRIEF_FLOOR = 8;

export type WatchlistSectionState = "populated" | "quiet" | "empty";

export interface WatchlistBullet {
  /** Display ticker (the parsed source-ticker, uppercased). */
  ticker: string;
  /** One-line hook: the article headline (outlet suffix trimmed). */
  headline: string;
  /** Short why-tag: the article's relevance_reason signal line. */
  whyTag: string;
  /** Source article id, for click-through / dedup downstream. */
  articleId: string;
  /** Source permalink (articles.url). May be null; render plain text if so. */
  url: string | null;
}

export interface WatchlistBriefSection {
  state: WatchlistSectionState;
  bullets: WatchlistBullet[];
}

/** An article pool row: the Top Stories column set plus the why-tag field. */
export type WatchlistPoolRow = TopStoryRow & { relevance_reason: string | null };

const POOL_COLUMNS = `${TOP_STORIES_COLUMNS}, relevance_reason`;

// Known foreign-exchange / listing suffixes we strip so "ULVR.L" (watchlist)
// and a "ULVR.L" or "ULVR" source-ticker normalize to the same handle. US
// share-class dots (BRK.B, BRK.A) are intentionally NOT in this set, so they
// survive normalization and only match their exact selves.
const EXCHANGE_SUFFIXES = new Set([
  "L", "TO", "V", "AX", "HK", "SS", "SZ", "PA", "DE", "SW", "ST", "MI", "MC",
  "AS", "BR", "LS", "HE", "OL", "CO", "VI", "IR", "NS", "BO", "T", "KS", "TW",
  "SI", "NZ", "F", "SA", "MX", "JK", "BK", "KL",
]);

/**
 * Normalize a ticker for comparison: uppercase, strip whitespace, and drop a
 * single trailing known-exchange suffix after a dot. Applied symmetrically to
 * both the watchlist side and the parsed source-ticker side, so it can only
 * help a match (one side carrying a suffix the other lacks), never break one.
 */
export function normalizeTicker(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (!t) return null;
  const dot = t.lastIndexOf(".");
  if (dot > 0) {
    const suffix = t.slice(dot + 1);
    if (EXCHANGE_SUFFIXES.has(suffix)) t = t.slice(0, dot);
  }
  return t.length > 0 ? t : null;
}

/** Parse the ticker embedded in a Google News source label, else null. */
export function parseSourceTicker(source: string | null | undefined): string | null {
  if (!source) return null;
  const m = source.match(/Google News \(([^)]+)\)/);
  return m ? m[1] : null;
}

/** Article headline with the trailing " - Outlet" suffix removed. */
function cleanHeadline(title: string | null): string {
  return (title ?? "").replace(/\s+-\s+[^-]+$/, "").trim();
}

const hoursAgoIso = (h: number) =>
  new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

/**
 * Resolve a user's watchlist tickers (normalized, deduped), table-primary with
 * profile fallback. Returns [] on any error or empty watchlist.
 */
export async function resolveUserWatchlist(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  if (!userId) return [];

  // Primary: the live, UI-edited watchlist table (type=ticker rows).
  try {
    const { data, error } = await supabase
      .from("watchlist")
      .select("identifier")
      .eq("user_id", userId)
      .eq("type", "ticker");
    if (!error && data && data.length > 0) {
      const norm = dedupeNormalized(
        data.map((r) => (r as { identifier: string | null }).identifier),
      );
      if (norm.length > 0) return norm;
    }
  } catch (e) {
    console.warn("[watchlist-brief] watchlist table read failed:", e);
    // fall through to profile fallback
  }

  // Fallback: the onboarding snapshot on user_profiles.
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("watchlist_tickers")
      .eq("id", userId)
      .maybeSingle();
    if (!error && data) {
      const tickers = (data as { watchlist_tickers: string[] | null })
        .watchlist_tickers;
      return dedupeNormalized(tickers ?? []);
    }
  } catch (e) {
    console.warn("[watchlist-brief] user_profiles fallback read failed:", e);
  }

  return [];
}

function dedupeNormalized(raws: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const r of raws) {
    const n = normalizeTicker(r);
    if (n) seen.add(n);
  }
  return [...seen];
}

/**
 * Fetch the full 72h, score>=8 article pool that has a parseable source-ticker.
 * Fetched ONCE per email send and filtered per recipient in memory. Paginated
 * to defeat the 1000-row PostgREST cap. Returns [] on error.
 */
export async function fetchWatchlistArticlePool(
  supabase: SupabaseClient,
): Promise<WatchlistPoolRow[]> {
  const since = hoursAgoIso(TOP_STORIES_PRIMARY_WINDOW_HOURS);
  const rows: WatchlistPoolRow[] = [];
  const page = 1000;
  const MAX_ROWS = 8000; // safety backstop
  let start = 0;
  try {
    while (start < MAX_ROWS) {
      const { data, error } = await supabase
        .from("articles")
        .select(POOL_COLUMNS)
        .gte("ingested_at", since)
        .gte("relevance_score", WATCHLIST_BRIEF_FLOOR)
        .ilike("source", "%Google News (%")
        .order("id", { ascending: true })
        .range(start, start + page - 1);
      if (error) {
        console.warn("[watchlist-brief] pool fetch error:", error.message);
        break;
      }
      if (!data || data.length === 0) break;
      rows.push(...(data as unknown as WatchlistPoolRow[]));
      if (data.length < page) break;
      start += page;
    }
  } catch (e) {
    console.warn("[watchlist-brief] pool fetch threw:", e);
  }
  return rows;
}

/**
 * Fetch only the matched candidate articles for a single user's tickers. Used
 * by the per-user in-app route so a page load never pulls the whole pool. The
 * source ilike is a coarse prefilter; bulletsFromPool re-confirms the exact
 * normalized source-ticker match in memory. Returns [] on error or no tickers.
 */
export async function fetchMatchedArticles(
  supabase: SupabaseClient,
  tickers: string[],
): Promise<WatchlistPoolRow[]> {
  if (!tickers || tickers.length === 0) return [];
  const since = hoursAgoIso(TOP_STORIES_PRIMARY_WINDOW_HOURS);
  // Coarse OR of source ilike on the normalized core; exact match confirmed
  // later in memory. Tickers are alphanumeric (+ surviving class dot), no
  // commas, so the PostgREST or() value list is safe.
  const orExpr = tickers
    .map((t) => `source.ilike.%${t}%`)
    .join(",");
  try {
    const { data, error } = await supabase
      .from("articles")
      .select(POOL_COLUMNS)
      .gte("ingested_at", since)
      .gte("relevance_score", WATCHLIST_BRIEF_FLOOR)
      .or(orExpr)
      .order("relevance_score", { ascending: false })
      .limit(200);
    if (error) {
      console.warn("[watchlist-brief] matched fetch error:", error.message);
      return [];
    }
    return (data as unknown as WatchlistPoolRow[]) ?? [];
  } catch (e) {
    console.warn("[watchlist-brief] matched fetch threw:", e);
    return [];
  }
}

/**
 * Pure in-memory step: given a pre-fetched article pool and a user's normalized
 * tickers, produce the bullet section. Separable so the email path filters one
 * shared pool per recipient. Never throws.
 *
 * - empty   : the user has no watchlist tickers (render an onboarding nudge)
 * - quiet   : watchlist present but nothing material today
 * - populated: 1..4 bullets
 */
export function bulletsFromPool(
  pool: WatchlistPoolRow[],
  tickers: string[],
): WatchlistBriefSection {
  const tickerSet = new Set(tickers);
  if (tickerSet.size === 0) return { state: "empty", bullets: [] };

  try {
    // Exact source-ticker match against the normalized watchlist set, plus the
    // locked floor (defensive; the pool is already floored).
    const matched = pool.filter((a) => {
      if ((a.relevance_score ?? 0) < WATCHLIST_BRIEF_FLOOR) return false;
      const core = normalizeTicker(parseSourceTicker(a.source));
      return core !== null && tickerSet.has(core);
    });

    if (matched.length === 0) return { state: "quiet", bullets: [] };

    // Rank, take the candidate window, collapse same-event near-dupes, THEN cap
    // so the four slots stay full after collapsing.
    matched.sort(rankCompare);
    const candidates = matched.slice(0, TOP_STORIES_CANDIDATE_LIMIT);
    const collapsed = collapseSameEvent(candidates) as WatchlistPoolRow[];
    const top = collapsed.slice(0, TOP_STORIES_LIMIT);

    const bullets: WatchlistBullet[] = top.map((a) => ({
      ticker: (parseSourceTicker(a.source) ?? "").toUpperCase(),
      headline: cleanHeadline(a.title),
      whyTag: (a.relevance_reason ?? "").trim(),
      articleId: a.id,
      url: a.url ?? null,
    }));

    return bullets.length > 0
      ? { state: "populated", bullets }
      : { state: "quiet", bullets: [] };
  } catch (e) {
    console.warn("[watchlist-brief] bulletsFromPool failed:", e);
    return { state: "quiet", bullets: [] };
  }
}

function rankCompare(a: WatchlistPoolRow, b: WatchlistPoolRow): number {
  const rs = (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
  if (rs !== 0) return rs;
  const ia = a.ingested_at ?? "";
  const ib = b.ingested_at ?? "";
  if (ia !== ib) return ib < ia ? -1 : 1; // ingested_at desc
  const pa = a.published_at ?? "";
  const pb = b.published_at ?? "";
  if (pa !== pb) return pb < pa ? -1 : 1; // published_at desc
  return (a.id ?? "") < (b.id ?? "") ? -1 : 1; // id asc
}

/**
 * Per-user entry point. Resolves the watchlist (table-primary/profile-fallback),
 * fetches the matched candidate articles, and returns the bullet section.
 * `briefType` is accepted for API symmetry and future recency tuning; it does
 * not change the 72h pool today. Never throws.
 */
export async function getWatchlistBullets(
  supabase: SupabaseClient,
  userId: string,
  _briefType: "morning" | "evening" = "morning",
): Promise<WatchlistBriefSection> {
  try {
    const tickers = await resolveUserWatchlist(supabase, userId);
    if (tickers.length === 0) return { state: "empty", bullets: [] };
    const pool = await fetchMatchedArticles(supabase, tickers);
    return bulletsFromPool(pool, tickers);
  } catch (e) {
    console.warn("[watchlist-brief] getWatchlistBullets failed:", e);
    return { state: "empty", bullets: [] };
  }
}
