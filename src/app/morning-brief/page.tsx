"use client";

import { useState, useEffect, useMemo } from "react";
import { AppShell } from "@/components/shell";
import { PanelWidget } from "@/components/shell/right-panel";
import { TickerStrip } from "@/components/brief/ticker-strip";
import { ExportMenu } from "@/components/brief/export-menu";
import { ShareButton } from "@/components/brief/share-button";
import { DCStoryRow } from "@/components/brief/dc-story-row";
import WatchlistBriefSection from "@/components/brief/WatchlistBriefSection";
import type { WatchlistBriefSection as WatchlistSectionData } from "@/lib/watchlist-brief";
import { DCAnalystSection } from "@/components/brief/dc-analyst-section";
import { DCSectorSignals } from "@/components/brief/dc-sector-signals";
import MacroPanel, { type MacroPanelData } from "@/components/brief/MacroPanel";
import CatalystStrip from "@/components/brief/CatalystStrip";
import { ActiveThesesWidget } from "@/components/dashboard/active-theses-widget";
import { WatchlistWidget } from "@/components/dashboard/watchlist-widget";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { stripHtml } from "@/lib/strip-html";
import { FileText } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useRouter } from "next/navigation";
import { MemoModal } from "@/components/memo/MemoModal";
import { getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import type { StoryData } from "@/components/dashboard";
import type { DealData } from "@/components/brief";
import { createBrowserClient } from "@supabase/ssr";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { trackClientEvent } from "@/lib/track-event";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useLiveMood } from "@/hooks/useLiveMood";
import { sortByRelevance, isOnWatchlist } from "@/lib/personalization";
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

const TAB_ORDER = [
  "deals_and_ma",
  "public_markets",
  "macro_and_rates",
  "sector_spotlight",
  "geopolitics",
];

// Sherwood Direction C palette — every accent that must stay constant
// across light/dark is pinned to a literal hex. The theme tokens flip
// --espresso and --cream under html.dark, which would invert the hero
// cards and desaturate the masthead; these constants bypass that.
const HERITAGE_GOLD = "#d4a84b";
const HERITAGE_GOLD_DEEP = "#c9922a";
const DC_ESPRESSO = "#1a1208";
const DC_CREAM = "#fffdf9";

interface TopDeal {
  company: string;
  value?: string;
  deal_type?: string;
  one_liner?: string;
  sentiment?: string | null;
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
  top_deals?: TopDeal[];
  deals?: DealData[];
  top_stories?: StoryData[];
  created_at?: string;
  market_pulse?: {
    sentiment_word: string | null;
    narrative: string;
    headlines?: Array<{ title: string; href?: string }>;
  } | null;
  macro_panel?: MacroPanelData | null;
}

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

