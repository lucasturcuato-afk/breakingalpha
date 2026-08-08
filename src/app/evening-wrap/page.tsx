"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { AppShell } from "@/components/shell";
import { PanelWidget } from "@/components/shell/right-panel";
import { TickerStrip } from "@/components/brief/ticker-strip";
import CatalystStrip, { type CatalystItem } from "@/components/brief/CatalystStrip";
import { MorningReview } from "@/components/brief/morning-review";
import { ExportMenu } from "@/components/brief/export-menu";
import { ShareButton } from "@/components/brief/share-button";
import { DCStoryRow } from "@/components/brief/dc-story-row";
import WatchlistBriefSection from "@/components/brief/WatchlistBriefSection";
import BriefCallsSection from "@/components/brief/BriefCallsSection";
import { SentimentPill } from "@/components/ui/sentiment-pill";
import type { WatchlistBriefSection as WatchlistSectionData } from "@/lib/watchlist-brief";
import { sessionIngestFloor, publishedFloor, storiesHeadingLabel, storedRailIds, reorderByIds } from "@/lib/story-rail-window";
import { DCAnalystSection } from "@/components/brief/dc-analyst-section";
import { DCSectorSignals } from "@/components/brief/dc-sector-signals";
import { ActiveThesesWidget } from "@/components/dashboard/active-theses-widget";
import { WatchlistWidget } from "@/components/dashboard/watchlist-widget";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { stripHtml } from "@/lib/strip-html";
import { sectionText } from "@/lib/brief-sections";
import { makeCallLink } from "@/lib/make-call-link";
import { reconcileCloseWord } from "@/lib/tape-adjective";
import { Moon } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useRouter } from "next/navigation";
import { MemoModal } from "@/components/memo/MemoModal";
import { getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import type { StoryData } from "@/components/dashboard";
import { createBrowserClient } from "@supabase/ssr";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useLiveMood } from "@/hooks/useLiveMood";
import { sortByRelevance, isOnWatchlist } from "@/lib/personalization";
import { applyRailPersonalization, getPersonalizationMode } from "@/lib/personalization-rail";
import { trackClientEvent } from "@/lib/track-event";
import type { ContentDescriptor } from "@/lib/personalization";
import { PersonalizationBanner } from "@/components/personalization/PersonalizationBanner";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const SECTION_TITLES: Record<string, string> = {
  deals_and_ma: "Deals & M&A",
  public_markets: "Public Markets",
  macro_and_rates: "Macro & Rates",
  sector_spotlight: "Sector Spotlight",
  geopolitics: "Geopolitics",
  what_to_watch: "What to Watch",
  tomorrow_setup: "Tomorrow's Setup",
  closing_thoughts: "Closing Thoughts",
};

const MOVERS_TAB_ORDER = [
  "public_markets",
  "deals_and_ma",
  "sector_spotlight",
  "macro_and_rates",
  "geopolitics",
  "closing_thoughts",
];

// Scorecard uses actual index + front-month futures tickers so the label
// and the number agree (ETFs like SPY trade at ~$580 — five-digit indices
// they are not). Finnhub's free tier doesn't return caret/futures symbols,
// so /api/watchlist-quotes falls back to Yahoo for these.
const SCORECARD_SYMBOLS = [
  { sym: "^GSPC", label: "S&P 500" },
  { sym: "^IXIC", label: "NASDAQ" },
  { sym: "^DJI",  label: "DOW" },
  { sym: "^RUT",  label: "RUSSELL" },
  { sym: "^TNX",  label: "10Y YIELD", invert: true },
  { sym: "CL=F",  label: "WTI" },
] as const;

// Sherwood Direction C palette — pinned literals for the values that
// must remain constant across light + dark. The theme flips --espresso
// to a near-white and --cream to near-black under html.dark, which
// would invert the dark hero card and desaturate the gold masthead.
const HERITAGE_GOLD = "#d4a84b";
const DC_ESPRESSO = "#1a1208";
const DC_CREAM = "#fffdf9";

interface SectorReflection { sector: string; verdict: "correct" | "wrong" | "partial"; paragraph: string; }
interface TickerReflection { symbol: string; verdict: "correct" | "wrong" | "partial"; paragraph: string; }
interface MorningReviewShape {
  aggregate_sentence?: string;
  sector_reflections?: SectorReflection[];
  ticker_reflection?: TickerReflection | null;
}

interface BriefingData {
  id?: string;
  headline?: string;
  summary?: string;
  lead_paragraph?: string;
  supporting_context?: string;
  what_to_watch?: string;
  market_tone?: string;
  sections?: Record<string, string>;
  sector_breakdown?: Record<string, string>;
  created_at?: string;
  market_pulse?: {
    sentiment_word: string | null;
    narrative: string;
    headlines?: Array<{ title: string; href?: string }>;
  } | null;
  morning_review?: MorningReviewShape | null;
  macro_panel?: { catalysts?: CatalystItem[] } | null;
  market_tape?: MarketTape | null;
}

// Persisted per-session index/regime snapshot written by the pipeline
// (backend/market_tape.py) onto the briefings row. This is the ARCHIVE of what
// the tape looked like at that session's close. The evening-wrap index panel
// and Close pill render from THIS, not a view-time live re-fetch, so a
// historical wrap shows its own session close forever. Shape mirrors the
// persisted jsonb: as_of ISO, regime, per-index {pct, level}, plus vix.
interface TapeIndex { pct: number; level: number }
interface MarketTape {
  as_of?: string;
  regime?: string;
  indices?: {
    sp500?: TapeIndex;
    nasdaq?: TapeIndex;
    dow?: TapeIndex;
    russell?: TapeIndex;
  };
  vix_pct?: number;
  vix_level?: number;
  // 10Y + WTI persisted so the panel and the prose AGREE on the archive. The
  // backend (backend/market_tape.py serialize_tape_snapshot) promotes these to
  // a stable top level; the nested `enrichment` block is the fallback for rows
  // persisted before the promotion shipped (they already carry enrichment).
  rates?: { teny_level?: number | null; teny_bps_change?: number | null } | null;
  oil?: { wti_level?: number | null; wti_pct?: number | null } | null;
  enrichment?: {
    rates?: { teny_level?: number | null; teny_bps_change?: number | null } | null;
    oil?: { wti_level?: number | null; wti_pct?: number | null } | null;
  } | null;
}

// Maps the scorecard's Yahoo-style symbol to the persisted tape's index key.
// The four equity indices persist under `indices`; 10Y yield and WTI persist as
// their own top-level `rates` / `oil` fields (see snapshotCell), so all six
// cells resolve from the archive on a historical wrap.
const SYM_TO_TAPE_KEY: Record<string, keyof NonNullable<MarketTape["indices"]>> = {
  "^GSPC": "sp500",
  "^IXIC": "nasdaq",
  "^DJI": "dow",
  "^RUT": "russell",
};

