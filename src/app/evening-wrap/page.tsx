"use client";

import { useState, useEffect, useMemo } from "react";
import { AppShell } from "@/components/shell";
import { PanelWidget } from "@/components/shell/right-panel";
import { TickerStrip } from "@/components/brief/ticker-strip";
import { BriefHeader } from "@/components/brief/brief-header";
import { BriefSection } from "@/components/brief/brief-section";
import { SectorSignalCard } from "@/components/brief/sector-signal-card";
import { LeadStoryCard, CompactStoryCard } from "@/components/dashboard/story-card";
import { ActiveThesesWidget } from "@/components/dashboard/active-theses-widget";
import { WatchlistWidget } from "@/components/dashboard/watchlist-widget";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";
import { Moon } from "lucide-react";
import { useRouter } from "next/navigation";
import { MemoModal } from "@/components/memo/MemoModal";
import { getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import type { StoryData } from "@/components/dashboard";
import { createBrowserClient } from "@supabase/ssr";
import { useUserProfile } from "@/hooks/useUserProfile";
import { sortByRelevance, isOnWatchlist } from "@/lib/personalization";
import { trackClientEvent } from "@/lib/track-event";
import type { ContentDescriptor } from "@/lib/personalization";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const SECTION_ICONS: Record<string, string> = {
  macro_and_rates: "🏦",
  deals_and_ma: "💼",
  public_markets: "📊",
  sector_spotlight: "🔦",
  what_to_watch: "👁",
  tomorrow_setup: "🌅",
  closing_thoughts: "💭",
};

const SECTION_TITLES: Record<string, string> = {
  macro_and_rates: "Macro & Rates",
  deals_and_ma: "Deals & M&A",
  public_markets: "Public Markets",
  sector_spotlight: "Sector Spotlight",
  what_to_watch: "What to Watch",
  tomorrow_setup: "Tomorrow's Setup",
  closing_thoughts: "Closing Thoughts",
};

interface BriefingData {
  id?: string;
  headline?: string;
  summary?: string;
  market_tone?: string;
  sections?: Record<string, string>;
  sector_breakdown?: Record<string, string>;
  created_at?: string;
}

function storyToContent(story: StoryData): ContentDescriptor {
  return {
    sectors: [story.sector].filter(Boolean) as string[],
    tickers: story.tags ?? [],
    title: story.title,
  };
}

export default function EveningWrapPage() {
  const { profile } = useUserProfile();
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLabel, setStoriesLabel] = useState("Today's Top Stories");
  const [isStale, setIsStale] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<"success" | "stub" | "error" | null>(null);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoTitle, setMemoTitle] = useState("");
  const [memoContent, setMemoContent] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [addingThesis, setAddingThesis] = useState(false);
  const [sectionRatings, setSectionRatings] = useState<Record<string, number>>({});
  const [leadMemoOpen, setLeadMemoOpen] = useState(false);
  const [leadMemoContent, setLeadMemoContent] = useState("");
  const [toast, setToast] = useState("");
  const [formatLabel, setFormatLabel] = useState<string | null>(null);
  const [userAddendum, setUserAddendum] = useState<string | null>(null);
  const router = useRouter();

  // Fetch existing section ratings on mount
  useEffect(() => {
    fetch("/api/brief-rating")
      .then(r => r.json())
      .then(d => setSectionRatings(d.ratings ?? {}))
      .catch(() => {});
  }, []);

  function handleSectionRate(sectionKey: string, rating: 1 | -1) {
    setSectionRatings(prev => ({ ...prev, [sectionKey]: rating }));
    trackClientEvent("brief_section_rated", { section_key: sectionKey, rating, briefing_id: briefing?.id });
    fetch("/api/brief-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section_key: sectionKey, rating, briefing_id: briefing?.id ?? null }),
    }).catch(() => {});
  }

  useEffect(() => {
    async function load() {
      try {
        // Fetch briefing with Bearer token so /api/briefing can personalize
        // sections + sector_breakdown against user_profiles.
        const supabase = getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = {};
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }
        const res = await fetch("/api/briefing?type=evening", { headers });

        if (session?.user) {
          void fetch("/api/user-events", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event_type: "evening_wrap_opened" }),
          }).catch(() => {});
        }
        const data = await res.json();
        if (data.briefing) {
          const b = data.briefing;
          const sections = typeof b.sections === "string" ? JSON.parse(b.sections) : b.sections;
          const sectorBreakdown = typeof b.sector_breakdown === "string" ? JSON.parse(b.sector_breakdown) : b.sector_breakdown;
          setBriefing({
            id: b.id,
            headline: b.headline,
            summary: b.summary,
            market_tone: b.market_tone,
            sections: sections || {},
            sector_breakdown: sectorBreakdown || {},
            created_at: b.created_at,
          });
          setIsStale(data.is_stale === true);
          if (data.last_attempt_status) {
            setLastRunStatus(data.last_attempt_status);
          }
          if (data.personalization?.format_label) {
            setFormatLabel(data.personalization.format_label);
          }
          if (typeof data.user_addendum === "string") {
            setUserAddendum(data.user_addendum);
          }
        }

        // Fetch top stories: 24h window primary (Today's Top Stories).
        // Falls back to 48h if fewer than 3 fresh articles, labelled "Recent Stories".
        // Uses ingested_at per schema convention (not created_at).
        const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

        let { data: articles, error: articlesError } = await getSupabase()
          .from("articles")
          .select("id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, relevance_score")
          .gte("ingested_at", cutoff24h)
          .order("relevance_score", { ascending: false })
          .limit(8);
        if (articlesError) console.error("Evening wrap articles error:", articlesError.message);

        let label = "Today's Top Stories";
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
          // Batch fetch source credibility
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
      } catch (e) {
        console.error("Failed to load briefing:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const sectorSignals = useMemo(() => {
    if (!briefing?.sector_breakdown) return [];
    let entries = Object.entries(briefing.sector_breakdown);
    if (sectorFilter) entries = entries.filter(([sector]) => sector === sectorFilter);
    return entries.map(([sector, analysis]) => ({ sector, analysis }));
  }, [briefing, sectorFilter]);

  const sections = useMemo(() => {
    if (!briefing?.sections) return [];
    return Object.entries(briefing.sections).map(([key, content]) => ({
      key,
      title: `${SECTION_ICONS[key] || "📋"} ${SECTION_TITLES[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
      content: (content ?? "") as string,
      fullWidth: key === "what_to_watch" || key === "tomorrow_setup" || key === "closing_thoughts",
    }));
  }, [briefing]);

  // Personalized story ordering
  const rankedStories = useMemo(() => {
    if (!profile) return stories;
    return sortByRelevance(stories, profile, storyToContent);
  }, [stories, profile]);

  return (
    <AppShell
      pageTitle="Evening Wrap"
      mood={
        briefing?.market_tone?.toLowerCase().includes("bearish") || briefing?.market_tone?.toLowerCase().includes("risk-off")
          ? "risk-off"
          : briefing?.market_tone?.toLowerCase().includes("bullish") || briefing?.market_tone?.toLowerCase().includes("risk-on")
            ? "risk-on"
            : "neutral"
      }
      moodHeadline={briefing?.market_tone || "Session closed"}
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

      <div className="p-6 max-w-[960px]">
        {loading ? (
          <div className="space-y-6">
            <Skeleton className="h-8 w-3/4" />
            <SkeletonText lines={3} />
            <div className="grid grid-cols-2 gap-2.5">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
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
            <BriefHeader
              type="evening"
              headline={briefing.headline || formatLabel || "Evening Market Wrap"}
              summary={briefing.summary || ""}
              marketTone={briefing.market_tone || "MIXED"}
              storyCount={stories.length}
              generatedAt={briefing.created_at}
              isStale={isStale}
              lastRunStatus={lastRunStatus}
              onGenerateMemo={() => {
                setLeadMemoContent(
                  [briefing.headline, briefing.summary].filter(Boolean).join("\n\n"),
                );
                setLeadMemoOpen(true);
              }}
              onAddThesis={async () => {
                setAddingThesis(true);
                try {
                  await getSupabase().from("theses").insert({
                    title: briefing.headline || "Evening Wrap Lead",
                    conviction: "WATCH",
                    sector: "General",
                    rationale: briefing.summary || "",
                    source: "Evening Wrap",
                    status: "new-signal",
                    generated_at: new Date().toISOString(),
                  });
                  router.push("/thesis-board");
                } catch (err) {
                  console.error("Failed to add thesis:", err);
                } finally {
                  setAddingThesis(false);
                }
              }}
            />

            {/* Per-user personalized addendum from user_synthesis pipeline */}
            {userAddendum && (
              <div className="mb-4 px-4 py-3 rounded-xl border border-gold/20 bg-gold-muted/30">
                <p className="font-sans text-[10px] uppercase tracking-widest font-bold text-gold mb-1.5">
                  Your Personalized Wrap
                </p>
                <p className="font-sans text-[12px] text-text-primary leading-relaxed whitespace-pre-line">
                  {userAddendum}
                </p>
              </div>
            )}

            {/* Export & Share */}
            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  const content = document.querySelector("main")?.innerText || "";
                  const blob = new Blob([content], { type: "text/plain" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `signalera-evening-wrap-${new Date().toISOString().slice(0, 10)}.txt`;
                  a.click();
                }}
                className="inline-flex items-center gap-1.5 font-sans text-[11px] px-3 py-1.5 rounded-lg border border-border-base hover:border-gold hover:text-gold text-text-secondary transition-colors cursor-pointer"
              >
                &#8595; Export Brief
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  setToast("Link copied");
                  setTimeout(() => setToast(""), 2000);
                }}
                className="inline-flex items-center gap-1.5 font-sans text-[11px] px-3 py-1.5 rounded-lg border border-border-base hover:border-gold hover:text-gold text-text-secondary transition-colors cursor-pointer"
              >
                &#8599; Share
              </button>
              {toast && (
                <span className="font-sans text-[11px] text-gold font-semibold animate-pulse">{toast}</span>
              )}
            </div>

            {sections.length > 0 && (
              <section className="mb-6">
                <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted mb-3">
                  Evening Analysis
                </h2>
                <div className="grid grid-cols-2 gap-2.5">
                  {sections.map((section) => (
                    <BriefSection
                      key={section.key}
                      title={section.title}
                      content={section.content}
                      fullWidth={section.fullWidth}
                      expanded={expandedSection === section.key}
                      onToggle={() => setExpandedSection(expandedSection === section.key ? null : section.key)}
                      onGenerateMemo={() => {
                        setMemoTitle(section.title);
                        setMemoContent(stripHtml(section.content));
                        setMemoOpen(true);
                      }}
                      addingThesis={addingThesis}
                      onAddThesis={async () => {
                        setAddingThesis(true);
                        try {
                          await getSupabase().from("theses").insert({
                            title: section.title,
                            conviction: "WATCH",
                            sector: "General",
                            rationale: stripHtml(section.content),
                            source: "Evening Wrap",
                            status: "new-signal",
                            generated_at: new Date().toISOString(),
                          });
                          router.push("/thesis-board");
                        } catch (err) {
                          console.error("Failed to add thesis:", err);
                        } finally {
                          setAddingThesis(false);
                        }
                      }}
                      sectionKey={section.key}
                      onRate={handleSectionRate}
                      currentRating={sectionRatings[section.key] ?? 0}
                    />
                  ))}
                </div>
              </section>
            )}

            {sectorSignals.length > 0 && (
              <section className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted">
                    Sector Signals
                  </h2>
                  {briefing.sector_breakdown && Object.keys(briefing.sector_breakdown).length > 1 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setSectorFilter(null)}
                        className={cn(
                          "font-data text-[9px] px-2 py-0.5 rounded-md cursor-pointer transition-colors",
                          !sectorFilter ? "bg-espresso text-cream" : "bg-parchment-mid text-text-muted",
                        )}
                      >
                        All
                      </button>
                      {Object.keys(briefing.sector_breakdown).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSectorFilter(sectorFilter === s ? null : s)}
                          className={cn(
                            "font-data text-[9px] px-2 py-0.5 rounded-md cursor-pointer transition-colors",
                            sectorFilter === s ? "bg-espresso text-cream" : "bg-parchment-mid text-text-muted",
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {sectorSignals.map((s) => (
                    <SectorSignalCard key={s.sector} sector={s.sector} analysis={s.analysis} />
                  ))}
                </div>
              </section>
            )}

            {rankedStories.length > 0 && (
              <section>
                <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted mb-3">
                  {storiesLabel}
                </h2>
                <div className="relative">
                  {(rankedStories[0].tags ?? []).some((t) => isOnWatchlist(t, profile)) && (
                    <span className="inline-flex items-center gap-1 font-sans text-[10px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5 mb-1">
                      Watching
                    </span>
                  )}
                  <LeadStoryCard story={rankedStories[0]} />
                </div>
                <div className="mt-2">
                  {rankedStories.slice(1).map((story, i) => (
                    <div key={story.id}>
                      {(story.tags ?? []).some((t) => isOnWatchlist(t, profile)) && (
                        <span className="inline-flex items-center gap-1 font-sans text-[10px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5 ml-3 mb-0.5">
                          Watching
                        </span>
                      )}
                      <CompactStoryCard story={story} number={i + 2} />
                    </div>
                  ))}
                </div>
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
