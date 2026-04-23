"use client";

import { useState, useEffect, useMemo } from "react";
import { AppShell } from "@/components/shell";
import { PanelWidget } from "@/components/shell/right-panel";
import { Wordmark } from "@/components/ui/wordmark";
import { TickerStrip } from "@/components/brief/ticker-strip";
import { ExportMenu } from "@/components/brief/export-menu";
import { ShareButton } from "@/components/brief/share-button";
import { ActiveThesesWidget } from "@/components/dashboard/active-theses-widget";
import { WatchlistWidget } from "@/components/dashboard/watchlist-widget";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";
import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { MemoModal } from "@/components/memo/MemoModal";
import { getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import type { StoryData } from "@/components/dashboard";
import type { DealData } from "@/components/brief";
import { createBrowserClient } from "@supabase/ssr";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { trackClientEvent } from "@/lib/track-event";
import { useUserProfile } from "@/hooks/useUserProfile";
import { sortByRelevance } from "@/lib/personalization";
import type { ContentDescriptor } from "@/lib/personalization";

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

// Sherwood Heritage Gold — pinned hex so accents stay saturated in BOTH
// light and dark mode. The project's --gold token resolves to the deeper
// editorial gold in light and a paler tan in dark; using either drifts
// away from #d4a84b. Gold-deep stays at the literal too so the masthead
// gradient reads as a distinct brand band regardless of theme.
const HERITAGE_GOLD = "#d4a84b";
const HERITAGE_GOLD_DEEP = "#c9922a";

interface TopDeal {
  company: string;
  value?: string;
  deal_type?: string;
  one_liner?: string;
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
    sentiment_word: string;
    narrative: string;
    headlines?: Array<{ title: string; href?: string }>;
  } | null;
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
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) + " ET";
}