function storyToContent(story: StoryData): ContentDescriptor {
  return {
    sectors: [story.sector].filter(Boolean) as string[],
    tickers: story.tags ?? [],
    title: story.title,
  };
}

type Tone = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "WATCH";

function normaliseTone(t?: string | null): Tone {
  if (!t) return "NEUTRAL";
  const l = t.toLowerCase();
  if (l.includes("bull") || l === "positive" || l.includes("risk-on")) return "BULLISH";
  if (l.includes("bear") || l === "negative" || l.includes("risk-off")) return "BEARISH";
  if (l.includes("mix")) return "MIXED";
  if (l.includes("watch")) return "WATCH";
  return "NEUTRAL";
}


function formatDatePretty(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function formatTimePretty(d: Date): string {
  // Client component: renders in the viewer's own timezone, with the zone
  // abbreviation derived from the SAME format call as the time so the label
  // can never disagree with the displayed clock (was a hardcoded " ET").
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

export default function EveningWrapPage() {
  const { profile } = useUserProfile();
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLabel, setStoriesLabel] = useState("Today's Top Stories");
  const [isStale, setIsStale] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<"success" | "stub" | "error" | null>(null);
  const [sectionRatings, setSectionRatings] = useState<Record<string, number>>({});
  const [leadMemoOpen, setLeadMemoOpen] = useState(false);
  const [leadMemoContent, setLeadMemoContent] = useState("");
  const [formatLabel, setFormatLabel] = useState<string | null>(null);
  const [userAddendum, setUserAddendum] = useState<string | null>(null);
  const [watchlistSection, setWatchlistSection] = useState<WatchlistSectionData | null>(null);
  const [watchlistStatus, setWatchlistStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [briefOutputId, setBriefOutputId] = useState<string | null>(null);
  const [sectionOutputIds, setSectionOutputIds] = useState<Record<string, string>>({});
  const [user, setUser] = useState<{ id: string; email?: string | null } | null>(null);
  const [thesesCount, setThesesCount] = useState<number | null>(null);
  const [vixQuote, setVixQuote] = useState<{ price: string; pct: number } | null>(null);
  const [scorecard, setScorecard] = useState<Record<string, { price: string; pct: number } | null>>({});
  const router = useRouter();

  // Banner mood comes from the global SSOT — same numbers + canonical 5-term
  // pill as every other route. The wrap hero reads
  // `briefing.market_pulse.sentiment_word`, which the backend now grounds in
  // the SAME deterministic regime ladder (backend/market_tape.py mirrors
  // src/lib/market-regime.ts), so the prose vocabulary differs but the
  // direction cannot contradict the banner on a grounded day.
  const liveMood = useLiveMood();

  useEffect(() => {
    getSupabase()
      .auth.getUser()
      .then(({ data }) => {
        setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
      })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    fetch("/api/brief-rating")
      .then(r => r.json())
      .then(d => setSectionRatings(d.ratings ?? {}))
      .catch(() => {});
  }, []);

  function handleSectionRate(sectionKey: string, rating: 1 | -1) {
    setSectionRatings(prev => ({ ...prev, [sectionKey]: rating }));
    trackClientEvent("brief_section_rated", { section_key: sectionKey, rating });
    fetch("/api/brief-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section_key: sectionKey, rating }),
    }).catch(() => {});
  }

  useEffect(() => {
    async function load() {
      try {
        const supabase = getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = {};
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }
        const res = await fetch("/api/briefing?type=evening", { headers });

        // The wrap-open event is emitted downstream, once the rail order is
        // known. See the emit-once effect below rankedStories.

        const data = await res.json();
        if (data.briefing) {
          const b = data.briefing;
          const sections = typeof b.sections === "string" ? JSON.parse(b.sections) : b.sections;
          const sectorBreakdown = typeof b.sector_breakdown === "string" ? JSON.parse(b.sector_breakdown) : b.sector_breakdown;
          const marketPulse = (() => {
            const mp = b.market_pulse;
            if (!mp) return null;
            if (typeof mp === "string") { try { return JSON.parse(mp); } catch { return null; } }
            return mp;
          })();
          const morningReview: MorningReviewShape | null =
            b.morning_review && typeof b.morning_review === "object"
              ? (b.morning_review as MorningReviewShape)
              : null;
          const macroPanel = (() => {
            const m = b.macro_panel;
            if (!m) return null;
            if (typeof m === "string") { try { return JSON.parse(m); } catch { return null; } }
            return m;
          })();
          setBriefing({
            id: b.id,
            headline: b.headline,
            summary: b.summary,
            lead_paragraph: b.lead_paragraph,
            supporting_context: b.supporting_context,
            what_to_watch: b.what_to_watch,
            market_tone: b.market_tone,
            sections: sections || {},
            sector_breakdown: sectorBreakdown || {},
            created_at: b.created_at,
            market_pulse: marketPulse,
            morning_review: morningReview,
            macro_panel: macroPanel,
            market_tape: (() => {
              const t = b.market_tape;
              if (!t) return null;
              if (typeof t === "string") { try { return JSON.parse(t) as MarketTape; } catch { return null; } }
              return t as MarketTape;
            })(),
          });
          setIsStale(data.is_stale === true);
          if (data.last_attempt_status) setLastRunStatus(data.last_attempt_status);
          if (data.personalization?.format_label) setFormatLabel(data.personalization.format_label);
          if (typeof data.user_addendum === "string") setUserAddendum(data.user_addendum);
          if (data.brief_output_id) setBriefOutputId(data.brief_output_id);
          if (data.section_output_ids) setSectionOutputIds(data.section_output_ids);
        }

        const SELECT_FIELDS = "id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, relevance_score";
        const createdAtForLabel = data.briefing?.created_at ?? null;
        const anchorIso = createdAtForLabel ?? new Date().toISOString();

        // Transition fallback ONLY (defect #1, Option A): the live session-window
        // query. Used when a brief has no persisted rail yet (legacy briefs, or a
        // generation that did not persist IDs). Safe to delete once every live
        // brief is B-generated. Do NOT delete story-rail-window.ts.
        const windowFallback = async () => {
          const ingestFloor = await sessionIngestFloor(getSupabase(), "evening", anchorIso);
          const publishedFloor7d = publishedFloor(anchorIso);
          const { data: rows } = await getSupabase()
            .from("articles")
            .select(SELECT_FIELDS)
            .gte("ingested_at", ingestFloor)
            .lte("ingested_at", anchorIso)
            .gte("published_at", publishedFloor7d)
            .order("relevance_score", { ascending: false })
            .order("published_at", { ascending: false })
            .limit(8);
          return rows;
        };

        // Option B (sole go-forward mechanism): render the reproducible,
        // identity-deduped snapshot the backend persisted on this brief row.
        // The rail no longer computes its own selection. Fetch the stored IDs'
        // articles and restore render order.
        const railIds = await storedRailIds(getSupabase(), data.briefing?.id);
        const articles = railIds
          ? reorderByIds(
              (await getSupabase().from("articles").select(SELECT_FIELDS).in("id", railIds)).data ?? [],
              railIds,
            )
          : await windowFallback();

        const quiet = (articles?.length ?? 0) < 3;
        const label = storiesHeadingLabel(createdAtForLabel, "Today's Top Stories", quiet);
        setStoriesLabel(label);

        if (articles) {
          const uniqueSources = [...new Set(articles.map(a => a.source).filter(Boolean) as string[])];
          let credMap = new Map<string, { winRate: number; nTheses: number | null }>();
          if (uniqueSources.length > 0) {
            try {
              const { data: credData } = await getSupabase()
                .from("source_credibility")
                .select("source, win_rate, n_theses")
                .in("source", uniqueSources);
              credMap = new Map(
                credData?.map(r => [r.source, { winRate: r.win_rate, nTheses: r.n_theses ?? null }]) ?? [],
              );
            } catch { /* soft-fail */ }
          }

          setStories(articles.map((a) => {
            const completeness = getCompleteness(a.content, a.summary);
            const companies = parseCompanies(a.companies);
            return {
              id: a.id,
              title: a.title || "Untitled",
              source: a.source || "Unknown",
              timestamp: timeAgo(a.published_at || a.ingested_at),
              sentiment: sentimentFromDb(a.sentiment),
              sector: a.sector || undefined,
              summary: a.summary || undefined,
              tags: companies.slice(0, 3),
              companies,
              url: a.url || undefined,
              read: false,
              saved: false,
              completeness,
              adjustedScore: getAdjustedScore(a.relevance_score ?? null, completeness),
              sourceWinRate: credMap.get(a.source)?.winRate ?? null,
              sourceSampleSize: credMap.get(a.source)?.nTheses ?? null,
            };
          }));
        }

        try {
          const { count } = await getSupabase()
            .from("theses")
            .select("id", { count: "exact", head: true });
          if (typeof count === "number") setThesesCount(count);
        } catch { /* soft-fail */ }

        // Scorecard + VIX. Index symbols (^VIX, ^TNX) are url-encoded —
        // Finnhub returns nothing for plain "VIX". VIXY is included as a
        // proxy fallback so the stats-bar VIX cell always shows a value.
        try {
          const requested = [...SCORECARD_SYMBOLS.map((s) => s.sym), "^VIX", "VIXY"];
          const qr = await fetch(`/api/watchlist-quotes?symbols=${encodeURIComponent(requested.join(","))}`);
          if (qr.ok) {
            const qd = await qr.json();
            const next: Record<string, { price: string; pct: number } | null> = {};
            for (const s of SCORECARD_SYMBOLS) {
              const q = qd?.quotes?.[s.sym];
              next[s.sym] = q
                ? {
                    price: typeof q.price === "number"
                      ? q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : String(q.price ?? "—"),
                    pct: q.pct ?? 0,
                  }
                : null;
            }
            setScorecard(next);
            const vx = qd?.quotes?.["^VIX"] ?? qd?.quotes?.VIXY;
            if (vx) {
              setVixQuote({
                price: typeof vx.price === "number"
                  ? vx.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : String(vx.price ?? "—"),
                pct: vx.pct ?? 0,
              });
            }
          }
        } catch { /* soft-fail */ }
      } catch (e) {
        console.error("Failed to load briefing:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Watchlist section — independent, fail-soft fetch. Mirrors the briefing
  // fetch: resolve the session opportunistically but NEVER block on it, and
  // ALWAYS hit the API with credentials:"include" so the server resolves the
  // user from cookies if getSession loses the race. Reports an explicit status
  // so an error is distinct from "no news"; the wrap never blocks on it.
  useEffect(() => {
    let cancelled = false;
    setWatchlistStatus("loading");
    (async () => {
      const session = await Promise.race([
        getSupabase().auth.getSession().then((r) => r.data.session ?? null).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
      ]);
      const headers: HeadersInit = { Accept: "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const doFetch = () =>
        fetch("/api/watchlist-brief?type=evening", {
          headers,
          credentials: "include",
          cache: "no-store",
        });

      try {
        let res: Response;
        try {
          res = await doFetch();
          if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        } catch {
          // One bounded retry on a network error or 5xx (transient cold start).
          await new Promise((r) => setTimeout(r, 400));
          res = await doFetch();
        }
        if (cancelled) return;
        if (res.status === 401) {
          setWatchlistStatus("loaded");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as WatchlistSectionData;
        if (cancelled) return;
        if (data && typeof data.state === "string") {
          setWatchlistSection(data);
          setWatchlistStatus("loaded");
        } else {
          setWatchlistStatus("error");
        }
      } catch (e) {
        if (!cancelled) {
          console.warn("[watchlist-brief] section fetch failed:", e);
          setWatchlistStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Evening Analysis sections — whitelist + canonical order. Sector
  // Signals is rendered as its own section below, so it is NOT folded
  // into this list. tomorrow_setup is handled by its own Tomorrow's
  // Setup section further down.
  const analystSections = useMemo(() => {
    const s = briefing?.sections || {};
    const out: { key: string; title: string; content: string }[] = [];
    for (const key of MOVERS_TAB_ORDER) {
      if (key === "tomorrow_setup") continue;
      // Same unguarded .trim() that took /morning-brief down on 2026-08-07.
      const content = sectionText(s[key]);
      if (content.trim()) {
        out.push({ key, title: SECTION_TITLES[key] || key, content });
      }
    }
    return out;
  }, [briefing]);

  const rankedStories = useMemo(() => {
    if (!profile) return stories;
    // Baseline = the existing per-user relevance order (prod behavior, untouched).
    // PERSONALIZATION_MODE then gates the Layer 1 rail reorder: off returns the
    // baseline unchanged (byte-identical), shadow logs the real before/after id
    // ordering and serves the baseline, active serves the personalized order.
    // applyRailPersonalization is fail-closed and never throws.
    const baseline = sortByRelevance(stories, profile, storyToContent);
    return applyRailPersonalization(
      baseline,
      { watchlist_tickers: profile.watchlist_tickers, sectors: profile.sectors },
      getPersonalizationMode(),
    );
  }, [stories, profile]);

  // Wrap-open telemetry. Deliberately NOT fired alongside the /api/briefing
  // request: at that point neither the briefing id nor the rail exists, which
  // is why every one of the 593 historical evening_wrap_opened rows landed
  // with an empty payload and the rail reorder was unmeasurable.
  //
  // Emits once per briefing id, after the rail order is settled, carrying the
  // ids in served order plus the personalization mode that produced them. That
  // is the pair needed to attribute downstream clicks back to a rail variant.
  const briefOpenEmittedFor = useRef<string | null>(null);
  useEffect(() => {
    const briefingId = briefing?.id;
    if (!user || !briefingId) return;
    if (rankedStories.length === 0) return;
    if (briefOpenEmittedFor.current === briefingId) return;
    briefOpenEmittedFor.current = briefingId;

    trackClientEvent(
      "wrap.page.opened",
      {
        briefing_id: briefingId,
        brief_date: briefing?.created_at ?? null,
        brief_type: "evening",
        story_count: rankedStories.length,
        rail_order: rankedStories.map((s) => s.id),
        personalization_mode: getPersonalizationMode(),
        // Whether the rail could be personalized at all. With no profile the
        // served order is the shared baseline regardless of mode.
        rail_personalizable: !!profile,
      },
      { entity_type: "briefing", entity_id: briefingId },
    );

    // Legacy name kept in parallel so the five existing user_events consumers
    // (user_signal_aggregator, profile/insights, collective-signals,
    // updateInferredWeights, internal dashboard views) see no change. Drop this
    // once those move to the dotted names.
    trackClientEvent("evening_wrap_opened", { briefing_id: briefingId });
  }, [user, briefing?.id, briefing?.created_at, rankedStories, profile]);

  const tone = normaliseTone(briefing?.market_tone);
  // Use a stable epoch fallback to avoid SSR/client hydration mismatch (#418).
  // Real briefings always carry created_at; the fallback only guards null edges.
  const [fallbackDate] = useState(() => new Date());
  const now = briefing?.created_at ? new Date(briefing.created_at) : fallbackDate;
  const dateStr = formatDatePretty(now);
  const timeStr = formatTimePretty(now);

  // ── ARCHIVE INTEGRITY: index panel + Close pill render from the PERSISTED
  // per-session snapshot, not a view-time live re-fetch. ─────────────────────
  // The `scorecard` state above is a LIVE /api/watchlist-quotes pull, so an old
  // wrap opened today used to show TODAY's numbers (a Jul 9 wrap opened Jul 10
  // rendered Jul 10 index levels and Jul 10's close word). The pipeline persists
  // the tape it saw at THIS brief's close on briefing.market_tape; that is the
  // source of truth for what this session looked like and must be shown forever.
  //
  // Live re-fetch is allowed ONLY when the brief's session IS the current
  // session: a wrap viewed on its own trading day may show live intraday drift.
  // A historical wrap must NOT. We compare the persisted tape's as_of ET
  // calendar day to the current ET calendar day; equal => current session.
  // NOTE: this is a BRIEF-ARTIFACT gate only. The global mood ticker
  // (useLiveMood, site chrome) stays live and is deliberately untouched here.
  const tape = briefing?.market_tape ?? null;
  const etDay = (d: Date | null) =>
    d && !isNaN(d.getTime())
      ? d.toLocaleDateString("en-CA", { timeZone: "America/New_York" })
      : null;
  const tapeAsOf = tape?.as_of ? new Date(tape.as_of) : null;
  const isCurrentSession =
    tapeAsOf !== null && etDay(tapeAsOf) === etDay(new Date());

  // Resolve a scorecard cell for a symbol: prefer the PERSISTED tape (archive),
  // fall back to LIVE only when this brief IS the current session. All six
  // symbols persist now (four indices + 10Y + WTI), so a historical wrap renders
  // its own session's close from the snapshot instead of a dash or a live
  // substitution. Only rows persisted before enrichment landed lack 10Y/WTI;
  // those still degrade to an honest dash.
  // The persisted 10Y (rates) and WTI (oil) live at the snapshot top level, with
  // the nested `enrichment` block as a fallback for rows written before that
  // promotion shipped (they already carry enrichment). Read either shape.
  const tapeRates = tape?.rates ?? tape?.enrichment?.rates ?? null;
  const tapeOil = tape?.oil ?? tape?.enrichment?.oil ?? null;

  const snapshotCell = (
    sym: string,
  ): { price: string; pct: number } | null => {
    const key = SYM_TO_TAPE_KEY[sym];
    const idx = key ? tape?.indices?.[key] : undefined;
    if (idx && typeof idx.level === "number" && typeof idx.pct === "number") {
      return {
        price: idx.level.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        pct: idx.pct,
      };
    }
    // 10Y yield: persisted as teny_level (percent, ~4.6) + teny_bps_change (bps).
    // The cell's change axis is a percent move, so convert the bps move to the
    // yield instrument's daily percent change (bps / level) to match how the
    // live cell renders. Price passes through the ^TNX display path unchanged
    // (a ~4.6 value < 20 renders as "4.60%").
    if (sym === "^TNX" && tapeRates && typeof tapeRates.teny_level === "number") {
      const level = tapeRates.teny_level;
      const bps = typeof tapeRates.teny_bps_change === "number" ? tapeRates.teny_bps_change : 0;
      const pct = level !== 0 ? bps / level : 0;
      return {
        price: level.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        pct,
      };
    }
    // WTI: persisted as wti_level ($) + wti_pct (daily %). Direct match to the
    // cell's price/pct contract.
    if (sym === "CL=F" && tapeOil && typeof tapeOil.wti_level === "number") {
      return {
        price: tapeOil.wti_level.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        pct: typeof tapeOil.wti_pct === "number" ? tapeOil.wti_pct : 0,
      };
    }
    // No persisted value for this symbol. Live is honest only for the current
    // session; a historical wrap gets null (renders a dash), never live.
    return isCurrentSession ? scorecard[sym] ?? null : null;
  };

  // True legacy brief: no persisted tape at all. The panel then renders an
  // honest "snapshot unavailable" state instead of a live substitution, EXCEPT
  // when the brief is the current session (live intraday is honest there).
  const snapshotUnavailable = tape === null && !isCurrentSession;

  // Feed the Close pill from the SAME resolved snapshot as the panel, so the
  // pill above the grid can never derive from a different (live) tape than the
  // numbers beneath it. On a historical wrap this is the persisted S&P/Russell;
  // on the current session it is live; on a legacy no-tape wrap both spx and
  // russell are null and reconcileCloseWord degrades to no verdict.
  const pillSpx = snapshotCell("^GSPC")?.pct;
  const pillRussell = snapshotCell("^RUT")?.pct;

  // Close verdict comes from the tape-grounded sentiment_word, then passes a
  // presentation-layer truth gate. The backend word is minted from a VIX/SPX
  // regime ladder that never looks at breadth (backend/market_tape.py), so a
  // narrow up-drift (S&P green, Russell red) could still render "buoyant"
  // directly above prose saying small-caps lagged. reconcileCloseWord() keeps
  // the grounded word when it is consistent with the ACTUAL persisted tape
  // (S&P magnitude + Russell breadth), and substitutes an honest word only when
  // the backend word overclaims. When the backend could not ground the word AND
  // we have no tape, it ships null and the hero renders without a verdict rather
  // than asserting a fabricated tone. Never default to "mixed" or to the LLM
  // market_tone here.
  const closeWord = reconcileCloseWord(
    briefing?.market_pulse?.sentiment_word || null,
    {
      spxPct: pillSpx,
      russellPct: pillRussell,
    },
  );
  const closeBody =
    briefing?.market_pulse?.narrative
    || briefing?.summary
    || briefing?.lead_paragraph
    || "Today's session has closed. Detailed close commentary will appear here once the post-market synthesis lands.";
  const tomorrowSetupContent = briefing?.sections?.tomorrow_setup;

  // Tomorrow's Setup dual-mode detection: if the backend delivers a
  // single prose paragraph, render narrative. If it delivers multiple
  // structured paragraphs (<p>…</p><p>…</p> or blank-line separated),
  // render a structured row list.
  const tomorrowSetupEvents = (html: string): { lead: string; rest: string }[] => {
    if (!html) return [];
    const paragraphs = html
      .split(/<\/p>\s*<p[^>]*>|\n\n+/)
      .map((p) => stripHtml(p).trim())
      .filter(Boolean);
    return paragraphs.slice(0, 6).map((p) => {
      const m = p.match(/^([^.;:]+[.;:])\s*(.*)$/);
      if (m) return { lead: m[1].trim(), rest: m[2] ? " " + m[2] : "" };
      return { lead: p, rest: "" };
    });
  };
  const tomorrowEvents = tomorrowSetupContent ? tomorrowSetupEvents(tomorrowSetupContent) : [];
  const tomorrowIsNarrative = tomorrowEvents.length <= 1;

  // Lead body fallback — if a structured field is null, try to fill it
  // from the corresponding third of the prose summary. If the summary is
  // also absent, drop the card entirely so the grid collapses to 2 or 1
  // cols rather than rendering an empty card with just "—".
  const splitIntoThree = (raw: string): [string, string, string] => {
    const text = stripHtml(raw).trim();
    if (!text) return ["", "", ""];
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length <= 1) return [text, "", ""];
    const third = Math.ceil(sentences.length / 3);
    return [
      sentences.slice(0, third).join(" "),
      sentences.slice(third, third * 2).join(" "),
      sentences.slice(third * 2).join(" "),
    ];
  };
  const summaryThirds = splitIntoThree(briefing?.summary || briefing?.headline || "");
  const leadCards = ([
    { label: "The Story",     body: briefing?.lead_paragraph     || summaryThirds[0] },
    { label: "The Context",   body: briefing?.supporting_context || summaryThirds[1] },
    { label: "What to Watch", body: briefing?.what_to_watch      || summaryThirds[2] },
  ] as { label: string; body: string }[])
    .filter((c) => c.body && c.body.trim() && c.body.trim() !== "—")
    .map((c, i) => ({ ...c, n: String(i + 1) }));
  const leadGridCols =
    leadCards.length >= 3 ? "md:grid-cols-3"
    : leadCards.length === 2 ? "md:grid-cols-2"
    : "md:grid-cols-1";

  const handleAskAI = () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
  };

  // Option A consolidation: the lead action makes a CALL. The author flow on
  // /radar/calls proposes symbol/direction/window from this draft and the user
  // edits everything before committing; nothing is written by the click.
  const handleLeadMakeCall = () => {
    router.push(makeCallLink(briefing?.headline));
  };

  return (
    <AppShell
      pageTitle="Evening Wrap"
      mood={liveMood.mood}
      moodHeadline={liveMood.moodHeadline}
      moodDetails={liveMood.moodDetails}
      rightPanel={
        <>
          <PanelWidget title="Tracked Views">
            <ActiveThesesWidget />
          </PanelWidget>
          <PanelWidget title="Watchlist">
            <WatchlistWidget />
          </PanelWidget>
        </>
      }
    >
      <TickerStrip />
      <div className="px-6 pt-3">
        <PersonalizationBanner />
      </div>

      {/* Sherwood Direction C masthead — gold anchors the left and fades
          into the page's espresso body on the right (mirrors Morning
          Brief). Reversible: restore the 135deg two-stop gold gradient in
          the `background` string to return to the Direction A treatment.
          All colour values stay literal so the band reads identically in
          light + dark. */}
      <header
        style={{
          background: `linear-gradient(90deg, ${HERITAGE_GOLD} 0%, ${HERITAGE_GOLD} 30%, ${DC_ESPRESSO} 75%, ${DC_ESPRESSO} 100%)`,
          padding: "14px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <span
            className="font-[family-name:var(--font-playfair-display)]"
            style={{ fontSize: 26, fontWeight: 700, color: DC_CREAM, letterSpacing: "-0.01em", lineHeight: 1 }}
          >
            Signal<span style={{ color: DC_ESPRESSO }}>era</span>
          </span>
          <span style={{ width: 1, height: 20, background: "rgba(26,18,8,0.25)", alignSelf: "center" }} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span
              className="font-[family-name:var(--font-playfair-display)]"
              style={{ fontSize: 20, fontWeight: 700, color: DC_CREAM, letterSpacing: "-0.01em" }}
            >
              Evening Wrap
            </span>
            <span
              className="font-[family-name:var(--font-playfair-display)] italic"
              style={{ fontSize: 13, color: "rgba(255,253,249,0.78)", marginTop: 4, fontWeight: 400 }}
            >
              How the session played out — and what it meant.
            </span>
          </div>
        </div>
        <div
          className="font-sans"
          style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 11, color: "rgba(255,253,249,0.85)", fontWeight: 600 }}
        >
          <span>{dateStr}</span>
          <span className="font-sans">{timeStr}</span>
          <span style={{ background: "rgba(255,253,249,0.15)", color: "rgba(255,253,249,0.9)", padding: "4px 10px", borderRadius: 20, fontSize: 10 }}>
            5 min read
          </span>
        </div>
      </header>

      {/* Stats metadata bar */}
      <div
        style={{
          padding: "14px 32px",
          borderBottom: "1px solid var(--border-base)",
          background: "var(--cream)",
          display: "flex",
          alignItems: "center",
          gap: 36,
          flexWrap: "wrap",
        }}
      >
        {([
          { k: "Close", v: closeWord ? closeWord.toUpperCase() : "–", c: closeWord ? (tone === "BEARISH" ? "var(--signal-dn)" : tone === "BULLISH" ? "var(--signal-up)" : "var(--signal-warn)") : undefined, tip: "AI's verdict on how the day closed, grounded in actual index and futures data." },
          { k: "Movers", v: String(stories.length || "—"), tip: "Number of significant market-moving stories identified in today's session." },
          { k: "Theses", v: thesesCount !== null ? `${thesesCount} active` : "—", tip: "Investment theses currently being tracked and validated by Signalera." },
          {
            k: "VIX",
            v: vixQuote ? `${vixQuote.price} ${vixQuote.pct >= 0 ? "▲" : "▼"}${Math.abs(vixQuote.pct).toFixed(2)}%` : "—",
            c: vixQuote ? (vixQuote.pct >= 0 ? "var(--signal-dn)" : "var(--signal-up)") : undefined,
            tip: "CBOE Volatility Index — higher means more market fear, lower means lower expected volatility.",
          },
        ] as Array<{ k: string; v: string; c?: string; tip: string }>).map((x, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="font-sans" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, color: "var(--text-muted)" }}>
              {x.k}
              <InfoTooltip content={x.tip} side="bottom" iconSize={10} />
            </span>
            <span
              className="font-data"
              style={{ fontSize: 12, fontWeight: 700, color: x.c || "var(--espresso)", fontVariantNumeric: "tabular-nums" }}
            >
              {x.v}
            </span>
          </div>
        ))}
        <span style={{ flex: 1 }} />
        <span
          className="font-data"
          style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)", display: "inline-block" }} />
          CLOSED · Signalera Desk
        </span>
      </div>

      <div className="p-8">
        {loading ? (
          <div className="space-y-6">
            <Skeleton className="h-10 w-3/4" />
            <SkeletonText lines={3} />
            <div className="grid grid-cols-3 gap-5">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
            </div>
          </div>
        ) : !briefing ? (
          <EmptyState
            icon={<Moon size={32} />}
            title="No evening wrap available"
            description="The evening wrap will appear here once the market closes."
          />
        ) : (
          <>
            {/* ── EVENING WRAP top block — gold eyebrow label, Playfair
                date headline, muted Inter + mono timestamp subtitle. Sits
                between the stats bar and the Close hero. ── */}
            <section style={{ marginBottom: 28 }}>
              <p
                className="font-sans"
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  fontWeight: 800,
                  margin: "0 0 10px",
                }}
              >
                Evening Wrap
              </p>
              <h1
                className="font-[family-name:var(--font-playfair-display)]"
                style={{
                  fontSize: "clamp(30px, 3.8vw, 42px)",
                  fontWeight: 800,
                  lineHeight: 1.05,
                  color: "var(--espresso)",
                  margin: "0 0 10px",
                  letterSpacing: "-0.02em",
                }}
              >
                {dateStr}
              </h1>
              <p
                className="font-sans"
                style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}
              >
                {stories.length || "—"} stories worth your attention{" "}
                <span style={{ color: "var(--text-faint)" }}>·</span>{" "}
                <span className="font-data" style={{ fontSize: 12 }}>
                  Generated {timeStr} ·{" "}
                  {now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </p>
            </section>

            {/* ── The Close — dark espresso hero with 6-cell scorecard.
                All colours pinned to literals so the card stays dark in
                both themes. Always renders; verdict + body fall back to
                market_tone / summary so the card never disappears. ── */}
            <section style={{ marginBottom: 36 }}>
              <div
                style={{
                  background: DC_ESPRESSO,
                  borderRadius: 18,
                  padding: "32px 36px",
                  color: DC_CREAM,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    right: -60,
                    top: -60,
                    width: 260,
                    height: 260,
                    background: `radial-gradient(circle, ${HERITAGE_GOLD}60, transparent 70%)`,
                    pointerEvents: "none",
                  }}
                />
                <p
                  className="font-sans"
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    margin: "0 0 14px",
                    fontWeight: 700,
                    position: "relative",
                  }}
                >
                  The Close · {timeStr}
                  {" "}<InfoTooltip content="End-of-day market verdict with a scorecard of major indices, grounded in closing prices." side="right" iconSize={12} className="text-gold/40 hover:text-gold/70" />
                </p>
                <h2
                  className="font-[family-name:var(--font-playfair-display)]"
                  style={{
                    fontSize: "clamp(30px, 4vw, 44px)",
                    fontWeight: 800,
                    lineHeight: 1.05,
                    letterSpacing: "-0.025em",
                    margin: "0 0 20px",
                    color: DC_CREAM,
                    position: "relative",
                  }}
                >
                  {closeWord ? (
                    <>
                      The market closed{" "}
                      <span
                        style={{
                          background: HERITAGE_GOLD,
                          color: DC_ESPRESSO,
                          padding: "2px 14px",
                          borderRadius: 8,
                          display: "inline-block",
                          transform: "rotate(-1deg)",
                          boxShadow: "0 4px 0 rgba(0,0,0,0.15)",
                        }}
                      >
                        {closeWord}
                      </span>
                      .
                    </>
                  ) : (
                    <>The market closed.</>
                  )}
                </h2>
                <p
                  className="font-sans"
                  style={{
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "rgba(255,253,249,0.82)",
                    margin: "0 0 24px",
                    maxWidth: 640,
                    whiteSpace: "pre-line",
                    position: "relative",
                  }}
                >
                  {closeBody}
                </p>

                {/* Scorecard grid — sits inside the dark hero, so all
                    values are literal. Renders from the PERSISTED session tape
                    (archive integrity); a legacy wrap with no persisted tape
                    shows an honest "snapshot unavailable" state, never a live
                    view-time substitution. */}
                {snapshotUnavailable ? (
                  <div
                    className="font-sans"
                    style={{
                      background: "rgba(255,253,249,0.05)",
                      border: "1px solid rgba(212,168,75,0.2)",
                      borderRadius: 10,
                      padding: "18px 16px",
                      textAlign: "center",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "rgba(255,253,249,0.55)",
                      position: "relative",
                    }}
                  >
                    Index snapshot unavailable for this session.
                  </div>
                ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, 1fr)",
                    gap: 0,
                    background: "rgba(255,253,249,0.05)",
                    border: "1px solid rgba(212,168,75,0.2)",
                    borderRadius: 10,
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  {SCORECARD_SYMBOLS.map((s, i) => {
                    // Persisted-snapshot first (archive integrity); live only on
                    // the current session. 10Y and WTI now persist too, so they
                    // resolve from the snapshot on a historical wrap rather than
                    // rendering a dash.
                    const q = snapshotCell(s.sym);
                    const pct = q?.pct ?? 0;
                    const isLast = i === SCORECARD_SYMBOLS.length - 1;
                    // Direction and sentiment are separate axes. The glyph
                    // always reflects the raw sign of the move; the color
                    // keeps the invert semantics (a rising yield is bad for
                    // risk assets and renders red, but it is still an up
                    // move and gets an up arrow).
                    const up = pct >= 0;
                    const favorable = "invert" in s && s.invert ? pct < 0 : pct >= 0;
                    // ^TNX on Yahoo's chart API has historically been quoted
                    // as the yield × 10 (42.50 = 4.25%). The API currently
                    // returns the yield directly, but the guard defends
                    // against format regressions either way.
                    const displayPrice = (() => {
                      if (!q?.price) return "—";
                      if (s.sym !== "^TNX") return q.price;
                      const n = parseFloat(String(q.price).replace(/,/g, ""));
                      if (isNaN(n)) return q.price;
                      const normalized = n > 20 ? n / 10 : n;
                      return `${normalized.toFixed(2)}%`;
                    })();
                    return (
                      <div
                        key={s.sym}
                        style={{
                          padding: "14px 16px",
                          borderRight: isLast ? "none" : "1px solid rgba(212,168,75,0.15)",
                        }}
                      >
                        <p
                          className="font-sans"
                          style={{
                            fontSize: 9,
                            color: "rgba(255,253,249,0.55)",
                            margin: "0 0 6px",
                            fontWeight: 600,
                          }}
                        >
                          {s.label}
                        </p>
                        <p
                          className="font-data"
                          style={{ fontSize: 14, fontWeight: 700, color: DC_CREAM, margin: "0 0 4px", fontVariantNumeric: "tabular-nums" }}
                        >
                          {displayPrice}
                        </p>
                        <p
                          className="font-data"
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: q ? (favorable ? "#4ade80" : "#f87171") : "rgba(255,253,249,0.35)",
                            margin: 0,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {q ? `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%` : "–"}
                        </p>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            </section>

            {/* Morning-brief reflection — full card only renders when graded
                outcomes have actually landed. Otherwise we collapse to a
                single muted banner so the placeholder doesn't dominate the
                viewport on every brief that hasn't yet been graded. */}
            {briefing?.morning_review?.aggregate_sentence ? (
              <MorningReview review={briefing.morning_review} />
            ) : (
              <div
                className="mb-6 px-4 py-2 rounded-lg flex items-center gap-2"
                style={{
                  border: "1px solid var(--border-subtle)",
                  background: "var(--gold-muted)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: HERITAGE_GOLD,
                    flexShrink: 0,
                  }}
                />
                <span
                  className="font-sans"
                  style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.02em" }}
                >
                  Morning Brief Review appears after market close (5:00 PM PT) once outcomes are graded.
                </span>
              </div>
            )}

            {/* ── Your Watchlist (per-user, sits above the lead) ── */}
            <WatchlistBriefSection
              section={watchlistSection}
              status={watchlistStatus}
              briefType="evening"
            />

            {/* ── This Morning's Calls — scored objects (Open state; real
                 morning_brief_calls for this trading session, grading not live yet).
                 Matched by PT session date since the evening briefing id differs from
                 the morning brief that owns the calls. ── */}
            <section style={{ marginBottom: 40 }}>
              <BriefCallsSection
                briefDate={
                  briefing?.created_at
                    ? new Date(briefing.created_at).toLocaleDateString("en-CA", {
                        timeZone: "America/Los_Angeles",
                      })
                    : null
                }
                heading="This Morning's Calls"
                surface="wrap"
              />
            </section>

            {/* ── Today's Story ── */}
            <section style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <span
                  className="font-sans"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: "var(--parchment-mid)",
                    color: DC_ESPRESSO,
                    padding: "5px 12px",
                    borderRadius: 20,
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  ★ Today&rsquo;s Story
                </span>
                <SentimentPill tone={tone} />
                <span className="font-sans" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  Signalera Desk · 5 min
                </span>
              </div>

              <h2
                className="font-[family-name:var(--font-playfair-display)]"
                style={{
                  fontSize: "clamp(28px, 3.5vw, 40px)",
                  fontWeight: 800,
                  lineHeight: 1.05,
                  letterSpacing: "-0.025em",
                  color: "var(--espresso)",
                  margin: "0 0 24px",
                }}
              >
                {briefing.headline || formatLabel || "Evening Market Wrap"}
              </h2>

              {/* leadCards fills missing structured slots from thirds of
                  the prose summary and drops cards with nothing to show,
                  so we never render a card containing only "—". */}
              <div className={`grid grid-cols-1 ${leadGridCols} gap-5`}>
                {leadCards.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      background: "var(--elevated)",
                      border: "1px solid var(--border-base)",
                      borderRadius: 14,
                      padding: "22px 20px",
                    }}
                  >
                    <div
                      className="font-[family-name:var(--font-playfair-display)]"
                      style={{ fontSize: 60, fontWeight: 800, color: HERITAGE_GOLD, lineHeight: 0.85, marginBottom: 8, letterSpacing: "-0.03em" }}
                    >
                      {p.n}
                    </div>
                    <p
                      className="font-sans"
                      style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, margin: "0 0 10px" }}
                    >
                      {p.label}
                    </p>
                    <p
                      className="font-sans"
                      style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-primary)", margin: 0, whiteSpace: "pre-line" }}
                    >
                      {p.body}
                    </p>
                  </div>
                ))}
              </div>

              {userAddendum && (
                <div
                  className="mt-4 px-4 py-3 rounded-xl"
                  style={{ border: "1px solid var(--gold-border)", background: "var(--gold-muted)" }}
                >
                  <p
                    className="font-sans"
                    style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, marginBottom: 6 }}
                  >
                    Your Personalized Wrap
                  </p>
                  <p className="font-sans" style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-line", margin: 0 }}>
                    {userAddendum}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 mt-5">
                <ExportMenu
                  briefingId={briefing.id ?? null}
                  type="evening"
                  userEmail={user?.email ?? null}
                />
                <ShareButton
                  briefingId={briefing?.id}
                  briefTitle={briefing?.headline}
                  briefType="evening"
                />
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setLeadMemoContent([briefing.headline, briefing.summary].filter(Boolean).join("\n\n"));
                      setLeadMemoOpen(true);
                    }}
                  >
                    Generate Memo
                  </Button>
                  <Button variant="secondary" size="md" onClick={handleLeadMakeCall}>
                    Make a call
                  </Button>
                  <Button variant="secondary" size="md" onClick={handleAskAI}>
                    Ask AI
                  </Button>
                </div>
              </div>

              {lastRunStatus === "stub" || lastRunStatus === "error" || (lastRunStatus == null && isStale) ? (
                <div
                  className="mt-4 px-3 py-2 rounded-lg font-sans text-[11px]"
                  style={{ borderLeft: `2px solid ${HERITAGE_GOLD}`, background: "var(--gold-muted)", color: "var(--text-primary)" }}
                >
                  {lastRunStatus === "stub"
                    ? "Last run failed — synthesis error during generation. Showing previous brief."
                    : lastRunStatus === "error"
                      ? "Last run failed — pipeline did not complete. Showing previous brief."
                      : "Brief may be from a prior session — today's pipeline run may still be in progress."}
                </div>
              ) : null}
            </section>

            {/* ── Evening Analysis — one card per section, each with
                USEFUL? thumbs for feedback-loop signal collection. Sector
                Signals is rendered separately below. ── */}
            {analystSections.length > 0 && (
              <section style={{ marginBottom: 40 }}>
                <h3
                  className="font-[family-name:var(--font-playfair-display)]"
                  style={{
                    fontSize: 26,
                    fontWeight: 800,
                    color: "var(--espresso)",
                    margin: "0 0 18px",
                    letterSpacing: "-0.015em",
                  }}
                >
                  Evening Analysis
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {analystSections.map((section) => (
                    <DCAnalystSection
                      key={section.key}
                      sectionKey={section.key}
                      title={section.title}
                      content={section.content}
                      briefSource="Evening Wrap"
                      currentRating={sectionRatings[section.key] ?? 0}
                      onRate={handleSectionRate}
                      outputId={sectionOutputIds[section.key] ?? null}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── Sector Signals — standalone section with pill filter. ── */}
            {briefing.sector_breakdown && Object.keys(briefing.sector_breakdown).length > 0 && (
              <DCSectorSignals breakdown={briefing.sector_breakdown} />
            )}

            {/* ── Tomorrow's Setup — dual mode. Narrative prose card when
                the backend delivers a single paragraph; structured row
                list when it delivers multiple <p>-separated events. ── */}
            {/* Scheduled-catalyst strip (FOMC / CPI / PCE / jobs into tomorrow
                and ahead). Rides in macro_panel.catalysts; empty renders nothing. */}
            {briefing?.macro_panel?.catalysts?.length ? (
              <section style={{ marginBottom: 36 }}>
                <CatalystStrip catalysts={briefing.macro_panel.catalysts} />
              </section>
            ) : null}

            {tomorrowSetupContent && tomorrowSetupContent.trim() && (
              <section style={{ marginBottom: 40 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 8 }}>
                  <h3
                    className="font-[family-name:var(--font-playfair-display)]"
                    style={{ fontSize: 26, fontWeight: 800, color: "var(--espresso)", margin: 0, letterSpacing: "-0.015em" }}
                  >
                    Tomorrow&rsquo;s Setup
                  </h3>
                  <span
                    className="font-sans"
                    style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}
                  >
                    {formatDatePretty(new Date(now.getTime() + 24 * 60 * 60 * 1000))}
                  </span>
                </div>

                {tomorrowIsNarrative ? (
                  <div
                    style={{
                      border: "1px solid var(--border-base)",
                      borderLeft: `4px solid ${HERITAGE_GOLD}`,
                      borderRadius: 12,
                      background: "var(--elevated)",
                      padding: "20px 22px",
                    }}
                  >
                    <p
                      className="font-sans"
                      style={{
                        fontSize: 14,
                        lineHeight: 1.65,
                        color: "var(--text-primary)",
                        margin: 0,
                        whiteSpace: "pre-line",
                      }}
                    >
                      {stripHtml(tomorrowSetupContent)}
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      <button
                        type="button"
                        onClick={() => router.push(makeCallLink(stripHtml(tomorrowSetupContent)))}
                        className="font-sans cursor-pointer"
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--gold-dark)",
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                        }}
                      >
                        Add to thesis board →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      border: "1px solid var(--border-base)",
                      borderRadius: 12,
                      background: "var(--elevated)",
                      overflow: "hidden",
                    }}
                  >
                    {tomorrowEvents.map((item, i) => (
                      <div
                        key={i}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "100px 1fr 120px",
                          gap: 20,
                          alignItems: "center",
                          padding: "14px 20px",
                          borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
                        }}
                      >
                        <span
                          className="font-sans"
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: "var(--text-muted)",
                            background: "var(--parchment-mid)",
                            padding: "3px 8px",
                            borderRadius: 3,
                            textAlign: "center",
                            justifySelf: "start",
                          }}
                        >
                          Event {i + 1}
                        </span>
                        <div>
                          <p
                            className="font-[family-name:var(--font-playfair-display)]"
                            style={{ fontSize: 16, fontWeight: 700, color: "var(--espresso)", margin: "0 0 3px", letterSpacing: "-0.01em" }}
                          >
                            {item.lead}
                          </p>
                          {item.rest && (
                            <p className="font-sans" style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
                              {item.rest.trim()}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => router.push(makeCallLink(`${item.lead} ${item.rest}`.trim()))}
                          className="font-sans cursor-pointer"
                          style={{
                            fontSize: 11,
                            color: "var(--gold-dark)",
                            fontWeight: 600,
                            textAlign: "right",
                            background: "none",
                            border: "none",
                          }}
                        >
                          Add to brief →
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── Today's Top Stories — click a row to expand for summary,
                entity chips, bookmark, and Generate Memo / Thesis / Ask AI
                actions. Row meta row shows signal score, source win rate,
                and summary/headline-only pill. ── */}
            {rankedStories.length > 0 && (
              <section>
                <h3
                  className="font-[family-name:var(--font-playfair-display)]"
                  style={{ fontSize: 26, fontWeight: 800, color: "var(--espresso)", margin: "0 0 18px", letterSpacing: "-0.015em" }}
                >
                  {storiesLabel}
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                  {rankedStories.map((s, i) => (
                    <DCStoryRow
                      key={s.id}
                      story={s}
                      index={i}
                      watching={(s.tags ?? []).some((t) => isOnWatchlist(t, profile))}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <MemoModal
        isOpen={leadMemoOpen}
        onClose={() => setLeadMemoOpen(false)}
        title={briefing?.headline || "Evening Wrap"}
        content={leadMemoContent}
        type="brief"
      />
    </AppShell>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function sentimentFromDb(s: string | null): string {
  if (!s) return "neutral";
  const l = s.toLowerCase();
  if (l === "positive" || l === "bullish") return "bullish";
  if (l === "negative" || l === "bearish") return "bearish";
  return "neutral";
}

function parseCompanies(cos: unknown): string[] {
  if (!cos) return [];
  if (typeof cos === "string") { try { return JSON.parse(cos); } catch { return []; } }
  return Array.isArray(cos) ? cos : [];
}
