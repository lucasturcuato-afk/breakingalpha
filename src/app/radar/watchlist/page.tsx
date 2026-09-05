"use client";

import { useState, useMemo, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { RadarTabs } from "@/components/radar/RadarTabs";
import { WatchlistGallery, type GalleryFilter, type GalleryReadiness } from "@/components/radar/WatchlistGallery";
import { ArticleMemoActions } from "@/components/radar/ArticleMemoActions";
import { GroupJumpNav, type ChipCount } from "@/components/radar/GroupJumpNav";
import { useMotionSettled } from "@/lib/use-motion-settled";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  Star,
  Trash2,
  Sparkles,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  Globe,
  GripVertical,
  Pin,
} from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createBrowserClient } from "@supabase/ssr";
import { MemoModal } from "@/components/memo/MemoModalLazy";
import { withCompanyLine } from "@/lib/memo-company-line";
import { WatchlistAddInput, type AddType } from "@/components/watchlist/WatchlistAddInput";
import { buildArticleOrFilter } from "@/lib/watchlist-utils";
import { filterImpreciseTitleMatches } from "@/lib/watchlist-title-precision";
import { nameContainsTerm } from "@/lib/whole-token-match";
import { trackClientEvent } from "@/lib/track-event";
import { useLiveMood } from "@/hooks/useLiveMood";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const INDUSTRY_VERTICALS = [
  "Technology",
  "Healthcare & Biotech",
  "Energy & Oil/Gas",
  "Financial Services",
  "Consumer & Retail",
  "Industrials & Manufacturing",
  "Aerospace & Defense",
  "Real Estate",
  "Media & Telecom",
  "Materials & Mining",
  "Agriculture",
] as const;

// Maps UI sector labels → actual DB sector column values
// Use .in('sector', mappedValues) when present; fall back to .ilike for unmapped sectors.
const SECTOR_DB_MAPPING: Record<string, string[]> = {
  "Technology": ["Technology M&A & Investment Banking", "Technology"],
  "Healthcare & Biotech": ["Healthcare & Biotech"],
  "Energy & Oil/Gas": ["Energy & Oil/Gas"],
  "Financial Services": [
    "Financial Services",
    "Public Markets & Earnings",
    "Private Equity & Buyouts",
    "Venture Capital & Startup Funding",
  ],
  "Consumer & Retail": ["Consumer & Retail"],
  "Aerospace & Defense": ["Aerospace & Defense"],
  "Real Estate": ["Real Estate & Infrastructure", "Real Estate"],
  "Materials & Mining": ["Materials & Mining"],
  // Industrials & Manufacturing, Media & Telecom, Agriculture → ilike fallback
};

const STALE_TO_CANONICAL: Record<string, string> = {
  "FINANCE": "Financial Services",
  "TECHNOLOGY": "Technology",
  "TECHNOLOGY M&A": "Technology",
  "PUBLIC MARKETS": "Financial Services",
  "GEOPOLITICS & MACRO": "Financial Services",
  "FINTECH & CRYPTO": "Financial Services",
  "HEALTHCARE & BIOTECH": "Healthcare & Biotech",
  "ENERGY & CLIMATE": "Energy & Oil/Gas",
  "PRIVATE EQUITY": "Financial Services",
  "VENTURE CAPITAL": "Financial Services",
};

// LEGACY BRIDGE — used only for existing watchlist entries added before the
// display_name column existed. New entries get display_name from Finnhub on add.
// Safe to remove once all existing entries have been re-added.
const LEGACY_TICKER_NAMES: Record<string, string> = {
  NVDA: "Nvidia", NVDL: "Nvidia", AMZN: "Amazon", TSLA: "Tesla",
  AAPL: "Apple", MSFT: "Microsoft", GOOGL: "Alphabet", GOOG: "Alphabet",
  META: "Meta", IONQ: "IonQ", FCX: "Freeport-McMoRan", SPMO: "Invesco",
  "BRK.B": "Berkshire Hathaway", BRK: "Berkshire Hathaway", V: "Visa",
  BX: "Blackstone", APO: "Apollo Global", KKR: "KKR", GS: "Goldman Sachs",
  MS: "Morgan Stanley", JPM: "JPMorgan", BAC: "Bank of America",
  CG: "Carlyle", BAM: "Brookfield", CLS: "Celestica", AMD: "AMD", INTC: "Intel",
  TSM: "TSMC", BABA: "Alibaba", NFLX: "Netflix", DIS: "Disney",
  PYPL: "PayPal", COIN: "Coinbase", PLTR: "Palantir", UBER: "Uber",
};

// Converts stored uppercase sector identifiers (e.g. "FINANCIAL SERVICES")
// to canonical display casing (e.g. "Financial Services")
function toDisplayName(identifier: string): string {
  return INDUSTRY_VERTICALS.find(
    v => v.toUpperCase() === identifier.toUpperCase(),
  ) ?? identifier;
}

interface WatchlistEntry {
  id: string;
  identifier: string;
  type: string;
  display_name?: string;
  created_at?: string;
  sort_order?: number | null;
  pinned_position?: number | null;
}

interface WatchlistPrice {
  price: string;
  pct: number;
}

interface MatchedArticle {
  id: string;
  title: string;
  source?: string;
  sector?: string;
  primary_company?: string;
  industry_verticals?: string[];
  activity_types?: string[];
  published_at?: string;
  relevance_score?: number;
  summary?: string;
  url?: string;
}

/**
 * A read has three states, and absence is not one of them.
 *
 * Every tracked identifier is seeded { status: "pending" } at the same moment
 * setWatchlist commits, so no lookup ever needs a fallback and a missing key
 * never stands in for an answer. "ready" is the only state permitted to draw
 * a zero, and a ready zero is a real answer worth showing.
 *
 * The map this replaces was Record<string, MatchedArticle[]>, read everywhere
 * as `map[id] ?? []`. That expression cannot tell an unfinished read from an
 * empty one, so at t=1202ms with 26 entries the rail drew 26 zeros of which
 * 25 were false, and with a cache slower than the 4000ms abort those zeros
 * were the final committed state.
 */
type ArticleRead =
  | { status: "pending" }
  | { status: "ready"; articles: MatchedArticle[] }
  | { status: "failed" };
type ArticleReads = Record<string, ArticleRead>;

const FAILED_READ: ArticleRead = { status: "failed" };

/**
 * THE BOTTOM BAND BELONGS TO THE SHELL'S TAB BAR, NOT TO THIS SCREEN.
 *
 * `MobileTabBar` is fixed at bottom 0 on z-40 and is the only navigation a
 * phone reader has here: the sidebar is `hidden md:block`, so below 768px the
 * four poles are the whole exit. Every fixed layer this page drew at the
 * bottom started at 0 with a z-index above 40, so the bar was painted over and
 * no pole could be hit or tapped. Measured before this change, at 320 and 390
 * in both themes and in both drawer states: 32 of 32 `elementFromPoint` probes
 * at a pole centre returned something other than that pole, and 32 of 32 real
 * taps left the URL on /radar/watchlist. Browser-back was the only way out,
 * and on a phone that is a gesture rather than a control on the screen.
 *
 * THE FIX IS NOT A LOWER z-index ON THE BAR. The bar is the shell's and every
 * other mobile screen sits under it, so the thing that covers it is the thing
 * that moves. Each fixed layer this screen draws now stops at the top of the
 * bar's band instead of at the viewport floor, which leaves all four poles
 * painted and hit-testable in both the closed and the open drawer state.
 *
 * `--mobile-tabbar-height` is a `calc()` (a 58px row plus its 1px rule), so it
 * has to be composed inside another `calc()` and can never be coerced to a
 * number. The safe-area inset is added because the bar pads itself by it.
 */
const TABBAR_BAND = "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom))";

/**
 * Every read must be able to REACH a terminal state.
 *
 * fetchCachedArticles was bounded at 4000ms, but the two PostgREST queries and
 * the Finnhub fallback had no client-side bound at all, so a hung connection
 * left that entry pending forever. Because the feed count is pending while ANY
 * read is outstanding, one stuck read pinned the header as a skeleton over a
 * populated article list, permanently. Measured before this bound: at
 * t=25426ms, 25 chips carried numerals and 22 articles were on screen while
 * the count line was still a 42px skeleton with no number and no failure
 * string.
 *
 * That is the mirror image of the defect this branch is about. Rendering an
 * ANSWERABLE state as unanswered forever is the same kind of lie as rendering
 * an unanswered one as a zero, so the fix belongs at the cause: a read that
 * cannot finish is a read that failed, and the UI already says so honestly.
 * 8000ms sits above the 4000ms cache read and the 6000ms fallbacks, so it only
 * fires when a query is genuinely stuck.
 */
const DB_READ_TIMEOUT_MS = 8000;
const FALLBACK_TIMEOUT_MS = 6000;
const ready = (articles: MatchedArticle[]): ArticleRead => ({ status: "ready", articles });

function stripHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#038;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Returns true if the title is primarily ASCII/English (>80% basic Latin chars). */
function isEnglishTitle(title: string): boolean {
  if (!title) return true;
  const asciiCount = [...title].filter((c) => c.charCodeAt(0) < 256).length;
  return asciiCount / title.length > 0.8;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days >= 30) return "30d+ ago";
  return `${days}d ago`;
}

function sortArticles(articles: MatchedArticle[], mode: "newest" | "relevant"): MatchedArticle[] {
  if (mode === "newest") {
    return [...articles].sort((a, b) =>
      new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()
    );
  }
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return [...articles].sort((a, b) => {
    const aRecent = now - new Date(a.published_at || 0).getTime() < sevenDays ? 1 : 0;
    const bRecent = now - new Date(b.published_at || 0).getTime() < sevenDays ? 1 : 0;
    if (aRecent !== bRecent) return bRecent - aRecent;
    return (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
  });
}

function mapCachedArticle(a: Record<string, unknown>): MatchedArticle {
  return {
    id: a.article_id as string,
    title: a.title as string,
    source: a.source as string | undefined,
    sector: undefined,
    primary_company: undefined,
    industry_verticals: [],
    activity_types: [],
    published_at: a.published_at as string | undefined,
    relevance_score: (a.relevance_score as number | null) ?? 5,
    summary: stripHtml(a.summary as string | null | undefined) || undefined,
    url: a.url as string | undefined,
  };
}

function mapArticle(a: Record<string, unknown>): MatchedArticle {
  return {
    id: a.id as string,
    title: a.title as string,
    source: a.source as string | undefined,
    sector: a.sector as string | undefined,
    primary_company: a.primary_company as string | undefined,
    industry_verticals: (a.industry_verticals as string[] | null) ?? [],
    activity_types: (a.activity_types as string[] | null) ?? [],
    published_at: (a.published_at as string | null) || (a.ingested_at as string | null) || undefined,
    relevance_score: (a.relevance_score as number | null) ?? 0,
    summary: stripHtml(a.summary as string | null | undefined) || undefined,
    url: a.url as string | undefined,
  };
}

function dedupeAndSort(rows: MatchedArticle[]): MatchedArticle[] {
  const seen = new Set<string>();
  const out: MatchedArticle[] = [];
  for (const a of rows) {
    if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
  }
  out.sort((a, b) =>
    new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime(),
  );
  return out.slice(0, 20);
}

/** A cache read that did not answer is not the same as a cache read that
 *  answered "none", and the caller has to be able to tell them apart. */
type CacheRead = { ok: true; articles: MatchedArticle[] } | { ok: false };

async function fetchCachedArticles(identifier: string): Promise<CacheRead> {
  try {
    const res = await fetch(
      `/api/watchlist-articles?identifier=${encodeURIComponent(identifier)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return { ok: false };
    const json = await res.json();
    if (!Array.isArray(json.articles)) return { ok: false };
    return { ok: true, articles: json.articles.map(mapCachedArticle) };
  } catch {
    // Timed out at 4000ms, aborted, or the network failed. Not an answer.
    return { ok: false };
  }
}

async function fetchArticlesForEntry(entry: WatchlistEntry): Promise<ArticleRead> {
  const baseSelect = "id, title, source, sector, primary_company, industry_verticals, activity_types, published_at, ingested_at, relevance_score, summary, url";

  if (entry.type === "sector") {
    const canonicalVertical = toDisplayName(entry.identifier);
    const dbSectors = SECTOR_DB_MAPPING[canonicalVertical];

    let sectorQuery;
    if (dbSectors && dbSectors.length > 0) {
      sectorQuery = getSupabase().from("articles").select(baseSelect)
        .in("sector", dbSectors)
        .order("ingested_at", { ascending: false }).limit(30)
        .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS));
    } else {
      sectorQuery = getSupabase().from("articles").select(baseSelect)
        .ilike("sector", `%${canonicalVertical}%`)
        .order("ingested_at", { ascending: false }).limit(30)
        .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS));
    }

    const { data, error } = await sectorQuery;
    if (error) return FAILED_READ;
    return ready(dedupeAndSort((data || []).map(mapArticle)));
  }

  // Cache-first: use pre-fetched watchlist_articles if entry is older than 60 minutes.
  // Skip cache for sector entries (handled above) and entries added < 60 min ago (no sync yet).
  const createdAt = entry.created_at ? new Date(entry.created_at).getTime() : null;
  const entryAgeMs = createdAt !== null ? Date.now() - createdAt : 0;
  const SIXTY_MIN_MS = 60 * 60 * 1000;

  if (entryAgeMs >= SIXTY_MIN_MS) {
    const cached = await fetchCachedArticles(entry.identifier);
    if (cached.ok && cached.articles.length > 0) {
      return ready(dedupeAndSort(cached.articles));
    }
    // Cache miss, or the cache read faulted. Either way, fall through to the
    // live reads below and let those decide the state.
  }

  // ticker or company — use fuzzy suffix-stripping to build a multi-term OR query.
  // Priority for display name: 1) stored display_name  2) legacy bridge  3) raw identifier
  const displayNameForSearch: string | null =
    entry.type === "company"
      ? null // company identifiers are already the human-readable name
      : (entry.display_name ?? LEGACY_TICKER_NAMES[entry.identifier.toUpperCase()] ?? null);

  const orFilter = buildArticleOrFilter(entry.identifier, displayNameForSearch, entry.type);
  // Nothing searchable for this identifier. Deterministic, not a fault.
  if (!orFilter) return ready([]);

  const { data, error } = await getSupabase()
    .from("articles")
    .select(baseSelect)
    .or(orFilter)
    .order("ingested_at", { ascending: false })
    .limit(30)
    .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS));

  if (error) return FAILED_READ;

  /* buildArticleOrFilter emits an unanchored `title ILIKE '%term%'` for every
   * term of 6 characters or more, and headline house style puts an exchange
   * qualifier in the title, so a NDAQ entry pulls "Urban Outfitters
   * (NASDAQ:URBN) Downgraded" and "Nasdaq futures fall". Measured against prod
   * 2026-08-31 on this exact query: 18 of 30 rows arrived only through that
   * arm and none were about the company. The filter keeps a row when
   * primary_company corroborates OR the title mention is genuine, so the
   * recall the arm exists for (Anthropic news filed under pc=Salesforce) is
   * preserved. It can only narrow, so the fallbacks below still fire when it
   * empties the set. watchlist-utils.ts is propose-only; the fix lives here. */
  const result = filterImpreciseTitleMatches(
    dedupeAndSort((data || []).map(mapArticle)),
    entry.identifier,
    displayNameForSearch,
    entry.type,
  );

  /* Retained for its control flow: it returns early and skips the GDELT
   * fallback for short company names.
   *
   * It is NO LONGER a no-op as a filter, and the comment that used to sit here
   * saying it was is the reason the defect survived. The claim was "every row
   * already satisfied primary_company ILIKE '%identifier%'", which is true and
   * is exactly the problem: this line repeated the query's own unanchored
   * containment, so it agreed with it by construction. For an identifier under
   * six characters that ILIKE arm is the ONLY arm (the title arm is off below
   * six), so nothing anywhere in this path required a token boundary. An entry
   * named "Ola" was served every row whose primary_company merely contains
   * those three letters: Motorola Solutions, Coca-Cola, Nikola.
   *
   * nameContainsTerm is the same predicate companyCorroborates now uses, so the
   * two checks on this page agree instead of one being anchored and one not. It
   * only narrows: rows are already back from PostgREST. */
  if (entry.type === "company" && entry.identifier.length < 6) {
    return ready(result.filter(a => nameContainsTerm(a.primary_company, entry.identifier)));
  }

  /* The fallbacks below are where a ticker or a thinly-covered company gets
   * its only articles, so a fallback that faults and leaves nothing behind is
   * a failed read, not an empty one. When the primary read already returned
   * rows there is real data to show, and the read stays ready. */
  let fallbackFaulted = false;

  if (result.length === 0 && entry.type === "ticker") {
    try {
      const res = await fetch(
        `/api/finnhub-news?symbol=${encodeURIComponent(entry.identifier)}`,
        { signal: AbortSignal.timeout(FALLBACK_TIMEOUT_MS) },
      );
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.articles) && json.articles.length > 0) {
          return ready(dedupeAndSort(json.articles.map(mapArticle)));
        }
      } else {
        fallbackFaulted = true;
      }
    } catch {
      fallbackFaulted = true;
    }
  }

  // GDELT fallback for company entries with sparse coverage
  if (entry.type === "company" && result.length < 3) {
    try {
      const searchName = entry.display_name || entry.identifier;
      const gdeltRes = await fetch(
        `/api/news-search?q=${encodeURIComponent(searchName)}`,
        { signal: AbortSignal.timeout(FALLBACK_TIMEOUT_MS) },
      );
      if (gdeltRes.ok) {
        const gdeltJson = await gdeltRes.json();
        if (Array.isArray(gdeltJson.articles) && gdeltJson.articles.length > 0) {
          const gdeltArticles = gdeltJson.articles.map(mapArticle);
          return ready(dedupeAndSort([...result, ...gdeltArticles]));
        }
      } else {
        fallbackFaulted = true;
      }
    } catch {
      fallbackFaulted = true;
    }
  }

  if (result.length === 0 && fallbackFaulted) return FAILED_READ;

  return ready(result);
}

function buildWatchlistMemoContent(entry: WatchlistEntry, articles: MatchedArticle[]): string {
  const lines = [
    `Watchlist item: ${entry.identifier}`,
    `Type: ${entry.type}`,
    "",
    `Recent articles (${articles.length} total):`,
  ];
  articles.slice(0, 10).forEach((a) => {
    const date = a.published_at ? timeAgo(a.published_at) : "unknown";
    lines.push(`- ${a.title} (${a.source ?? "unknown"}, ${date})`);
  });
  return lines.join("\n");
}

function chipCountFor(read: ArticleRead): ChipCount {
  if (read.status === "pending") return { kind: "pending" };
  if (read.status === "failed") return { kind: "failed" };
  return { kind: "ready", value: read.articles.length };
}

/**
 * The article-count pill on a tracked row, in all four states.
 *
 * A ready zero now DRAWS. The `articleCount > 0` gates this replaces hid the
 * one genuine zero the page had, which meant the only zero a reader ever saw
 * was a chip on the rail, and that one was usually false.
 */
function CountBadge({ count }: { count: ChipCount }) {
  if (count.kind === "none") return null;
  /* Same box in every state, so the row's price and chevron never shift.
   *
   * 31x22 is measured. The pill renders 20.05px wide for a single digit and
   * 30.63px for "20+", its widest form, at a natural height of 22px, while the
   * skeleton that used to stand in for it was 24x16. So resolving a count both
   * narrowed and grew the badge and shifted everything beside it. Fixing the
   * skeleton alone would not have helped: the pill has to be pinned too, or it
   * still changes width between "3" and "20+". */
  if (count.kind === "pending") {
    return (
      <span
        aria-hidden
        className="skeleton-shimmer inline-block h-[22px] w-[31px] rounded-md"
      />
    );
  }
  // A failed read keeps the box open rather than collapsing the row.
  if (count.kind === "failed") {
    return <span aria-hidden className="inline-block h-[22px] w-[31px]" />;
  }
  return (
    <span className="inline-block w-[31px] text-center font-sans text-[10px] text-text-faint bg-parchment-mid border border-border-base py-0.5 rounded-md">
      {count.value >= 20 ? "20+" : count.value}
    </span>
  );
}

/** Stand-in rows for a feed whose reads have not landed. Never a sentence. */
function FeedReadSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white dark:bg-elevated border border-border-base dark:border-border-default rounded-xl p-3 space-y-2"
        >
          <Skeleton className="h-[10px] w-[110px] rounded-[4px]" />
          <Skeleton className="h-[14px] w-3/4 rounded-[4px]" />
          <Skeleton className="h-[12px] w-2/3 rounded-[4px]" />
        </div>
      ))}
    </div>
  );
}

function cleanDisplayName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name
    .replace(/\s*-\s*CL\s+[A-Z]\s*$/i, "")
    .replace(/\s+INC-CL\s+[A-Z]\s*$/i, "")
    .replace(/\s+-\s*Class\s+[A-Z]\s*$/i, "")
    .replace(/\s+Class\s+[A-Z]\s+Shares?\s*$/i, "")
    .trim() || null;
}

export default function WatchlistPage() {
  const { mood, moodHeadline, moodDetails } = useLiveMood();
  const router = useRouter();
  const motionSettled = useMotionSettled();
  const [memoEntry, setMemoEntry] = useState<WatchlistEntry | null>(null);
  const [articleMemoEntry, setArticleMemoEntry] = useState<MatchedArticle | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [prices, setPrices] = useState<Record<string, WatchlistPrice>>({});
  const [articleReads, setArticleReads] = useState<ArticleReads>({});
  const [loading, setLoading] = useState(true);
  /** The LIST read itself faulted. Outranks "nothing tracked yet", which is a
   *  statement about the reader's account and would be false here. */
  const [listFailed, setListFailed] = useState(false);
  const [addType, setAddType] = useState<AddType>("ticker");
  const [addError, setAddError] = useState("");
  const [selectedIdentifier, setSelectedIdentifier] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"newest" | "relevant">("newest");
  const [ageFilter, setAgeFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>("all");
  const [dragError, setDragError] = useState<string | null>(null);
  const dragErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState<number | null>(null);
  const [showShortcutLegend, setShowShortcutLegend] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const fetchPrices = useCallback((entries: WatchlistEntry[]) => {
    const tickers = entries.filter((e) => e.type === "ticker").map((e) => e.identifier);
    if (tickers.length > 0) {
      fetch(`/api/watchlist-quotes?symbols=${tickers.join(",")}`)
        .then((r) => r.json())
        .then((d) => { if (d.quotes) setPrices(d.quotes); })
        .catch(() => {});
    }
  }, []);

  /**
   * The list and the pending seed commit together, so there is never a render
   * where an identifier is in the watchlist but absent from the read map.
   *
   * setLoading(false) fires here rather than after the article reads: the left
   * column only needs the list, and keeping its skeleton up for the slowest
   * of twenty-six article reads bought nothing.
   */
  const commitWatchlist = useCallback((entries: WatchlistEntry[]) => {
    const seeded: ArticleReads = {};
    for (const e of entries) seeded[e.identifier] = { status: "pending" };
    setWatchlist(entries);
    setArticleReads(seeded);
    setListFailed(false);
    setLoading(false);
    // A selection that is no longer tracked has no read to look up.
    setSelectedIdentifier((sel) =>
      sel !== null && entries.some((e) => e.identifier === sel) ? sel : null,
    );
    setMemoEntry((m) =>
      m !== null && entries.some((e) => e.identifier === m.identifier) ? m : null,
    );
  }, []);

  /**
   * Commit each identifier as its own read resolves.
   *
   * Committing once after Promise.allSettled made the blank window the MAX of
   * every read rather than the median. Measured on the before state: with one
   * entry 3.6s slower than the rest, all 26 sat at zero until t=8002ms even
   * though 25 of them had their data at t=~1200ms.
   */
  const fetchAllArticles = useCallback((entries: WatchlistEntry[]) => {
    entries.forEach((entry) => {
      fetchArticlesForEntry(entry)
        .then((read) => {
          setArticleReads((prev) => ({ ...prev, [entry.identifier]: read }));
        })
        .catch(() => {
          setArticleReads((prev) => ({ ...prev, [entry.identifier]: FAILED_READ }));
        });
    });
  }, []);

  const refreshWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      if (!res.ok) {
        console.error("Watchlist fetch failed:", res.status);
        setListFailed(true);
        return;
      }
      const { entries } = await res.json();
      const seen = new Set<string>();
      const newEntries = (entries || []).filter((e: WatchlistEntry) => {
        const key = `${e.identifier.toUpperCase()}::${e.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Stale sector auto-migration
      const staleSectors = newEntries.filter(
        (e: WatchlistEntry) => e.type === "sector" && STALE_TO_CANONICAL[e.identifier.toUpperCase()]
      );
      if (staleSectors.length > 0) {
        /* A migration write that fails must not take the list down with it.
         * Before: an unhandled rejection here fell through to the catch below,
         * which swallowed it while the finally still ran setLoading(false), so
         * the whole watchlist rendered "Nothing tracked yet". Any sector in
         * STALE_TO_CANONICAL was enough to trigger it. Each write now swallows
         * its own failure, so the re-read below still runs and still tells the
         * truth about what is actually stored. */
        await Promise.all(
          staleSectors.map(async (e: WatchlistEntry) => {
            const canonical = STALE_TO_CANONICAL[e.identifier.toUpperCase()];
            try {
              await fetch("/api/watchlist", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: e.id }),
              });
              await fetch("/api/watchlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: canonical, type: "sector" }),
              });
            } catch (err) {
              console.error("Stale sector migration failed:", e.identifier, err);
            }
          })
        );
        // Re-fetch after migration
        const res2 = await fetch("/api/watchlist");
        if (!res2.ok) {
          console.error("Watchlist re-read after migration failed:", res2.status);
          /* The pre-migration snapshot is known stale here, since rows were
           * just deleted, so there is nothing honest left to render. */
          setListFailed(true);
          return;
        }
        const { entries: entries2 } = await res2.json();
        const seen2 = new Set<string>();
        const migratedEntries = (entries2 || []).filter((e: WatchlistEntry) => {
          const key = `${e.identifier.toUpperCase()}::${e.type}`;
          if (seen2.has(key)) return false;
          seen2.add(key);
          return true;
        });
        const sortedMigrated = [...migratedEntries].sort((a, b) => {
          const aOrder = (a as WatchlistEntry & { sort_order?: number | null }).sort_order;
          const bOrder = (b as WatchlistEntry & { sort_order?: number | null }).sort_order;
          if (aOrder == null && bOrder == null) return 0;
          if (aOrder == null) return 1;
          if (bOrder == null) return -1;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        });
        commitWatchlist(sortedMigrated);
        fetchAllArticles(sortedMigrated);
        fetchPrices(sortedMigrated);
        return;
      }

      // Sort by sort_order ASC (NULLS LAST), then created_at ASC
      const sortedEntries = [...newEntries].sort((a, b) => {
        const aOrder = (a as WatchlistEntry & { sort_order?: number | null }).sort_order;
        const bOrder = (b as WatchlistEntry & { sort_order?: number | null }).sort_order;
        if (aOrder == null && bOrder == null) return 0;
        if (aOrder == null) return 1;
        if (bOrder == null) return -1;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      });
      commitWatchlist(sortedEntries);
      fetchAllArticles(sortedEntries);
      fetchPrices(sortedEntries);
    } catch (e) {
      console.error("Failed to refresh watchlist:", e);
      setListFailed(true);
    } finally {
      setLoading(false);
    }
  }, [commitWatchlist, fetchAllArticles, fetchPrices]);

  useEffect(() => {
    refreshWatchlist();
  }, [refreshWatchlist]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleAdd = async (identifier: string, displayName?: string) => {
    if (!identifier.trim()) {
      if (addType === "company") {
        setAddError("Please enter a company name (at least 2 characters)");
      } else {
        setAddError("Please select a ticker from the dropdown");
      }
      return;
    }
    if (addType === "company" && identifier.trim().length < 2) {
      setAddError("Company name must be at least 2 characters");
      return;
    }
    setAddError("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          type: addType,
          ...(displayName ? { display_name: displayName } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        setAddError(body.error || "Failed to add");
        return;
      }
      await refreshWatchlist();
      trackClientEvent("watchlist_added", {
        identifier: identifier.trim(),
        type: addType,
      });
    } catch {
      setAddError("Network error");
    }
  };

  const handleRemove = async (id: string) => {
    const removed = watchlist.find((e) => e.id === id);
    try {
      await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refreshWatchlist();
      if (removed) {
        trackClientEvent("watchlist_removed", {
          identifier: removed.identifier,
          type: removed.type,
        });
      }
    } catch (e) {
      console.error("Failed to remove:", e);
    }
  };

  const handleAddSector = async (sectorName: string) => {
    const isTracked = watchlist.some((e) => e.identifier.toLowerCase() === sectorName.toLowerCase());
    if (isTracked) return;
    await handleAdd(sectorName);
  };

  const pinnedCount = useMemo(
    () => watchlist.filter((e) => e.type === "ticker" && e.pinned_position != null).length,
    [watchlist],
  );

  const lowestOpenSlot = useCallback((): number | null => {
    const taken = new Set(
      watchlist
        .filter((e) => e.type === "ticker" && e.pinned_position != null)
        .map((e) => e.pinned_position as number),
    );
    for (let i = 1; i <= 5; i++) {
      if (!taken.has(i)) return i;
    }
    return null;
  }, [watchlist]);

  const handlePinToggle = useCallback(
    async (entry: WatchlistEntry) => {
      try {
        let position: number | null;
        if (entry.pinned_position != null) {
          position = null;
        } else if (pinnedCount < 5) {
          const slot = lowestOpenSlot();
          if (slot == null) return;
          position = slot;
        } else {
          return;
        }
        const res = await fetch("/api/watchlist/pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: entry.identifier, position }),
        });
        if (!res.ok) {
          console.error("[watchlist] pin toggle failed:", res.status);
          return;
        }
        await refreshWatchlist();
      } catch (e) {
        console.error("[watchlist] pin toggle error:", e);
      }
    },
    [pinnedCount, lowestOpenSlot, refreshWatchlist],
  );

  const tickers = watchlist.filter((e) => e.type === "ticker");
  const gainers = tickers.filter((e) => prices[e.identifier]?.pct > 0).length;
  const losers = tickers.filter((e) => prices[e.identifier]?.pct < 0).length;
  const flat = tickers.length - gainers - losers;

  const sectorEntries = useMemo(() => watchlist.filter((e) => e.type === "sector"), [watchlist]);
  const nonSectorEntries = useMemo(() => watchlist.filter((e) => e.type !== "sector"), [watchlist]);
  const showDivider = sectorEntries.length > 0 && nonSectorEntries.length > 0;
  const publicEntries = useMemo(() => nonSectorEntries.filter((e) => e.type === "ticker"), [nonSectorEntries]);
  const privateEntries = useMemo(() => nonSectorEntries.filter((e) => e.type === "company"), [nonSectorEntries]);

  const selectedEntry = watchlist.find(e => e.identifier === selectedIdentifier);
  const selectedDisplayLabel = selectedIdentifier
    ? (selectedEntry?.type === "sector"
        ? toDisplayName(selectedIdentifier)
        : (selectedEntry?.display_name ?? LEGACY_TICKER_NAMES[selectedIdentifier.toUpperCase()] ?? selectedIdentifier))
    : null;

  /**
   * The tracked count is not known until the LIST read lands, and 0 is not a
   * stand-in for "not yet". Omit the numeral rather than invent one.
   */
  const listCountLabel = (noun: string) =>
    loading || listFailed ? noun : `${noun} (${watchlist.length})`;

  /**
   * Articles from READY reads only, seeded for every tracked identifier so
   * consumers never need a fallback. A pending or failed entry contributes an
   * empty list here and says so through its own read state elsewhere; it is
   * never described as having no news.
   */
  const readyArticles = useMemo(() => {
    const out: Record<string, MatchedArticle[]> = {};
    for (const e of watchlist) {
      const read = articleReads[e.identifier];
      out[e.identifier] = read.status === "ready" ? read.articles : [];
    }
    return out;
  }, [watchlist, articleReads]);

  /**
   * What the feed can honestly say about its own count.
   *
   * Focused on one entity it is that entity's read. Across everything it is
   * pending while any read is outstanding, because a total is not known until
   * the last one lands, and failed only when EVERY read faulted. A mixed
   * result renders the count it has, with the rail's own "Counts unavailable"
   * marker carrying the disclosure, since claiming "Articles unavailable"
   * above a list of visible articles would be its own falsehood.
   *
   * "Pending while any read is outstanding" was a deliberate choice and it
   * stays. The alternative considered was a count-so-far with a disclosure,
   * which was rejected: it invents a fourth header state and new copy to
   * describe a symptom, when the real problem was that "outstanding" had no
   * upper bound. Every read path is now bounded (see DB_READ_TIMEOUT_MS), so
   * this resolves to a number or to "Articles unavailable" and can no longer
   * sit as a skeleton forever.
   */
  const feedStatus: ArticleRead["status"] = useMemo(() => {
    /* The LIST read gates everything below it. Without these two the header
       rendered "0 articles" on a failed list read and during the loading
       window, because an empty watchlist trivially satisfies "every read
       landed". Same false zero, one level up. */
    if (listFailed) return "failed";
    if (loading) return "pending";
    if (selectedIdentifier) return articleReads[selectedIdentifier].status;
    const reads = watchlist.map((e) => articleReads[e.identifier]);
    if (reads.length === 0) return "ready";
    if (reads.some((r) => r.status === "pending")) return "pending";
    if (reads.every((r) => r.status === "failed")) return "failed";
    return "ready";
  }, [listFailed, loading, selectedIdentifier, watchlist, articleReads]);

  /** The gallery asserts quiet, so any failure outranks any pending. */
  const galleryReadiness: GalleryReadiness = useMemo(() => {
    const reads = watchlist.map((e) => articleReads[e.identifier]);
    if (reads.some((r) => r.status === "failed")) return { status: "failed" };
    if (reads.some((r) => r.status === "pending")) return { status: "pending" };
    return { status: "ready" };
  }, [watchlist, articleReads]);

  const displayedArticles = useMemo(() => {
    const now = Date.now();
    const AGE_WINDOWS: Record<string, number> = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
    };

    function applyAgeFilter(articles: MatchedArticle[]): MatchedArticle[] {
      if (ageFilter === "all") return articles;
      const window = AGE_WINDOWS[ageFilter];
      return articles.filter((a) => {
        if (!a.published_at) return false;
        return now - new Date(a.published_at).getTime() <= window;
      });
    }

    function normalizeKey(a: MatchedArticle): string {
      const t = (a.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const u = a.url ?? "";
      return `${t}||${u}`;
    }

    if (selectedIdentifier) {
      const arts = applyAgeFilter(
        readyArticles[selectedIdentifier].filter((a) => isEnglishTitle(a.title)),
      );
      return sortArticles(arts, sortMode).slice(0, 20);
    }

    const allArts = Object.values(readyArticles).flat();
    const seenId = new Set<string>();
    const seenKey = new Set<string>();
    const deduped = allArts.filter((a) => {
      if (seenId.has(a.id)) return false;
      seenId.add(a.id);
      const key = normalizeKey(a);
      if (seenKey.has(key)) return false;
      seenKey.add(key);
      return true;
    });

    return sortArticles(
      applyAgeFilter(deduped.filter((a) => isEnglishTitle(a.title))),
      sortMode,
    ).slice(0, 60);
  }, [selectedIdentifier, readyArticles, sortMode, ageFilter]);

  // Pointer sensor with a small activation distance prevents clicks from starting a drag;
  // TouchSensor with a long-press delay enables drag-reorder on touch devices without
  // stealing taps that should navigate into a row.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persistReorder = useCallback(async (updates: { id: string; sort_order: number }[]) => {
    try {
      const res = await fetch("/api/watchlist-reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Reorder failed: ${res.status}`);
      }
    } catch (e) {
      console.error("Reorder persist failed:", e);
      throw e;
    }
  }, []);

  const handleGroupDragEnd = useCallback(
    (group: "ticker" | "company") =>
      (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const groupEntries = group === "ticker" ? publicEntries : privateEntries;
        const fromIdx = groupEntries.findIndex((e) => e.id === String(active.id));
        const toIdx = groupEntries.findIndex((e) => e.id === String(over.id));
        if (fromIdx === -1 || toIdx === -1) return;

        const reordered = arrayMove(groupEntries, fromIdx, toIdx);
        const updates = reordered.map((entry, idx) => ({
          id: entry.id,
          sort_order: (idx + 1) * 1000,
        }));

        const prevWatchlist = [...watchlist];
        const newWatchlist =
          group === "ticker"
            ? [
                ...watchlist.filter((e) => e.type === "sector"),
                ...reordered,
                ...watchlist.filter((e) => e.type === "company"),
              ]
            : [...watchlist.filter((e) => e.type !== "company"), ...reordered];
        setWatchlist(newWatchlist);

        persistReorder(updates).catch(() => {
          setWatchlist(prevWatchlist);
          setDragError("Reorder failed — changes reverted");
          if (dragErrorTimeoutRef.current) clearTimeout(dragErrorTimeoutRef.current);
          dragErrorTimeoutRef.current = setTimeout(() => setDragError(null), 3000);
        });
      },
    [publicEntries, privateEntries, watchlist, persistReorder],
  );

  function isTyping(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
      (el as HTMLElement).contentEditable === "true";
  }

  const allEntries = useMemo(
    () => [...sectorEntries, ...publicEntries, ...privateEntries],
    [sectorEntries, publicEntries, privateEntries]
  );

  const focusAddInput = useCallback(() => {
    const input = document.querySelector('input[placeholder*="ticker"], input[type="text"]') as HTMLInputElement | null;
    input?.focus();
  }, []);

  useEffect(() => {
    const isMemoOpen = memoEntry !== null || articleMemoEntry !== null;

    function handleKeyDown(e: KeyboardEvent) {
      if (isTyping()) return;
      if (isMemoOpen) return;

      switch (e.key) {
        case "j":
        case "J":
          e.preventDefault();
          setSelectedEntryIndex(prev =>
            prev === null ? 0 : Math.min(prev + 1, allEntries.length - 1)
          );
          break;
        case "k":
        case "K":
          e.preventDefault();
          setSelectedEntryIndex(prev =>
            prev === null ? 0 : Math.max(prev - 1, 0)
          );
          break;
        case "Enter":
          if (selectedEntryIndex !== null && allEntries[selectedEntryIndex]) {
            e.preventDefault();
            router.push(`/watchlist/${encodeURIComponent(allEntries[selectedEntryIndex].identifier)}`);
          }
          break;
        case "a":
        case "A":
          e.preventDefault();
          focusAddInput();
          break;
        case "Escape":
          e.preventDefault();
          if (mobileSheetOpen) {
            setMobileSheetOpen(false);
          } else {
            setSelectedEntryIndex(null);
          }
          break;
        case "?":
          e.preventDefault();
          setShowShortcutLegend(prev => !prev);
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [memoEntry, articleMemoEntry, selectedEntryIndex, allEntries, router, focusAddInput, mobileSheetOpen]);

  useEffect(() => {
    function handleMouseDown() {
      setSelectedEntryIndex(null);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  useEffect(() => {
    if (selectedEntryIndex === null) return;
    const entry = allEntries[selectedEntryIndex];
    if (!entry) return;
    const el = document.querySelector(`[data-entry-id="${entry.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedEntryIndex, allEntries]);

  return (
    <AppShell pageTitle="Radar" mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
      <div
        data-radar-page
        data-motion-settling={motionSettled ? undefined : ""}
        className="motion-page-enter px-6 pt-4 -mb-1"
      >
        <RadarTabs active="watchlist" />
        {!isMobile && watchlist.length > 0 && (
          <WatchlistGallery
            entries={watchlist}
            prices={prices}
            articlesByIdentifier={readyArticles}
            readiness={galleryReadiness}
            filter={galleryFilter}
            onFilterChange={setGalleryFilter}
            onFocus={(identifier) => {
              setSelectedIdentifier(identifier);
              document
                .getElementById("radar-watchlist-workspace")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          />
        )}
      </div>
      <div
        id="radar-watchlist-workspace"
        style={{
          display: 'flex',
          gap: '24px',
          padding: isMobile ? '12px' : '24px',
          /* dvh, not vh: on a phone `vh` is the tall-bar height, so the
             workspace was taller than the visible page by the browser chrome. */
          height: 'calc(100dvh - var(--topbar-height) - var(--moodbar-height) - 58px)',
          flexDirection: isMobile ? 'column' : 'row',
        }}
      >
        {/* LEFT COL — hidden on mobile (shown as bottom sheet instead) */}
        <div
          style={{
            width: isMobile ? '100%' : '360px',
            flexShrink: 0,
            overflowY: 'auto',
            display: isMobile ? 'none' : 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          <p className="font-sans text-[12px] text-text-muted">
            Track companies, tickers, and sectors. Articles matching your watchlist are boosted in relevance.
          </p>

          {/* Add form with autocomplete */}
          <WatchlistAddInput
            addType={addType}
            onAddTypeChange={setAddType}
            onAdd={handleAdd}
            addError={addError}
            onClearError={() => setAddError("")}
            trackedIdentifiers={watchlist.map((e) => e.identifier)}
          />

          {/* Stats */}
          {tickers.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Tracking", sub: `${watchlist.length} items`, value: watchlist.length, icon: <Star size={12} />, color: "text-gold" },
                { label: "Gainers", sub: `of ${tickers.length} tickers`, value: gainers, icon: <TrendingUp size={12} />, color: "text-signal-up" },
                { label: "Losers", sub: `of ${tickers.length} tickers`, value: losers, icon: <TrendingDown size={12} />, color: "text-signal-dn" },
                { label: "Flat", sub: `of ${tickers.length} tickers`, value: flat, icon: <Minus size={12} />, color: "text-text-muted" },
              ].map((s) => (
                <div key={s.label} className="bg-white dark:bg-elevated border border-border-base rounded-xl p-3 text-center">
                  <div className={cn("flex items-center justify-center gap-1 mb-0.5", s.color)}>
                    {s.icon}
                    <span className="font-sans text-[16px] font-bold">{s.value}</span>
                  </div>
                  <p className="font-sans text-[9px] text-text-muted">{s.label}</p>
                  <p className="font-sans text-[8px] text-text-faint">{s.sub}</p>
                </div>
              ))}
            </div>
          )}

          {tickers.length > 0 && (
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: '8px', marginTop: '4px' }}>
              <Link
                href="/watchlist/export"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-base bg-white dark:bg-elevated text-text-muted font-sans text-[10px] hover:text-text-primary transition-colors cursor-pointer"
              >
                Export Report
              </Link>
              <a
                href="/api/export/watchlist-xlsx"
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-base bg-white dark:bg-elevated text-text-muted font-sans text-[10px] hover:text-text-primary transition-colors cursor-pointer"
              >
                Export Excel (.xlsx)
              </a>
            </div>
          )}

          {/* Tracking list */}
          <div>
            <p className="font-sans text-[10px] text-text-muted mb-2.5">
              {listCountLabel("Tracking")}
            </p>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
              </div>
            ) : listFailed ? (
              /* Outranks the empty branch below. "Nothing tracked yet" is a
                 statement about the reader's account, and the account is not
                 what failed. */
              <EmptyState
                icon={<Star size={32} />}
                title="Watchlist unavailable"
                description="The list could not be read."
              />
            ) : watchlist.length === 0 ? (
              <EmptyState
                icon={<Star size={32} />}
                title="Nothing tracked yet"
                description="Add a ticker, company, or sector above to start tracking"
              />
            ) : (
              <div className="space-y-1.5">
                {/* SECTOR GROUP */}
                {sectorEntries.length > 0 && (
                  <>
                    {showDivider && (
                      <p className="font-sans text-[8px] text-text-faint mb-1.5">Sectors</p>
                    )}
                    {sectorEntries.map((entry) => {
                      const count = chipCountFor(articleReads[entry.identifier]);
                      return (
                        <div
                          key={entry.id}
                          data-entry-id={entry.id}
                          onClick={() => setSelectedIdentifier(sel => sel === entry.identifier ? null : entry.identifier)}
                          className={cn(
                            "flex items-center justify-between gap-3 px-4 py-3 border border-border-base rounded-xl group cursor-pointer transition-colors",
                            selectedEntryIndex !== null && allEntries[selectedEntryIndex]?.id === entry.id
                              ? "border-l-2 border-l-amber-500 bg-amber-50/20"
                              : selectedIdentifier === entry.identifier
                                ? "border-l-2 border-l-gold bg-gold-muted/30"
                                : "bg-parchment-mid hover:border-border-hover",
                          )}
                        >
                          {/* Sector name — full width, no fixed constraint */}
                          <span className="font-display text-[12px] font-bold text-text-primary truncate min-w-0 flex-1">
                            {toDisplayName(entry.identifier)}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <CountBadge count={count} />
                            <div
                              className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button type="button" onClick={() => setMemoEntry(entry)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Generate memo">
                                <Sparkles size={11} className="text-gold" />
                              </button>
                              <button type="button" onClick={() => handleRemove(entry.id)} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Remove">
                                <Trash2 size={11} className="text-text-faint hover:text-signal-dn" />
                              </button>
                            </div>
                            <Globe size={10} className="text-text-faint" />
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* DIVIDER */}
                {showDivider && (
                  <div className="flex items-center gap-2 my-2">
                    <div className="flex-1 h-px bg-border-base" />
                    <div className="flex-1 h-px bg-border-base" />
                  </div>
                )}

                {/* PUBLIC COMPANIES GROUP */}
                {publicEntries.length > 0 && (
                  <>
                    <p className="font-sans text-[8px] text-text-faint mb-1.5 mt-1">Public companies</p>
                    <DndContext
                      sensors={dndSensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleGroupDragEnd("ticker")}
                    >
                      <SortableContext
                        items={publicEntries.map((e) => e.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className="space-y-1.5 list-none p-0 m-0">
                          {publicEntries.map((entry) => {
                            const price = prices[entry.identifier];
                            const count = chipCountFor(articleReads[entry.identifier]);
                            const subtitle = cleanDisplayName(entry.display_name ?? LEGACY_TICKER_NAMES[entry.identifier.toUpperCase()]);
                            return (
                              <SortableEntryRow
                                key={entry.id}
                                entry={entry}
                                isSelected={selectedIdentifier === entry.identifier}
                                isKeyboardActive={selectedEntryIndex !== null && allEntries[selectedEntryIndex]?.id === entry.id}
                                onSelect={() => setSelectedIdentifier(sel => sel === entry.identifier ? null : entry.identifier)}
                                subtitle={subtitle ?? null}
                                count={count}
                                price={price}
                                onGenerateMemo={() => setMemoEntry(entry)}
                                onOpenBrief={() => router.push(`/watchlist/${encodeURIComponent(entry.identifier)}`)}
                                onRemove={() => handleRemove(entry.id)}
                                onPinToggle={() => handlePinToggle(entry)}
                                pinnedCount={pinnedCount}
                              />
                            );
                          })}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  </>
                )}

                {/* PRIVATE COMPANIES GROUP */}
                {privateEntries.length > 0 && (
                  <>
                    <p className="font-sans text-[8px] text-text-faint mb-1.5 mt-1">Private companies</p>
                    <DndContext
                      sensors={dndSensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleGroupDragEnd("company")}
                    >
                      <SortableContext
                        items={privateEntries.map((e) => e.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className="space-y-1.5 list-none p-0 m-0">
                          {privateEntries.map((entry) => {
                            const price = prices[entry.identifier];
                            const count = chipCountFor(articleReads[entry.identifier]);
                            const subtitle = cleanDisplayName(entry.display_name ?? LEGACY_TICKER_NAMES[entry.identifier.toUpperCase()]);
                            return (
                              <SortableEntryRow
                                key={entry.id}
                                entry={entry}
                                isSelected={selectedIdentifier === entry.identifier}
                                isKeyboardActive={selectedEntryIndex !== null && allEntries[selectedEntryIndex]?.id === entry.id}
                                onSelect={() => setSelectedIdentifier(sel => sel === entry.identifier ? null : entry.identifier)}
                                subtitle={subtitle ?? null}
                                count={count}
                                price={price}
                                onGenerateMemo={() => setMemoEntry(entry)}
                                onOpenBrief={() => router.push(`/watchlist/${encodeURIComponent(entry.identifier)}`)}
                                onRemove={() => handleRemove(entry.id)}
                                onPinToggle={() => handlePinToggle(entry)}
                                pinnedCount={pinnedCount}
                              />
                            );
                          })}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COL — full width on mobile */}
        {/* The 64px reserve was measured against a drawer trigger that started
            at the viewport floor. The trigger now sits one tab bar band higher,
            so the reserve has to clear both or the last article parks under it. */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingBottom: isMobile ? `calc(64px + ${TABBAR_BAND})` : '0' }}>
          {/* Persistent entity filter: move between what you track
              without scrolling. Sticky within the feed's own scroll box. */}
          {watchlist.length > 1 && (
            <GroupJumpNav
              ariaLabel="Filter feed by tracked entity"
              groups={[
                /* Explicit ChipCount at every chip, never a bare number and
                   never undefined. The All chip counts nothing by design and
                   now says so. */
                { id: "__all", label: "All", count: { kind: "none" } as ChipCount },
                ...watchlist.map((e) => ({
                  id: e.identifier,
                  label: e.display_name || toDisplayName(e.identifier),
                  count: chipCountFor(articleReads[e.identifier]),
                })),
              ]}
              activeId={selectedIdentifier ?? "__all"}
              onSelect={(id) => setSelectedIdentifier(id === "__all" ? null : id)}
            />
          )}
          {/* Stacked below md, side by side above it. Six filter chips and a
              heading do not share a 390px row: the chip row took what it
              needed and left the heading a column narrow enough to wrap
              "Watchlist feed" onto three lines. Desktop keeps the single row. */}
          <div className="flex flex-col items-stretch gap-2 mb-3 md:flex-row md:items-center md:justify-between md:gap-0">
            {selectedIdentifier ? (
              <div className="flex items-center gap-2">
                <span className="font-display text-[15px] font-bold text-espresso">{selectedDisplayLabel}</span>
                {feedStatus === "pending" ? (
                  <Skeleton className="h-[12px] w-[56px] rounded-[4px]" />
                ) : feedStatus === "failed" ? (
                  <span className="font-sans text-[10px] text-text-muted">Articles unavailable</span>
                ) : (
                  <span className="font-sans text-[10px] text-text-faint">{displayedArticles.length} articles</span>
                )}
                <button onClick={() => setSelectedIdentifier(null)} className="font-sans text-[9px] text-text-muted hover:text-text-primary cursor-pointer ml-1">← All</button>
              </div>
            ) : (
              <div>
                <p className="font-sans text-[10px] text-text-muted">Watchlist feed</p>
                {feedStatus === "pending" ? (
                  /* Sized to the column, not to the word it replaces. At 390px
                     the filter row squeezes this column to about 46px, and a
                     pending marker the reader cannot see is not a marker. */
                  <Skeleton className="mt-1 h-[13px] w-[42px] rounded-[4px]" />
                ) : feedStatus === "failed" ? (
                  <p className="font-sans text-[11px] text-text-muted font-semibold">Articles unavailable</p>
                ) : (
                  <p className="font-sans text-[11px] text-gold font-semibold">{displayedArticles.length} articles</p>
                )}
              </div>
            )}
            {/* The six chips are 356px wide and the column is 320 at the
                narrow end, so the last one was cut off at the edge with no way
                to reach it. The row scrolls instead of being clipped. */}
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(["all", "today", "week", "month"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAgeFilter(f)}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-sans text-[10px] cursor-pointer transition-colors border flex-shrink-0 whitespace-nowrap",
                    ageFilter === f
                      ? "border-gold bg-gold-muted text-gold font-semibold"
                      : "border-border-base bg-white dark:bg-elevated text-text-muted hover:text-text-primary",
                  )}
                >
                  {f === "all" ? "All" : f === "today" ? "Today" : f === "week" ? "This Week" : "This Month"}
                </button>
              ))}
              <div className="w-px h-4 bg-border-base mx-0.5 flex-shrink-0" />
              {(["newest", "relevant"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSortMode(mode)}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-sans text-[10px] cursor-pointer transition-colors border flex-shrink-0 whitespace-nowrap",
                    sortMode === mode
                      ? "border-gold bg-gold-muted text-gold font-semibold"
                      : "border-border-base bg-white dark:bg-elevated text-text-muted hover:text-text-primary",
                  )}
                >
                  {mode === "newest" ? "Newest" : "Relevant"}
                </button>
              ))}
            </div>
          </div>

          {displayedArticles.length === 0 ? (
            (() => {
              /* Read state is checked FIRST. A read that has not finished, or
                 that faulted, is never an empty answer, and every branch below
                 this point is an answer. */
              if (loading) {
                /* The LIST read has not landed. "Your feed is empty" below is
                   an answer, and there is no answer yet. */
                return <FeedReadSkeleton />;
              }
              if (listFailed) {
                // The left column already names this. One statement, not two.
                return null;
              }
              if (feedStatus === "pending") {
                return <FeedReadSkeleton />;
              }
              if (feedStatus === "failed") {
                if (selectedIdentifier) {
                  const entry = watchlist.find((e) => e.identifier === selectedIdentifier);
                  const name = entry?.display_name || selectedDisplayLabel || selectedIdentifier;
                  return (
                    <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                      <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">Articles unavailable for {name}</p>
                      <p className="font-sans text-[12px] text-text-secondary">The read did not complete.</p>
                    </div>
                  );
                }
                return (
                  <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                    <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">Watchlist articles unavailable</p>
                    <p className="font-sans text-[12px] text-text-secondary">The read did not complete.</p>
                  </div>
                );
              }
              if (watchlist.length === 0) {
                return (
                  <div className="bg-parchment-mid border border-border-base rounded-xl p-5 text-center">
                    <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">Your feed is empty</p>
                    {/* THE COPY HAS TO NAME SOMETHING THE READER CAN SEE.
                        Below 768px the left column is `display: none`, so
                        "in the left panel" pointed at nothing and the one add
                        control on the screen is inside the drawer the button
                        at the foot opens. Two sentences, each true at its own
                        width, rather than one sentence true at neither. */}
                    <p className="font-sans text-[12px] text-text-secondary">
                      {isMobile
                        ? "Open the Watchlist button below to add tickers, companies, or sectors and start tracking articles."
                        : "Add tickers, companies, or sectors in the left panel to start tracking articles."}
                    </p>
                  </div>
                );
              }
              if (selectedIdentifier) {
                const entry = watchlist.find(e => e.identifier === selectedIdentifier);
                const entryAgeMs = entry?.created_at ? Date.now() - new Date(entry.created_at).getTime() : Infinity;
                const ONE_HOUR_MS = 60 * 60 * 1000;
                if (entryAgeMs < ONE_HOUR_MS) {
                  return (
                    <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                      <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">Syncing…</p>
                      <p className="font-sans text-[12px] text-text-secondary">
                        Articles will appear after the next pipeline run (6am / 8pm PST).
                      </p>
                    </div>
                  );
                }
                if (entry?.type === "company") {
                  const name = entry.display_name || entry.identifier;
                  return (
                    <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                      <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">No recent coverage found for {name}</p>
                      <p className="font-sans text-[12px] text-text-secondary">
                        We search Exa, Finnhub, and GDELT twice daily.
                      </p>
                    </div>
                  );
                }
                if (entry?.type === "ticker") {
                  return (
                    <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                      <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">No recent coverage found for {selectedIdentifier}</p>
                      <p className="font-sans text-[12px] text-text-secondary">
                        Try checking back after the next sync.
                      </p>
                    </div>
                  );
                }
              }
              return (
                <div className="bg-parchment-mid border border-border-base rounded-xl p-5">
                  <p className="font-sans text-[13px] font-semibold text-text-primary mb-1">No matching articles found</p>
                  <p className="font-sans text-[12px] text-text-secondary">
                    Articles are ingested every morning and evening. Your watchlist feed will populate as matching coverage arrives.
                  </p>
                </div>
              );
            })()
          ) : (
            <div className="space-y-2">
              {displayedArticles.map((a) => (
                <div key={a.id} className="group card-hover-lift bg-white dark:bg-elevated border border-border-base dark:border-border-default rounded-xl p-3">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    {(a.industry_verticals ?? []).map((v) => (
                      <span key={v} className="font-sans text-[9px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                        {v}
                      </span>
                    ))}
                    {(a.activity_types ?? []).map((t) => (
                      <span key={t} className="font-sans text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        {t}
                      </span>
                    ))}
                    {a.source && <span className="font-sans text-[9px] text-text-muted">{a.source}</span>}
                    {a.id.startsWith("finnhub-") && (
                      <span className="font-sans text-[9px] text-text-faint">via Finnhub</span>
                    )}
                    {a.published_at && timeAgo(a.published_at) && (
                      <span className="font-sans text-[9px] text-text-faint ml-auto">{timeAgo(a.published_at)}</span>
                    )}
                  </div>
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block hover:opacity-80 transition-opacity"
                    >
                      <h4 className="font-sans text-[13px] font-semibold text-espresso leading-snug">
                        {a.title}
                      </h4>
                      {(!a.summary || a.summary.trim().length < 15) ? (
                        <span className="font-sans text-[9px] text-text-faint italic mt-0.5 block">
                          Headline only
                        </span>
                      ) : (
                        <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1 line-clamp-2">
                          {a.summary}
                        </p>
                      )}
                    </a>
                  ) : (
                    <div>
                      <h4 className="font-sans text-[13px] font-semibold text-espresso leading-snug">
                        {a.title}
                      </h4>
                      {(!a.summary || a.summary.trim().length < 15) ? (
                        <span className="font-sans text-[9px] text-text-faint italic mt-0.5 block">
                          Headline only
                        </span>
                      ) : (
                        <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1 line-clamp-2">
                          {a.summary}
                        </p>
                      )}
                    </div>
                  )}
                  <ArticleMemoActions
                    article={a}
                    trackHref={`/radar/calls?draft=${encodeURIComponent(a.title)}`}
                  />
                </div>
              ))}
              {/* Reads still landing. The list fills in as each one arrives
                  rather than waiting for the slowest of them. */}
              {feedStatus === "pending" && <FeedReadSkeleton />}
            </div>
          )}
        </div>
      </div>

      {/* Mobile drawer trigger. Sits ON TOP of the shell's tab bar band, never
          over it: see TABBAR_BAND. */}
      {isMobile && (
        <div style={{
          position: 'fixed', bottom: TABBAR_BAND, left: 0, right: 0,
          background: 'var(--elevated)', borderTop: '1px solid var(--border-base)',
          padding: '12px 16px', zIndex: 200,
          display: 'flex', gap: '8px',
        }}>
          <button
            type="button"
            onClick={() => setMobileSheetOpen(true)}
            style={{
              flex: 1, padding: '10px', borderRadius: '10px',
              /* 44px is the floor for a tap target. `padding` plus a
                 `minHeight` needs `boxSizing: border-box` for the two to
                 describe the same box, and the button has no border, so the
                 rendered height is exactly the larger of 44 and the content. */
              boxSizing: 'border-box', minHeight: '44px',
              background: 'var(--espresso)', color: 'var(--cream)',
              fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 600,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}
          >
            <Star size={14} />
            {listCountLabel("Watchlist")}
          </button>
        </div>
      )}

      {/* Mobile drawer backdrop. Stops at the top of the tab bar band so the
          four poles stay reachable while the drawer is open. */}
      {isMobile && mobileSheetOpen && (
        <div
          onClick={() => setMobileSheetOpen(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: TABBAR_BAND,
            zIndex: 300, background: 'rgba(30,20,10,0.4)',
          }}
        />
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <div style={{
          position: 'fixed', bottom: TABBAR_BAND, left: 0, right: 0,
          height: '60dvh', zIndex: 301,
          background: 'var(--elevated)', borderRadius: '14px 14px 0 0',
          borderTop: '1px solid var(--border-base)',
          /* Closed, the panel travels its own height PLUS the band, so it
             clears the viewport entirely instead of parking on the tab bar.
             `pointerEvents` is the belt to that brace: a panel mid-transition
             must not hit-test over a pole either. */
          transform: mobileSheetOpen
            ? 'translateY(0)'
            : `translateY(calc(100% + ${TABBAR_BAND}))`,
          pointerEvents: mobileSheetOpen ? 'auto' : 'none',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border-base)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {listCountLabel("Watchlist")}
            </span>
            <button
              type="button"
              onClick={() => setMobileSheetOpen(false)}
              /* 44px square. `border-box` so the padding is inside the
                 minimum rather than added to it. */
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-faint)', padding: '4px',
                boxSizing: 'border-box', minWidth: '44px', minHeight: '44px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <WatchlistAddInput
              addType={addType}
              onAddTypeChange={setAddType}
              onAdd={async (id, dn) => { await handleAdd(id, dn); setMobileSheetOpen(false); }}
              addError={addError}
              onClearError={() => setAddError("")}
              trackedIdentifiers={watchlist.map((e) => e.identifier)}
            />
            <div className="space-y-1.5">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
                </div>
              ) : listFailed ? (
                <EmptyState
                  icon={<Star size={32} />}
                  title="Watchlist unavailable"
                  description="The list could not be read."
                />
              ) : watchlist.length === 0 ? (
                <EmptyState
                  icon={<Star size={32} />}
                  title="Nothing tracked yet"
                  description="Add a ticker, company, or sector above"
                />
              ) : (
                <>
                  {watchlist.map((entry) => {
                    const count = chipCountFor(articleReads[entry.identifier]);
                    return (
                      <div
                        key={entry.id}
                        onClick={() => {
                          setSelectedIdentifier(sel => sel === entry.identifier ? null : entry.identifier);
                          setMobileSheetOpen(false);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '12px 14px', borderRadius: '12px',
                          /* Tokens, not literals: the drawer's own surface is
                             `--elevated` now, and a row painted a white
                             literal sat as a slab inside a dark panel. */
                          border: selectedIdentifier === entry.identifier ? '1px solid var(--gold)' : '1px solid var(--border-base)',
                          background: selectedIdentifier === entry.identifier ? 'var(--parchment-mid)' : 'var(--elevated)',
                          boxSizing: 'border-box', minHeight: '44px',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {entry.type === 'sector' ? entry.identifier : (entry.display_name ?? entry.identifier)}
                        </span>
                        <CountBadge count={count} />
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {dragError && (
        /* The toast is z-50, above the shell's z-40 bar. At bottom-4 it landed
           across the poles. It now floats clear of the band. */
        <div
          className="fixed left-1/2 -translate-x-1/2 bg-signal-dn text-white font-sans text-[11px] px-4 py-2 rounded-lg shadow-lg z-50"
          style={{ bottom: isMobile ? `calc(${TABBAR_BAND} + 16px)` : '16px' }}
        >
          {dragError}
        </div>
      )}

      {memoEntry && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoEntry(null)}
          title={memoEntry.identifier}
          content={buildWatchlistMemoContent(memoEntry, readyArticles[memoEntry.identifier])}
          type="company"
        />
      )}

      {articleMemoEntry && (
        <MemoModal
          isOpen={true}
          onClose={() => setArticleMemoEntry(null)}
          title={articleMemoEntry.title}
          content={withCompanyLine(
            `${articleMemoEntry.title}\n${articleMemoEntry.source ?? ""}`,
            articleMemoEntry.primary_company,
          )}
          type="article"
        />
      )}

      {showShortcutLegend && (
        <div
          className="fixed inset-0 z-[9998] bg-espresso/30 flex items-end justify-end p-6"
          onClick={() => setShowShortcutLegend(false)}
        >
          <div
            className="bg-white dark:bg-elevated border border-border-base dark:border-border-default rounded-xl p-5 shadow-2xl min-w-[220px]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-sans text-[9px] text-text-muted font-semibold mb-3">Keyboard shortcuts</p>
            <div className="space-y-1.5">
              {[
                { key: "J / K", desc: "Navigate" },
                { key: "Enter", desc: "Open" },
                { key: "A", desc: "Add ticker" },
                { key: "Esc", desc: "Clear selection" },
                { key: "?", desc: "This menu" },
              ].map(({ key, desc }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <kbd className="font-mono text-[10px] bg-parchment-mid border border-border-base rounded px-1.5 py-0.5 text-text-primary">{key}</kbd>
                  <span className="font-sans text-[11px] text-text-muted">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Shortcut hint button.
          GATED OUT BELOW md, AND FOR TWO REASONS THAT AGREE. It is fixed at
          bottom-6 right-6 on z-50, which is above the shell's z-40 tab bar: at
          390 its 32px box straddles the Browse pole's centre, so it is the
          SECOND thing that made a pole untappable and it would have survived
          the drawer fix on its own. It is also a 32px target listing J, K and
          Esc to a reader who has no keyboard. Desktop is untouched. */}
      <button
        type="button"
        onClick={() => setShowShortcutLegend(prev => !prev)}
        className="hidden md:flex fixed bottom-6 right-6 z-50 w-8 h-8 rounded-full bg-white dark:bg-elevated border border-border-base shadow-md items-center justify-center font-sans text-[12px] text-text-muted hover:text-espresso hover:border-gold transition-colors cursor-pointer"
        aria-label="Keyboard shortcuts"
      >
        ?
      </button>
    </AppShell>
  );
}

/** Single sortable watchlist row — wraps the row content in useSortable so
 *  both PointerSensor (desktop) and TouchSensor (mobile) can drive reorder.
 *  The drag handle owns the sensor listeners, so clicking the row body still
 *  triggers selection. */
function SortableEntryRow(props: {
  entry: WatchlistEntry;
  isSelected: boolean;
  isKeyboardActive: boolean;
  onSelect: () => void;
  subtitle: string | null;
  count: ChipCount;
  price?: WatchlistPrice;
  onGenerateMemo: () => void;
  onOpenBrief: () => void;
  onRemove: () => void;
  onPinToggle?: () => void;
  pinnedCount: number;
}): ReactNode {
  const {
    entry,
    isSelected,
    isKeyboardActive,
    onSelect,
    subtitle,
    count,
    price,
    onGenerateMemo,
    onOpenBrief,
    onRemove,
    onPinToggle,
    pinnedCount,
  } = props;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-entry-id={entry.id}
      onClick={onSelect}
      className={cn(
        "flex gap-3 px-4 py-3 border border-border-base rounded-xl group cursor-pointer transition-colors",
        "items-start min-h-[56px]",
        isKeyboardActive
          ? "border-l-2 border-l-amber-500 bg-amber-50/30"
          : isSelected
            ? "border-l-2 border-l-gold bg-gold-muted/30"
            : "bg-white dark:bg-elevated hover:border-border-hover",
        isDragging && "opacity-60 shadow-md z-10",
      )}
    >
      {/* Drag handle — owns sensor listeners so row click still selects */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="flex-shrink-0 self-center opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing px-1 text-text-faint touch-none"
        aria-label={`Reorder ${entry.identifier}`}
      >
        <GripVertical size={12} />
      </button>

      {/* PIN slot — fixed width so ticker and non-ticker rows align */}
      <div className="w-5 flex-shrink-0 self-center flex items-center justify-center">
        {entry.type === "ticker" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (entry.pinned_position == null && pinnedCount >= 5) return;
              onPinToggle?.();
            }}
            disabled={entry.pinned_position == null && pinnedCount >= 5}
            title={
              entry.pinned_position != null
                ? `Pinned to slot ${entry.pinned_position}`
                : pinnedCount >= 5
                  ? "Max 5 pinned tickers"
                  : "Pin to dashboard widget"
            }
            className={cn(
              "flex items-center gap-1 p-1 rounded-md transition-colors",
              entry.pinned_position != null
                ? "text-gold hover:bg-parchment-mid cursor-pointer"
                : pinnedCount >= 5
                  ? "text-text-faint cursor-not-allowed opacity-40"
                  : "text-text-muted hover:bg-parchment-mid hover:text-text-primary cursor-pointer",
            )}
          >
            <Pin
              size={14}
              fill={entry.pinned_position != null ? "currentColor" : "none"}
              className="pointer-events-none"
            />
            {entry.pinned_position != null && (
              <span className="font-sans text-[9px] font-bold leading-none">
                {entry.pinned_position}
              </span>
            )}
          </button>
        )}
      </div>

      {/* LEFT: identifier + optional display_name subtitle */}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="font-data text-[13px] font-bold text-text-primary truncate">
          {entry.identifier}
        </span>
        {subtitle && (
          <span className="font-sans text-[9px] text-text-faint">{subtitle}</span>
        )}
      </div>

      {/* RIGHT: article count, price, hover actions, chevron */}
      <div className="flex items-center gap-2 flex-shrink-0 self-center">
        <CountBadge count={count} />
        {entry.type === "ticker" && price && (
          <span className={cn("font-data text-[11px] tabular-nums", price.pct >= 0 ? "text-signal-up" : "text-signal-dn")}>
            ${price.price} <span className="text-[10px]">{price.pct >= 0 ? "+" : ""}{price.pct}%</span>
          </span>
        )}
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={onGenerateMemo} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Generate memo">
            <Sparkles size={11} className="text-gold" />
          </button>
          <button type="button" onClick={onOpenBrief} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Open brief">
            <ExternalLink size={11} className="text-text-muted" />
          </button>
          <button type="button" onClick={onRemove} className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer" aria-label="Remove">
            <Trash2 size={11} className="text-text-faint hover:text-signal-dn" />
          </button>
        </div>
        <ChevronRight size={10} className="text-text-faint" />
      </div>
    </li>
  );
}