function SentimentPill({ tone, size = "md" }: { tone: Tone; size?: "sm" | "md" }) {
  const style: Record<Tone, { bg: string; fg: string; bd: string }> = {
    BULLISH: { bg: "var(--pill-bull-bg)", fg: "var(--pill-bull-text)", bd: "var(--pill-bull-border)" },
    BEARISH: { bg: "var(--pill-bear-bg)", fg: "var(--pill-bear-text)", bd: "var(--pill-bear-border)" },
    NEUTRAL: { bg: "var(--pill-neutral-bg)", fg: "var(--pill-neutral-text)", bd: "var(--pill-neutral-border)" },
    MIXED:   { bg: "var(--pill-mixed-bg)",   fg: "var(--pill-mixed-text)",   bd: "var(--pill-mixed-border)" },
    WATCH:   { bg: "var(--pill-watch-bg)",   fg: "var(--pill-watch-text)",   bd: "var(--pill-watch-border)" },
  };
  const s = style[tone];
  const font = size === "sm" ? 9 : 10;
  const pad = size === "sm" ? "3px 7px" : "4px 9px";
  const tr = size === "sm" ? "0.10em" : "0.12em";
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: font,
        fontWeight: 700,
        letterSpacing: tr,
        padding: pad,
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.bd}`,
      }}
    >
      {tone}
    </span>
  );
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

export default function MorningBriefPage() {
  const { profile } = useUserProfile();
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLabel, setStoriesLabel] = useState("Today's Stories");
  const [isStale, setIsStale] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<"success" | "stub" | "error" | null>(null);
  const [addingThesis, setAddingThesis] = useState(false);
  const [sectionRatings, setSectionRatings] = useState<Record<string, number>>({});
  const [leadMemoOpen, setLeadMemoOpen] = useState(false);
  const [leadMemoContent, setLeadMemoContent] = useState("");
  const [user, setUser] = useState<{ id: string; email?: string | null } | null | undefined>(undefined);
  const [showSignIn, setShowSignIn] = useState(false);
  const [formatLabel, setFormatLabel] = useState<string | null>(null);
  const [userAddendum, setUserAddendum] = useState<string | null>(null);
  const [watchlistSection, setWatchlistSection] = useState<WatchlistSectionData | null>(null);
  const [watchlistStatus, setWatchlistStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [briefOutputId, setBriefOutputId] = useState<string | null>(null);
  const [sectionOutputIds, setSectionOutputIds] = useState<Record<string, string>>({});
  const [thesesCount, setThesesCount] = useState<number | null>(null);
  const [thesesLoading, setThesesLoading] = useState(true);
  const [vixQuote, setVixQuote] = useState<{ price: string; pct: number } | null>(null);
  const [vixLoading, setVixLoading] = useState(true);
  const router = useRouter();

  // Banner mood comes from the global SSOT — same numbers + canonical 5-term
  // pill as every other route. The brief body still reads
  // `briefing.market_tone` and `briefing.market_pulse.sentiment_word` for its
  // own hero card; that prose vocabulary is intentionally separate.
  const liveMood = useLiveMood();

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

  // ── Data loading ────────────────────────────────────────────────────────
  // Each network dependency runs in its own effect with its own loading +
  // error state. Splitting them is the architectural fix for the flaky
  // first-render bug: the previous single-useEffect implementation awaited
  // `supabase.auth.getSession()` before kicking off ANY network call, and on
  // client-side navigation that promise occasionally never resolved, leaving
  // every downstream `fetch` un-fired and the page stuck on the loading
  // skeleton. The briefing fetch now does not depend on auth at all (the
  // server route already accepts cookie auth via @supabase/ssr) and runs
  // immediately on mount. Auth is added as a header opportunistically.
  //
  // `reloadKey` is bumped by the error-state retry button to re-run the
  // briefing fetch without forcing a full page reload.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBriefError(null);

    (async () => {
      // Resolve auth in the background — never block the briefing fetch on
      // it. If a token arrives before the fetch fires, attach it; if not,
      // the cookie-based session on the server still applies.
      const sessionPromise = (async () => {
        try {
          const { data: { session } } = await getSupabase().auth.getSession();
          return session ?? null;
        } catch {
          return null;
        }
      })();

      // Race auth resolution against a short cap so a hung getSession() never
      // stalls the brief render. 250ms is enough on warm caches; if it loses
      // the race we still hit the API (which reads cookies server-side).
      const session = await Promise.race([
        sessionPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
      ]);

      const headers: HeadersInit = { Accept: "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      try {
        const res = await fetch("/api/briefing?type=morning", {
          headers,
          credentials: "include",
          cache: "no-store",
        });

        if (session?.user) {
          void fetch("/api/user-events", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event_type: "morning_brief_opened" }),
          }).catch(() => {});
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;

        if (data.briefing) {
          const b = data.briefing;
          const sections = typeof b.sections === "string" ? JSON.parse(b.sections) : b.sections;
          const sectorBreakdown = typeof b.sector_breakdown === "string" ? JSON.parse(b.sector_breakdown) : b.sector_breakdown;
          const topDeals = typeof b.top_deals === "string" ? JSON.parse(b.top_deals) : b.top_deals;
          const marketPulse = (() => {
            const mp = b.market_pulse;
            if (!mp) return null;
            if (typeof mp === "string") { try { return JSON.parse(mp); } catch { return null; } }
            return mp;
          })();
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
            top_deals: Array.isArray(topDeals) ? topDeals : [],
            deals: b.deals || [],
            created_at: b.created_at,
            market_pulse: marketPulse,
            macro_panel: macroPanel,
          });
          setIsStale(data.is_stale === true);
          if (data.last_attempt_status) setLastRunStatus(data.last_attempt_status);
          if (data.personalization?.format_label) setFormatLabel(data.personalization.format_label);
          if (typeof data.user_addendum === "string") setUserAddendum(data.user_addendum);
          if (data.brief_output_id) setBriefOutputId(data.brief_output_id);
          if (data.section_output_ids) setSectionOutputIds(data.section_output_ids);
        } else {
          setBriefing(null);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to load briefing:", e);
          setBriefError(e instanceof Error ? e.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Watchlist section — independent, fail-soft fetch. Mirrors the briefing
  // fetch above: resolve the session opportunistically but NEVER block on it,
  // and ALWAYS hit the API with credentials:"include" so the server resolves
  // the user from cookies if getSession loses the race. Brief-level fail-soft
  // is preserved (a section failure never breaks the brief), but the section
  // now reports an explicit status so an error is distinct from "no news".
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
        fetch("/api/watchlist-brief?type=morning", {
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
          // Signed out / session not established: no section, not an error.
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
  }, [reloadKey]);

  // Today's Stories — independent fetch so a Supabase blip on this query
  // never blocks the brief itself.
  useEffect(() => {
    let cancelled = false;
    setStoriesLoading(true);

    (async () => {
      try {
        const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

        let { data: articles } = await getSupabase()
          .from("articles")
          .select("id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, relevance_score")
          .gte("ingested_at", cutoff24h)
          .order("relevance_score", { ascending: false })
          .limit(8);

        let label = "Today's Stories";
        if ((articles?.length ?? 0) < 3) {
          const { data: fallback } = await getSupabase()
            .from("articles")
            .select("id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, relevance_score")
            .gte("ingested_at", cutoff48h)
            .order("relevance_score", { ascending: false })
            .limit(8);
          articles = fallback;
          label = "Recent Stories";
        }
        if (cancelled) return;
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

          if (cancelled) return;
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
      } catch (e) {
        console.warn("Failed to load stories:", e);
      } finally {
        if (!cancelled) setStoriesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Active theses count (stats bar). Independent fetch — if it 503s
  // (Supabase blip) the rest of the brief renders normally.
  useEffect(() => {
    let cancelled = false;
    setThesesLoading(true);
    (async () => {
      try {
        const { count } = await getSupabase()
          .from("theses")
          .select("id", { count: "exact", head: true });
        if (!cancelled && typeof count === "number") setThesesCount(count);
      } catch { /* soft-fail */ }
      finally {
        if (!cancelled) setThesesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  // VIX quote for the stats bar. Independent fetch.
  // Finnhub doesn't return data for plain "VIX"; "^VIX" is the index
  // symbol that works. We also include "VIXY" as a fallback proxy
  // (volatility-tracking ETF) so the bar always shows real numbers.
  useEffect(() => {
    let cancelled = false;
    setVixLoading(true);
    (async () => {
      try {
        const qr = await fetch("/api/watchlist-quotes?symbols=" + encodeURIComponent("^VIX,VIXY"));
        if (qr.ok) {
          const qd = await qr.json();
          const q = qd?.quotes?.["^VIX"] ?? qd?.quotes?.VIXY;
          if (q && !cancelled) {
            const price = typeof q.price === "number"
              ? q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : String(q.price ?? "—");
            setVixQuote({ price, pct: q.pct ?? 0 });
          }
        }
      } catch { /* soft-fail */ }
      finally {
        if (!cancelled) setVixLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
    }).catch(() => setUser(null));
  }, []);

  // Analyst Briefing sections — whitelist + canonical order. Sector Signals
  // is rendered as its own section below the analyst grid, so it is NOT
  // folded into this list.
  const analystSections = useMemo(() => {
    const s = briefing?.sections || {};
    const out: { key: string; title: string; content: string }[] = [];
    for (const key of TAB_ORDER) {
      const content = s[key];
      if (content && content.trim()) {
        out.push({ key, title: SECTION_TITLES[key] || key, content });
      }
    }
    return out;
  }, [briefing]);

  const rankedStories = useMemo(() => {
    if (!profile) return stories;
    return sortByRelevance(stories, profile, storyToContent);
  }, [stories, profile]);

  const tone = normaliseTone(briefing?.market_tone);
  // Use a stable epoch fallback to avoid SSR/client hydration mismatch (#418).
  const [fallbackDate] = useState(() => new Date());
  const now = briefing?.created_at ? new Date(briefing.created_at) : fallbackDate;
  const dateStr = formatDatePretty(now);
  const timeStr = formatTimePretty(now);

  const moodWord = briefing?.market_pulse?.sentiment_word || briefing?.market_tone || "—";

  // Market Pulse fallbacks: the hero card must always render, but never
  // with a fabricated verdict. When neither the grounded sentiment word nor
  // market_tone is present, the hero drops the highlighted-word treatment
  // instead of asserting "mixed".
  const pulseWord = briefing?.market_pulse?.sentiment_word || briefing?.market_tone || null;
  const pulseBody =
    briefing?.market_pulse?.narrative
    || (briefing?.summary ? stripHtml(briefing.summary) : "")
    || "Pre-market synthesis is still stitching together. Detailed pulse commentary will appear here shortly.";
  const pulseDrivers: { label: string; href?: string; tone: Tone }[] = (() => {
    const h = briefing?.market_pulse?.headlines;
    if (Array.isArray(h) && h.length > 0) {
      return h.slice(0, 4).map((x) => ({
        label: x.title,
        href: x.href,
        tone: normaliseTone((x as { tone?: string }).tone ?? null),
      }));
    }
    if (briefing?.top_deals && briefing.top_deals.length > 0) {
      return briefing.top_deals.slice(0, 3).map((d) => ({
        label: d.deal_type ? `${d.company} · ${d.deal_type}` : d.company,
        tone: "NEUTRAL" as Tone,
      }));
    }
    return [];
  })();

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
    { label: "The Lead",      body: briefing?.lead_paragraph     || summaryThirds[0] },
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

  const handleLeadAddThesis = async () => {
    setAddingThesis(true);
    try {
      await getSupabase().from("theses").insert({
        title: briefing?.headline || "Morning Brief Lead",
        conviction: "WATCH",
        sector: "General",
        rationale: briefing?.summary || "",
        source: "Morning Brief",
        status: "new-signal",
        generated_at: new Date().toISOString(),
      });
      router.push("/thesis-board");
    } catch (err) {
      console.error("Failed to add thesis:", err);
    } finally {
      setAddingThesis(false);
    }
  };

  return (
    <AppShell
      pageTitle="Morning Brief"
      mood={liveMood.mood}
      moodHeadline={liveMood.moodHeadline}
      moodDetails={liveMood.moodDetails}
      rightPanel={
        <>
          <PanelWidget title="Active Theses">
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
          into the page's espresso body on the right. Reversible: restore
          the 135deg two-stop gold gradient in the `background` string to
          return to the Direction A treatment. All colour values stay
          literal so the band reads identically in light + dark. */}
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
              Morning Brief
            </span>
            <span
              className="font-[family-name:var(--font-playfair-display)] italic"
              style={{ fontSize: 13, color: "rgba(255,253,249,0.78)", marginTop: 4, fontWeight: 400 }}
            >
              A considered reading of overnight markets — in four chapters.
            </span>
          </div>
        </div>
        <div
          className="font-sans"
          style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 11, color: "rgba(255,253,249,0.85)", fontWeight: 600 }}
        >
          <span>{dateStr}</span>
          <span className="font-data">{timeStr}</span>
          <span style={{ background: "rgba(255,253,249,0.15)", color: "rgba(255,253,249,0.9)", padding: "4px 10px", borderRadius: 20, fontSize: 10, letterSpacing: "0.12em" }}>
            4 MIN READ
          </span>
        </div>
      </header>

      {/* Stats metadata bar — each cell renders a small skeleton pulse
          while its data is loading, instead of an em-dash placeholder.
          The dashes were the visual signature of the flaky-render bug:
          the stats bar would render with all dashes and then never refresh
          if the brief fetch silently failed. */}
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
          {
            k: "MOOD",
            loading,
            v: String(moodWord).toUpperCase(),
            c: tone === "BEARISH" ? "var(--signal-dn)" : tone === "BULLISH" ? "var(--signal-up)" : "var(--signal-warn)",
            skeletonW: 60,
            tip: "Today's overall market sentiment, derived from VIX levels and price action.",
          },
          {
            k: "STORIES",
            loading: storiesLoading,
            v: String(stories.length),
            skeletonW: 28,
            tip: "Total articles ingested and analyzed by Signalera's pipeline today.",
          },
          {
            k: "THESES",
            loading: thesesLoading,
            v: thesesCount !== null ? `${thesesCount} active` : "0 active",
            skeletonW: 56,
            tip: "Investment theses currently being tracked and validated by Signalera.",
          },
          {
            k: "VIX",
            loading: vixLoading,
            v: vixQuote ? `${vixQuote.price} ${vixQuote.pct >= 0 ? "▲" : "▼"}${Math.abs(vixQuote.pct).toFixed(2)}%` : "—",
            c: vixQuote ? (vixQuote.pct >= 0 ? "var(--signal-dn)" : "var(--signal-up)") : undefined,
            skeletonW: 72,
            tip: "CBOE Volatility Index — higher means more market fear, lower means lower expected volatility.",
          },
        ] as Array<{ k: string; v: string; loading: boolean; c?: string; skeletonW: number; tip: string }>).map((x, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="font-sans" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, letterSpacing: "0.16em", color: "var(--text-muted)" }}>
              {x.k}
              <InfoTooltip content={x.tip} side="bottom" iconSize={10} />
            </span>
            {x.loading ? (
              <Skeleton
                aria-label={`${x.k} loading`}
                style={{ width: x.skeletonW, height: 12, borderRadius: 4 }}
              />
            ) : (
              <span
                className="font-data"
                style={{ fontSize: 12, fontWeight: 700, color: x.c || "var(--espresso)", fontVariantNumeric: "tabular-nums" }}
              >
                {x.v}
              </span>
            )}
          </div>
        ))}
        <span style={{ flex: 1 }} />
        <span
          className="font-data"
          style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--signal-up)", display: "inline-block" }} />
          LIVE · Signalera Desk
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
            <div className="grid grid-cols-1 gap-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          </div>
        ) : briefError ? (
          <EmptyState
            icon={<FileText size={32} />}
            title="We couldn't load the morning brief"
            description={`The brief data fetch failed (${briefError}). This is usually a transient network blip.`}
            action={
              <Button
                variant="primary"
                size="md"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Retry
              </Button>
            }
          />
        ) : !briefing ? (
          <EmptyState
            icon={<FileText size={32} />}
            title="No morning brief available"
            description="The briefing will appear here once generated by the system."
          />
        ) : (
          <>
            {/* ── Market Pulse — dark espresso hero. All colours pinned to
                literals so the card stays dark in both light and dark
                themes (the token --espresso flips to a near-white in dark
                mode and would otherwise invert this card). Always renders:
                sentiment word falls back to market_tone and then to a
                no-verdict headline (never a fabricated word), body falls
                back to briefing.summary, driver chips fall back to
                top_deals when backend-supplied headlines are absent. ── */}
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
                    letterSpacing: "0.20em",
                    color: HERITAGE_GOLD,
                    margin: "0 0 14px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    position: "relative",
                  }}
                >
                  Market Pulse · {timeStr}
                  {" "}<InfoTooltip content="AI-generated snapshot of where markets stand right now, based on today's full signal tape." side="right" iconSize={12} className="text-gold/40 hover:text-gold/70" />
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
                  {pulseWord ? (
                    <>
                      Today the market is{" "}
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
                        {pulseWord}
                      </span>
                      .
                    </>
                  ) : (
                    <>Today in the markets.</>
                  )}
                </h2>
                <p
                  className="font-sans"
                  style={{
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "rgba(255,253,249,0.82)",
                    margin: "0 0 24px",
                    maxWidth: 620,
                    whiteSpace: "pre-line",
                    position: "relative",
                  }}
                >
                  {pulseBody}
                </p>
                {pulseDrivers.length > 0 && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", position: "relative" }}>
                    {pulseDrivers.map((d, i) => {
                      const Chip = (
                        <div
                          key={i}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 14px",
                            background: "rgba(255,253,249,0.08)",
                            border: "1px solid rgba(212,168,75,0.25)",
                            borderRadius: 24,
                            backdropFilter: "blur(10px)",
                          }}
                        >
                          <span style={{ fontSize: 13, color: DC_CREAM, fontWeight: 500 }}>
                            {d.label}
                          </span>
                          <SentimentPill tone={d.tone} size="sm" />
                        </div>
                      );
                      return d.href ? (
                        <a
                          key={i}
                          href={d.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          {Chip}
                        </a>
                      ) : (
                        Chip
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* ── MORNING REVIEW block — gold eyebrow label, Playfair
                date headline, muted Inter + mono timestamp subtitle. Sits
                between the Market Pulse hero and Today's Lead. ── */}
            <section style={{ marginBottom: 28 }}>
              <p
                className="font-sans"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: "var(--gold-dark)",
                  fontWeight: 800,
                  margin: "0 0 10px",
                }}
              >
                Morning Review
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

            {/* ── Your Watchlist (per-user, sits above the lead) ── */}
            <WatchlistBriefSection
              section={watchlistSection}
              status={watchlistStatus}
              briefType="morning"
            />

            {/* ── Today's Lead ── */}
            <section style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <span
                  className="font-sans"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#a88340",
                    color: DC_ESPRESSO,
                    padding: "5px 12px",
                    borderRadius: 20,
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 800,
                  }}
                >
                  ★ Today&rsquo;s Lead
                </span>
                <InfoTooltip content="The most important market story today, selected and summarized by Signalera's AI." side="bottom" iconSize={12} />
                <SentimentPill tone={tone} />
                <span className="font-sans" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  Signalera Desk · 4 min
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
                {briefing.headline || formatLabel || "Morning Market Brief"}
              </h2>

              {/* 3-column structured body. Cards use --elevated so they
                  are white/#fffdf9 in light and #1e1e1e in dark, keeping
                  proper card contrast against the page in both themes.
                  Always renders — leadCards falls back to the summary
                  split into thirds when the backend doesn't deliver the
                  structured lead/context/watch fields. */}
              <div className={`grid grid-cols-1 ${leadGridCols} gap-5`}>
                {leadCards.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      background: "var(--elevated)",
                      border: "1px solid var(--border-base)",
                      borderRadius: 14,
                      padding: "22px 20px",
                      transition: "transform 150ms cubic-bezier(0.16,1,0.3,1), box-shadow 150ms",
                    }}
                  >
                    <div
                      className="font-[family-name:var(--font-playfair-display)]"
                      style={{
                        fontSize: 60,
                        fontWeight: 800,
                        color: HERITAGE_GOLD,
                        lineHeight: 0.85,
                        marginBottom: 8,
                        letterSpacing: "-0.03em",
                      }}
                    >
                      {p.n}
                    </div>
                    <p
                      className="font-sans"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                        color: "var(--gold-dark)",
                        fontWeight: 700,
                        margin: "0 0 10px",
                      }}
                    >
                      {p.label}
                    </p>
                    <p
                      className="font-sans"
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.6,
                        color: "var(--text-primary)",
                        margin: 0,
                        whiteSpace: "pre-line",
                      }}
                    >
                      {p.body}
                    </p>
                  </div>
                ))}
              </div>

              {/* Names to Watch — parchment strip with dashed gold border
                  and top_deals as pill chips. Omitted when there are no
                  deals so we never render an empty callout. */}
              {briefing.top_deals && briefing.top_deals.length > 0 && (
                <div
                  style={{
                    marginTop: 20,
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: "16px 20px",
                    borderRadius: 14,
                    background: "var(--parchment-mid)",
                    border: "1px dashed rgba(212,168,75,0.4)",
                  }}
                >
                  <span
                    className="font-sans"
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: "var(--gold-dark)",
                      fontWeight: 800,
                      alignSelf: "center",
                    }}
                  >
                    ▶ Names to Watch
                  </span>
                  {briefing.top_deals.slice(0, 5).map((d, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        background: "var(--elevated)",
                        border: "1px solid var(--border-base)",
                        borderRadius: 20,
                        padding: "6px 12px",
                      }}
                    >
                      <span
                        className="font-data"
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: "var(--espresso)",
                        }}
                      >
                        {d.company}
                      </span>
                      {d.deal_type && (
                        <span
                          className="font-sans"
                          style={{ fontSize: 11, color: "var(--text-secondary)" }}
                        >
                          {d.deal_type}
                        </span>
                      )}
                      <SentimentPill tone={normaliseTone(d.sentiment)} size="sm" />
                    </div>
                  ))}
                </div>
              )}

              {/* Personal addendum */}
              {userAddendum && (
                <div
                  className="mt-4 px-4 py-3 rounded-xl"
                  style={{
                    border: "1px solid var(--gold-border)",
                    background: "var(--gold-muted)",
                  }}
                >
                  <p
                    className="font-sans"
                    style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--gold-dark)", fontWeight: 700, marginBottom: 6 }}
                  >
                    Your Personalized Briefing
                  </p>
                  <p className="font-sans" style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-line", margin: 0 }}>
                    {userAddendum}
                  </p>
                </div>
              )}

              {/* Export & Share row */}
              <div className="flex items-center gap-2 mt-5">
                {user === null ? (
                  <Button variant="secondary" size="md" onClick={() => setShowSignIn(true)}>
                    &#8595; Export Brief
                  </Button>
                ) : (
                  <ExportMenu
                    briefingId={briefing.id ?? null}
                    type="morning"
                    userEmail={user?.email ?? null}
                  />
                )}
                <ShareButton
                  briefingId={briefing?.id}
                  briefTitle={briefing?.headline}
                  briefType="morning"
                />
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setLeadMemoContent(
                        [briefing.headline, briefing.summary].filter(Boolean).join("\n\n"),
                      );
                      setLeadMemoOpen(true);
                    }}
                  >
                    Generate Memo
                  </Button>
                  <Button variant="secondary" size="md" onClick={handleLeadAddThesis} disabled={addingThesis}>
                    Add Thesis
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

            {/* ── Top Deals to Watch — full deal cards. Each card shows
                company, headline deal value, deal type pill, and a
                prose one-liner. Cream elevated surface with gold accent
                stripe — Direction C aesthetic. ── */}
            {briefing.top_deals && briefing.top_deals.length > 0 && (
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
                  Top Deals to Watch
                </h3>
                <div
                  className={
                    briefing.top_deals.length >= 3
                      ? "grid grid-cols-1 md:grid-cols-3 gap-3"
                      : briefing.top_deals.length === 2
                        ? "grid grid-cols-1 md:grid-cols-2 gap-3 max-w-[66%] mx-auto"
                        : "grid grid-cols-1 gap-3 max-w-[33%] mx-auto"
                  }
                >
                  {briefing.top_deals.map((deal, i) => (
                    <div
                      key={i}
                      style={{
                        background: "var(--elevated)",
                        border: "1px solid var(--border-base)",
                        borderTop: `3px solid ${HERITAGE_GOLD}`,
                        borderRadius: 12,
                        padding: "16px 18px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                        <h4
                          className="font-[family-name:var(--font-playfair-display)]"
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "var(--espresso)",
                            margin: 0,
                            letterSpacing: "-0.01em",
                          }}
                        >
                          {deal.company}
                        </h4>
                        <span
                          className="font-data"
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "var(--gold-dark)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {deal.value || "Undisclosed"}
                        </span>
                      </div>
                      {deal.deal_type && (
                        <span
                          className="font-data"
                          style={{
                            display: "inline-block",
                            alignSelf: "flex-start",
                            fontSize: 9,
                            fontWeight: 800,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            color: "var(--gold-dark)",
                            background: "var(--gold-muted)",
                            border: "1px solid var(--gold-border)",
                            padding: "3px 8px",
                            borderRadius: 4,
                          }}
                        >
                          {deal.deal_type}
                        </span>
                      )}
                      {deal.one_liner && (
                        <p
                          className="font-sans"
                          style={{
                            fontSize: 12,
                            lineHeight: 1.55,
                            color: "var(--text-secondary)",
                            margin: 0,
                          }}
                        >
                          {stripHtml(deal.one_liner)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Macro snapshot (deterministic, numbers only; slice 1 compact
                strip). Renders nothing when macro_panel is absent or empty. ── */}
            {briefing.macro_panel?.releases?.length ? (
              <section style={{ marginBottom: 28 }}>
                <MacroPanel panel={briefing.macro_panel} />
              </section>
            ) : null}

            {/* Scheduled-catalyst strip (FOMC / CPI / PCE / jobs). Rides in
                macro_panel.catalysts; renders nothing when empty. */}
            {briefing.macro_panel?.catalysts?.length ? (
              <section style={{ marginBottom: 28 }}>
                <CatalystStrip catalysts={briefing.macro_panel.catalysts} />
              </section>
            ) : null}

            {/* ── Analyst Briefing — one card per section, each with
                USEFUL? thumbs for Lucas's feedback-loop signal
                collection. Sector Signals is rendered separately below. ── */}
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
                  Analyst Briefing
                  {" "}<InfoTooltip content="AI-written analysis sections covering key market themes, each grounded in today's articles." side="right" iconSize={12} />
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {analystSections.map((section) => (
                    <DCAnalystSection
                      key={section.key}
                      sectionKey={section.key}
                      title={section.title}
                      content={section.content}
                      briefSource="Morning Brief"
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

            {/* Personalization nudge */}
            {user === null && briefing && (
              <div
                className="my-6 px-4 py-4 rounded-xl border text-center"
                style={{ background: "rgba(245, 166, 35, 0.08)", borderColor: "var(--gold-border)" }}
              >
                <p className="font-sans text-[13px]" style={{ color: "var(--espresso)", fontWeight: 600, marginBottom: 4 }}>
                  This brief is personalized for signed-in users.
                </p>
                <p className="font-sans text-[12px]" style={{ color: "var(--text-secondary)", marginBottom: 12 }}>
                  Sign in to get a brief built around your sectors and watchlist.
                </p>
                <button
                  type="button"
                  onClick={() => setShowSignIn(true)}
                  className="px-4 py-2 rounded-xl font-sans text-[12px] font-semibold cursor-pointer transition-colors"
                  style={{ background: HERITAGE_GOLD, color: DC_ESPRESSO }}
                >
                  Sign in with Google — Free
                </button>
              </div>
            )}

            {/* ── Today's Stories — click a row to expand for summary,
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
                  {" "}<InfoTooltip content="Articles ranked by relevance score — a composite of recency, source credibility, and topic importance." side="right" iconSize={12} />
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                  {(user === null ? rankedStories.slice(0, 3) : rankedStories).map((s, i) => (
                    <DCStoryRow
                      key={s.id}
                      story={s}
                      index={i}
                      watching={(s.tags ?? []).some((t) => isOnWatchlist(t, profile))}
                    />
                  ))}
                </div>

                {user === null && rankedStories.length > 3 && (
                  <div
                    className="flex items-center justify-between px-4 py-3 mt-3 rounded-xl border"
                    style={{ background: "rgba(245, 166, 35, 0.08)", borderColor: "var(--gold-border)" }}
                  >
                    <span className="font-sans text-[12px]" style={{ color: HERITAGE_GOLD }}>
                      Sign in to see all {rankedStories.length} stories
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSignIn(true)}
                      className="font-sans text-[11px] font-semibold cursor-pointer"
                      style={{ color: HERITAGE_GOLD, background: "none", border: "none" }}
                    >
                      Sign in &rarr;
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      <MemoModal
        isOpen={leadMemoOpen}
        onClose={() => setLeadMemoOpen(false)}
        title={briefing?.headline || "Morning Brief"}
        content={leadMemoContent}
        type="brief"
      />
      <SignInModal
        isOpen={showSignIn}
        onClose={() => setShowSignIn(false)}
        headline="Personalize your morning brief"
        message="Sign in to get a brief built around your sectors and watchlist."
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
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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
  if (typeof cos === "string") {
    try { return JSON.parse(cos); } catch { return []; }
  }
  return Array.isArray(cos) ? cos : [];
}