export default function MorningBriefPage() {
  const { profile } = useUserProfile();
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLabel, setStoriesLabel] = useState("Today's Stories");
  const [isStale, setIsStale] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<"success" | "stub" | "error" | null>(null);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoTitle, setMemoTitle] = useState("");
  const [memoContent, setMemoContent] = useState("");
  const [addingThesis, setAddingThesis] = useState(false);
  const [sectionRatings, setSectionRatings] = useState<Record<string, number>>({});
  const [leadMemoOpen, setLeadMemoOpen] = useState(false);
  const [leadMemoContent, setLeadMemoContent] = useState("");
  const [user, setUser] = useState<{ id: string; email?: string | null } | null | undefined>(undefined);
  const [showSignIn, setShowSignIn] = useState(false);
  const [formatLabel, setFormatLabel] = useState<string | null>(null);
  const [userAddendum, setUserAddendum] = useState<string | null>(null);
  const [briefView, setBriefView] = useState<"editorial" | "dashboard">("editorial");
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [thesesCount, setThesesCount] = useState<number | null>(null);
  const [vixQuote, setVixQuote] = useState<{ price: string; pct: number } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem("signalera_brief_view");
    if (stored === "editorial" || stored === "dashboard") setBriefView(stored);
  }, []);
  useEffect(() => {
    localStorage.setItem("signalera_brief_view", briefView);
  }, [briefView]);

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
        const res = await fetch("/api/briefing?type=morning", { headers });

        if (session?.user) {
          void fetch("/api/user-events", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event_type: "morning_brief_opened" }),
          }).catch(() => {});
        }
        const data = await res.json();
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
          });
          setIsStale(data.is_stale === true);
          if (data.last_attempt_status) setLastRunStatus(data.last_attempt_status);
          if (data.personalization?.format_label) setFormatLabel(data.personalization.format_label);
          if (typeof data.user_addendum === "string") setUserAddendum(data.user_addendum);
        }

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
        setStoriesLabel(label);

        if (articles) {
          const uniqueSources = [...new Set(articles.map(a => a.source).filter(Boolean) as string[])];
          let credMap = new Map<string, number>();
          if (uniqueSources.length > 0) {
            try {
              const { data: credData } = await getSupabase()
                .from("source_credibility")
                .select("source, win_rate")
                .in("source", uniqueSources);
              credMap = new Map(credData?.map(r => [r.source, r.win_rate]) ?? []);
            } catch { /* soft-fail */ }
          }

          setStories(articles.map((a) => {
            const completeness = getCompleteness(a.content, a.summary);
            return {
              id: a.id,
              title: a.title || "Untitled",
              source: a.source || "Unknown",
              timestamp: timeAgo(a.published_at || a.ingested_at),
              sentiment: sentimentFromDb(a.sentiment),
              sector: a.sector || undefined,
              summary: a.summary || undefined,
              tags: parseCompanies(a.companies).slice(0, 3),
              url: a.url || undefined,
              read: false,
              saved: false,
              completeness,
              adjustedScore: getAdjustedScore(a.relevance_score ?? null, completeness),
              sourceWinRate: credMap.get(a.source) ?? null,
            };
          }));
        }

        // Active theses count (stats bar).
        try {
          const { count } = await getSupabase()
            .from("theses")
            .select("id", { count: "exact", head: true });
          if (typeof count === "number") setThesesCount(count);
        } catch { /* soft-fail */ }

        // VIX quote for stats bar.
        // Finnhub doesn't return data for plain "VIX"; "^VIX" is the index
        // symbol that works. We also include "VIXY" as a fallback proxy
        // (volatility-tracking ETF) so the bar always shows real numbers.
        try {
          const qr = await fetch("/api/watchlist-quotes?symbols=" + encodeURIComponent("^VIX,VIXY"));
          if (qr.ok) {
            const qd = await qr.json();
            const q = qd?.quotes?.["^VIX"] ?? qd?.quotes?.VIXY;
            if (q) {
              const price = typeof q.price === "number"
                ? q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : String(q.price ?? "—");
              setVixQuote({ price, pct: q.pct ?? 0 });
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

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
    }).catch(() => setUser(null));
  }, []);

  // Ordered tabs for Analyst Briefing — whitelist sections, preserving canonical order.
  const tabs = useMemo(() => {
    const s = briefing?.sections || {};
    const sector = briefing?.sector_breakdown || {};
    const out: { key: string; title: string; content: string; count?: number }[] = [];
    for (const key of TAB_ORDER) {
      const content = s[key];
      if (content && content.trim()) {
        out.push({ key, title: SECTION_TITLES[key] || key, content });
      }
    }
    // Sector Signals folds in as a 5th tab sourced from sector_breakdown.
    if (sector && Object.keys(sector).length > 0) {
      const joined = Object.entries(sector)
        .map(([sec, text]) => `<p><strong>${sec}:</strong> ${text}</p>`)
        .join("");
      out.push({ key: "sector_signals", title: "Sector Signals", content: joined, count: Object.keys(sector).length });
    }
    return out;
  }, [briefing]);

  useEffect(() => {
    if (tabs.length === 0) return;
    const stillValid = activeTabKey && tabs.some((s) => s.key === activeTabKey);
    if (!stillValid) setActiveTabKey(tabs[0].key);
  }, [tabs, activeTabKey]);

  const rankedStories = useMemo(() => {
    if (!profile) return stories;
    return sortByRelevance(stories, profile, storyToContent);
  }, [stories, profile]);

  const tone = normaliseTone(briefing?.market_tone);
  const now = briefing?.created_at ? new Date(briefing.created_at) : new Date();
  const dateStr = formatDatePretty(now);
  const timeStr = formatTimePretty(now);

  const moodWord = briefing?.market_pulse?.sentiment_word || briefing?.market_tone || "—";

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

  const activeTab = tabs.find((t) => t.key === activeTabKey) ?? tabs[0];
  // Split plain-text or <p>-separated analyst content into numbered card rows.
  const splitCards = (html: string): { lead: string; rest: string }[] => {
    if (!html) return [];
    const paragraphs = html
      .split(/<\/p>\s*<p[^>]*>|\n\n+/)
      .map((p) => stripHtml(p).trim())
      .filter(Boolean);
    return paragraphs.slice(0, 6).map((p) => {
      // Lead = first clause up to the first sentence-ending or comma-plus.
      const m = p.match(/^([^.;:]+[.;:])\s*(.*)$/);
      if (m) return { lead: m[1].trim(), rest: m[2] ? " " + m[2] : "" };
      return { lead: p, rest: "" };
    });
  };

  return (
    <AppShell
      pageTitle="Morning Brief"
      mood={tone === "BEARISH" ? "risk-off" : tone === "BULLISH" ? "risk-on" : "neutral"}
      moodHeadline={briefing?.market_tone || "Loading..."}
      moodDetails={[]}
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

      {/* Sherwood gold masthead — Heritage Gold pinned in both modes; text
          uses var(--foreground) so Signal flips espresso↔cream just like
          the sidebar Wordmark does, era stays gold via the shared component. */}
      <header
        style={{
          background: `linear-gradient(135deg, ${HERITAGE_GOLD} 0%, ${HERITAGE_GOLD_DEEP} 100%)`,
          padding: "20px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <Wordmark size="lg" />
          <span style={{ width: 1, height: 20, background: "var(--foreground)", opacity: 0.25, alignSelf: "center" }} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span
              className="font-[family-name:var(--font-playfair-display)]"
              style={{ fontSize: 20, fontWeight: 700, color: "var(--foreground)", letterSpacing: "-0.01em" }}
            >
              Morning Brief
            </span>
            <span
              className="font-[family-name:var(--font-playfair-display)] italic"
              style={{ fontSize: 13, color: "var(--foreground)", opacity: 0.78, marginTop: 4, fontWeight: 400 }}
            >
              A considered reading of overnight markets — in four chapters.
            </span>
          </div>
        </div>
        <div
          className="font-sans"
          style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 11, color: "var(--foreground)", opacity: 0.85, fontWeight: 600 }}
        >
          <span>{dateStr}</span>
          <span className="font-data">{timeStr}</span>
          <span style={{ background: "var(--foreground)", color: "var(--cream)", padding: "4px 10px", borderRadius: 20, fontSize: 10, letterSpacing: "0.12em", opacity: 0.85 }}>
            4 MIN READ
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
        {[
          { k: "MOOD", v: String(moodWord).toUpperCase(), c: tone === "BEARISH" ? "var(--signal-dn)" : tone === "BULLISH" ? "var(--signal-up)" : "var(--signal-warn)" },
          { k: "STORIES", v: String(stories.length || "—") },
          { k: "THESES", v: thesesCount !== null ? `${thesesCount} active` : "—" },
          {
            k: "VIX",
            v: vixQuote ? `${vixQuote.price} ${vixQuote.pct >= 0 ? "▲" : "▼"}${Math.abs(vixQuote.pct).toFixed(2)}%` : "—",
            c: vixQuote ? (vixQuote.pct >= 0 ? "var(--signal-dn)" : "var(--signal-up)") : undefined,
          },
        ].map((x, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              className="font-sans"
              style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.16em", color: "var(--text-muted)" }}
            >
              {x.k}
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
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--signal-up)", display: "inline-block" }} />
          LIVE · Signalera Desk
        </span>
      </div>

      <div className="p-8 max-w-[960px]">
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
        ) : !briefing ? (
          <EmptyState
            icon={<FileText size={32} />}
            title="No morning brief available"
            description="The briefing will appear here once generated by the system."
          />
        ) : (
          <>
            {/* ── Market Pulse — dark espresso hero ── */}
            {briefing?.market_pulse?.sentiment_word && briefing?.market_pulse?.narrative && (
              <section style={{ marginBottom: 36 }}>
                <div
                  style={{
                    background: "var(--espresso)",
                    borderRadius: 18,
                    padding: "32px 36px",
                    color: "var(--cream)",
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
                      background: "radial-gradient(circle, rgba(212,168,75,0.38), transparent 70%)",
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
                    }}
                  >
                    Market Pulse · {timeStr}
                  </p>
                  <h2
                    className="font-[family-name:var(--font-playfair-display)]"
                    style={{
                      fontSize: "clamp(30px, 4vw, 44px)",
                      fontWeight: 800,
                      lineHeight: 1.05,
                      letterSpacing: "-0.025em",
                      margin: "0 0 20px",
                    }}
                  >
                    Today the market is{" "}
                    <span
                      style={{
                        background: HERITAGE_GOLD,
                        color: "var(--espresso)",
                        padding: "2px 14px",
                        borderRadius: 8,
                        display: "inline-block",
                        transform: "rotate(-1deg)",
                        boxShadow: "0 4px 0 rgba(0,0,0,0.15)",
                      }}
                    >
                      {briefing.market_pulse.sentiment_word}
                    </span>
                    .
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
                    }}
                  >
                    {briefing.market_pulse.narrative}
                  </p>
                  {(briefing.market_pulse.headlines ?? []).length > 0 && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {(briefing.market_pulse.headlines ?? []).slice(0, 4).map((h, i) => {
                        const hTone = normaliseTone((h as { tone?: string }).tone ?? null);
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
                            }}
                          >
                            <span style={{ fontSize: 13, color: "var(--cream)", fontWeight: 500 }}>
                              {h.title}
                            </span>
                            <SentimentPill tone={hTone} size="sm" />
                          </div>
                        );
                        return h.href ? (
                          <a
                            key={i}
                            href={h.href}
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
            )}

            {/* ── Today's Lead ── */}
            <section style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <span
                  className="font-sans"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: HERITAGE_GOLD,
                    color: "var(--espresso)",
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

              {/* 3-column structured body */}
              {(briefing.lead_paragraph || briefing.supporting_context || briefing.what_to_watch) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {[
                    { n: "1", label: "The Lead", body: briefing.lead_paragraph },
                    { n: "2", label: "The Context", body: briefing.supporting_context },
                    { n: "3", label: "What to Watch", body: briefing.what_to_watch },
                  ].map((p, i) => (
                    <div
                      key={i}
                      style={{
                        background: "var(--cream)",
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
                        {p.body || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Names to Watch strip */}
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
                    alignItems: "center",
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
                    }}
                  >
                    ▶ Names to watch
                  </span>
                  {briefing.top_deals.slice(0, 5).map((d, i) => (
                    <div
                      key={i}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        background: "var(--cream)",
                        border: "1px solid var(--border-base)",
                        borderRadius: 20,
                        padding: "6px 12px",
                      }}
                    >
                      <span
                        className="font-data"
                        style={{ fontSize: 12, fontWeight: 800, color: "var(--espresso)" }}
                      >
                        {d.company}
                      </span>
                      <span className="font-sans" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                        {d.deal_type || d.one_liner || ""}
                      </span>
                      {d.value && (
                        <span
                          className="font-data"
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "var(--espresso)",
                            background: "var(--gold-muted)",
                            padding: "2px 8px",
                            borderRadius: 4,
                          }}
                        >
                          {d.value}
                        </span>
                      )}
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

            {/* ── Analyst Briefing ── */}
            {tabs.length > 0 && (
              <section style={{ marginBottom: 40 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
                  <h3
                    className="font-[family-name:var(--font-playfair-display)]"
                    style={{ fontSize: 26, fontWeight: 800, color: "var(--espresso)", margin: 0, letterSpacing: "-0.015em" }}
                  >
                    Analyst Briefing
                  </h3>
                  <div style={{ display: "flex", background: "var(--parchment-mid)", borderRadius: 20, padding: 3 }}>
                    {(["editorial", "dashboard"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setBriefView(m)}
                        className="font-sans cursor-pointer"
                        style={{
                          padding: "6px 14px",
                          borderRadius: 17,
                          border: "none",
                          background: briefView === m ? HERITAGE_GOLD : "transparent",
                          color: briefView === m ? "var(--espresso)" : "var(--text-secondary)",
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: "0.10em",
                          textTransform: "uppercase",
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab pills */}
                <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                  {tabs.map((t) => {
                    const active = activeTabKey === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setActiveTabKey(t.key)}
                        className="font-sans cursor-pointer"
                        style={{
                          padding: "8px 14px",
                          borderRadius: 22,
                          border: `1.5px solid ${active ? HERITAGE_GOLD : "var(--border-base)"}`,
                          background: active ? HERITAGE_GOLD : "var(--cream)",
                          color: active ? "var(--espresso)" : "var(--text-secondary)",
                          fontSize: 12,
                          fontWeight: active ? 700 : 500,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {t.title}
                        {typeof t.count === "number" && (
                          <span
                            className="font-data"
                            style={{
                              background: active ? "var(--espresso)" : "var(--parchment-mid)",
                              color: active ? HERITAGE_GOLD : "var(--text-muted)",
                              padding: "1px 7px",
                              borderRadius: 10,
                              fontSize: 10,
                            }}
                          >
                            {t.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Active tab body — numbered gold cards */}
                {activeTab && (
                  briefView === "editorial" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                      {splitCards(activeTab.content).map((b, i) => (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "56px 1fr 120px",
                            gap: 18,
                            alignItems: "center",
                            padding: "18px 20px",
                            background: "var(--cream)",
                            border: "1px solid var(--border-base)",
                            borderRadius: 12,
                            borderLeft: `4px solid ${HERITAGE_GOLD}`,
                          }}
                        >
                          <div
                            className="font-[family-name:var(--font-playfair-display)]"
                            style={{ fontSize: 36, fontWeight: 800, color: HERITAGE_GOLD, lineHeight: 1, letterSpacing: "-0.02em" }}
                          >
                            {String(i + 1).padStart(2, "0")}
                          </div>
                          <p
                            className="font-sans"
                            style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text-primary)", margin: 0 }}
                          >
                            <strong style={{ fontWeight: 700, color: "var(--espresso)" }}>{b.lead}</strong>
                            {b.rest}
                          </p>
                          <div style={{ textAlign: "right" }}>
                            <SentimentPill tone={tone} size="sm" />
                          </div>
                        </div>
                      ))}
                      {/* Rating + memo actions */}
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setMemoTitle(activeTab.title);
                            setMemoContent(stripHtml(activeTab.content));
                            setMemoOpen(true);
                          }}
                          className="font-sans text-[11px] font-semibold cursor-pointer"
                          style={{ color: "var(--gold-dark)" }}
                        >
                          Generate memo →
                        </button>
                        <span style={{ flex: 1 }} />
                        <button
                          type="button"
                          onClick={() => handleSectionRate(activeTab.key, 1)}
                          className={cn(
                            "font-sans text-[11px] px-2 py-1 rounded cursor-pointer",
                          )}
                          style={{
                            color: sectionRatings[activeTab.key] === 1 ? HERITAGE_GOLD : "var(--text-muted)",
                          }}
                          aria-label="Useful"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSectionRate(activeTab.key, -1)}
                          className="font-sans text-[11px] px-2 py-1 rounded cursor-pointer"
                          style={{
                            color: sectionRatings[activeTab.key] === -1 ? HERITAGE_GOLD : "var(--text-muted)",
                          }}
                          aria-label="Not useful"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Dashboard mode — render all tabs side-by-side
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: tabs.length <= 2 ? "1fr" : "60fr 40fr" }}
                    >
                      <div className="flex flex-col gap-3">
                        {splitCards(tabs[0].content).map((b, i) => (
                          <div
                            key={i}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "56px 1fr 100px",
                              gap: 18,
                              alignItems: "center",
                              padding: "18px 20px",
                              background: "var(--cream)",
                              border: "1px solid var(--border-base)",
                              borderRadius: 12,
                              borderLeft: `4px solid ${HERITAGE_GOLD}`,
                            }}
                          >
                            <div
                              className="font-[family-name:var(--font-playfair-display)]"
                              style={{ fontSize: 36, fontWeight: 800, color: HERITAGE_GOLD, lineHeight: 1 }}
                            >
                              {String(i + 1).padStart(2, "0")}
                            </div>
                            <p className="font-sans" style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text-primary)", margin: 0 }}>
                              <strong style={{ fontWeight: 700, color: "var(--espresso)" }}>{b.lead}</strong>
                              {b.rest}
                            </p>
                            <div style={{ textAlign: "right" }}>
                              <SentimentPill tone={tone} size="sm" />
                            </div>
                          </div>
                        ))}
                      </div>
                      {tabs.length > 1 && (
                        <div className="flex flex-col gap-3">
                          {tabs.slice(1).map((t) => (
                            <div
                              key={t.key}
                              style={{
                                background: "var(--cream)",
                                border: "1px solid var(--border-base)",
                                borderRadius: 12,
                                borderLeft: `4px solid ${HERITAGE_GOLD}`,
                                padding: "14px 16px",
                              }}
                            >
                              <p
                                className="font-sans"
                                style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--gold-dark)", fontWeight: 700, margin: "0 0 6px" }}
                              >
                                {t.title}
                              </p>
                              <p
                                className="font-sans"
                                style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-primary)", margin: 0 }}
                              >
                                {stripHtml(t.content).slice(0, 260)}
                                {stripHtml(t.content).length > 260 ? "…" : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )}
              </section>
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
                  style={{ background: HERITAGE_GOLD, color: "var(--cream)" }}
                >
                  Sign in with Google — Free
                </button>
              </div>
            )}

            {/* ── Today's Stories ── */}
            {rankedStories.length > 0 && (
              <section>
                <h3
                  className="font-[family-name:var(--font-playfair-display)]"
                  style={{ fontSize: 26, fontWeight: 800, color: "var(--espresso)", margin: "0 0 18px", letterSpacing: "-0.015em" }}
                >
                  {storiesLabel}
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                  {(user === null ? rankedStories.slice(0, 3) : rankedStories).map((s, i) => {
                    const storyTone = normaliseTone(s.sentiment);
                    const row = (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "44px 1fr auto",
                          gap: 18,
                          alignItems: "center",
                          padding: "16px 20px",
                          background: "var(--cream)",
                          border: "1px solid var(--border-base)",
                          borderRadius: 12,
                        }}
                      >
                        <span
                          className="font-[family-name:var(--font-playfair-display)]"
                          style={{ fontSize: 30, fontWeight: 800, color: HERITAGE_GOLD, lineHeight: 1 }}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <h4
                            className="font-[family-name:var(--font-playfair-display)]"
                            style={{ fontSize: 17, fontWeight: 700, color: "var(--espresso)", margin: "0 0 6px", lineHeight: 1.25, letterSpacing: "-0.01em" }}
                          >
                            {s.title}
                          </h4>
                          <div
                            className="font-sans"
                            style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 11, color: "var(--text-secondary)" }}
                          >
                            {s.sector && (
                              <span
                                style={{
                                  padding: "2px 8px",
                                  background: "var(--gold-muted)",
                                  color: "var(--gold-dark)",
                                  borderRadius: 4,
                                  fontWeight: 700,
                                  letterSpacing: "0.06em",
                                  fontSize: 10,
                                  textTransform: "uppercase",
                                }}
                              >
                                {s.sector}
                              </span>
                            )}
                            <span>{s.source}</span>
                            <span style={{ color: "var(--text-faint)" }}>·</span>
                            <span className="font-data" style={{ fontSize: 10 }}>
                              {s.timestamp}
                            </span>
                          </div>
                        </div>
                        <SentimentPill tone={storyTone} size="sm" />
                      </div>
                    );
                    return s.url ? (
                      <a
                        key={s.id}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        {row}
                      </a>
                    ) : (
                      <div key={s.id}>{row}</div>
                    );
                  })}
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
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={memoTitle}
        content={memoContent}
        type="brief"
      />
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
