"use client";

import { useState, useEffect, useMemo } from "react";
import { AppShell } from "@/components/shell";
import { PanelWidget } from "@/components/shell/right-panel";
import { TickerStrip } from "@/components/brief/ticker-strip";
import { BriefHeader } from "@/components/brief/brief-header";
import { BriefSection } from "@/components/brief/brief-section";
import { DealCard } from "@/components/brief/deal-card";
import { SectorSignalCard } from "@/components/brief/sector-signal-card";
import { LeadStoryCard, CompactStoryCard } from "@/components/dashboard/story-card";
import { ActiveThesesWidget } from "@/components/dashboard/active-theses-widget";
import { WatchlistWidget } from "@/components/dashboard/watchlist-widget";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
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
import { useUserProfile } from "@/hooks/useUserProfile";
import { sortByRelevance, isOnWatchlist } from "@/lib/personalization";
import type { ContentDescriptor } from "@/lib/personalization";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const SECTION_ICONS: Record<string, string> = {
  macro_and_rates: "\u{1F3E6}",
  deals_and_ma: "\u{1F4BC}",
  public_markets: "\u{1F4CA}",
  geopolitics: "\u{1F30D}",
  sector_spotlight: "\u{1F526}",
  what_to_watch: "\u{1F441}",
  tomorrow_setup: "\u{1F305}",
};

const SECTION_TITLES: Record<string, string> = {
  macro_and_rates: "Macro & Rates",
  deals_and_ma: "Deals & M&A",
  public_markets: "Public Markets",
  geopolitics: "Geopolitics",
  sector_spotlight: "Sector Spotlight",
  what_to_watch: "What to Watch",
  tomorrow_setup: "Tomorrow's Setup",
};

interface TopDeal {
  company: string;
  value?: string;
  deal_type?: string;
  one_liner?: string;
}

interface BriefingData {
  headline?: string;
  summary?: string;
  market_tone?: string;
  sections?: Record<string, string>;
  sector_breakdown?: Record<string, string>;
  top_deals?: TopDeal[];
  deals?: DealData[];
  top_stories?: StoryData[];
  created_at?: string;
}

function storyToContent(story: StoryData): ContentDescriptor {
  return {
    sectors: [story.sector].filter(Boolean) as string[],
    tickers: story.tags ?? [],
    title: story.title,
  };
}

export default function MorningBriefPage() {
  const { profile } = useUserProfile();
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLabel, setStoriesLabel] = useState("Top Stories");
  const [isStale, setIsStale] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<"success" | "stub" | "error" | null>(null);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoTitle, setMemoTitle] = useState("");
  const [memoContent, setMemoContent] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [addingThesis, setAddingThesis] = useState(false);
  const [leadMemoOpen, setLeadMemoOpen] = useState(false);
  const [leadMemoContent, setLeadMemoContent] = useState("");
  const [toast, setToast] = useState("");
  const [user, setUser] = useState<{ id: string } | null | undefined>(undefined);
  const [showSignIn, setShowSignIn] = useState(false);
  const [formatLabel, setFormatLabel] = useState<string | null>(null);
  const router = useRouter();

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
        const res = await fetch("/api/briefing?type=morning", { headers });

        // Fire-and-forget behavioral event — caller is logged in.
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
          // Parse sections if string
          const sections = typeof b.sections === "string" ? JSON.parse(b.sections) : b.sections;
          const sectorBreakdown = typeof b.sector_breakdown === "string" ? JSON.parse(b.sector_breakdown) : b.sector_breakdown;

          const topDeals = typeof b.top_deals === "string" ? JSON.parse(b.top_deals) : b.top_deals;

          setBriefing({
            headline: b.headline,
            summary: b.summary,
            market_tone: b.market_tone,
            sections: sections || {},
            sector_breakdown: sectorBreakdown || {},
            top_deals: Array.isArray(topDeals) ? topDeals : [],
            deals: b.deals || [],
            created_at: b.created_at,
          });
          setIsStale(data.is_stale === true);
          if (data.last_attempt_status) {
            setLastRunStatus(data.last_attempt_status);
          }
          if (data.personalization?.format_label) {
            setFormatLabel(data.personalization.format_label);
          }
        }

        // Fetch top stories: 24h window primary (Top Stories).
        // Falls back to 48h if fewer than 3 fresh articles, labelled "Recent Stories".
        // Uses ingested_at per schema convention (not created_at).
        const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

        let { data: articles } = await getSupabase()
          .from("articles")
          .select("id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, relevance_score")
          .gte("ingested_at", cutoff24h)
          .order("relevance_score", { ascending: false })
          .limit(8);

        let label = "Top Stories";
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

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id } : null);
    }).catch(() => setUser(null));
  }, []);

  const sectorSignals = useMemo(() => {
    if (!briefing?.sector_breakdown) return [];
    let entries = Object.entries(briefing.sector_breakdown);
    if (sectorFilter) {
      entries = entries.filter(([sector]) => sector === sectorFilter);
    }
    return entries.map(([sector, analysis]) => ({ sector, analysis }));
  }, [briefing, sectorFilter]);

  const sections = useMemo(() => {
    if (!briefing?.sections) return [];
    return Object.entries(briefing.sections).map(([key, content]) => ({
      key,
      title: `${SECTION_ICONS[key] || "\u{1F4CB}"} ${SECTION_TITLES[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
      content: (content ?? "") as string,
      fullWidth: key === "what_to_watch" || key === "tomorrow_setup",
    }));
  }, [briefing]);

  // Personalized story ordering
  const rankedStories = useMemo(() => {
    if (!profile) return stories;
    return sortByRelevance(stories, profile, storyToContent);
  }, [stories, profile]);

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
      mood="risk-off"
      moodHeadline="Risk-Off regime"
      moodDetails={["VIX 18.5", "10Y 4.52%"]}
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
            <div className="grid grid-cols-3 gap-2.5">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
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
            <BriefHeader
              type="morning"
              headline={briefing.headline || formatLabel || "Morning Market Brief"}
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
              onAddThesis={handleLeadAddThesis}
            />

            {/* Export & Share */}
            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  if (user === null) {
                    setShowSignIn(true);
                    return;
                  }
                  const content = document.querySelector("main")?.innerText || "";
                  const blob = new Blob([content], { type: "text/plain" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `signalera-morning-brief-${new Date().toISOString().slice(0, 10)}.txt`;
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

            {/* Top Deals to Watch */}
            {briefing.top_deals && briefing.top_deals.length > 0 && (
              <section className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted">
                    Top Deals to Watch
                  </h2>
                  <div className="flex-1 h-px bg-gold/15" />
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {briefing.top_deals.map((deal, i) => (
                    <div
                      key={i}
                      className={cn(
                        "p-3.5 rounded-xl border border-border-base border-t-2 border-t-gold/15 bg-white",
                        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                        "hover:-translate-y-0.5 hover:border-border-hover hover:shadow-[0_2px_12px_rgba(201,146,42,0.06)]",
                      )}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <h4 className="font-sans text-[14px] font-semibold text-espresso">
                          {deal.company}
                        </h4>
                        <span className="font-data text-[11px] font-semibold text-gold flex-shrink-0 ml-2">
                          {deal.value || "Undisclosed"}
                        </span>
                      </div>
                      {deal.deal_type && (
                        <span className="inline-block font-data text-[9px] uppercase tracking-wide font-bold text-gold bg-gold-muted px-1.5 py-0.5 rounded mb-1.5">
                          {deal.deal_type}
                        </span>
                      )}
                      {deal.one_liner && (
                        <p className="font-sans text-[11px] text-text-secondary leading-snug">
                          {stripHtml(deal.one_liner)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Analyst briefing sections */}
            {sections.length > 0 && (
              <section className="mb-6">
                <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted mb-3">
                  Analyst Briefing
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
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Sector signals */}
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
                          !sectorFilter ? "bg-espresso text-cream" : "bg-parchment-mid text-text-muted hover:text-text-primary",
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
                            sectorFilter === s ? "bg-espresso text-cream" : "bg-parchment-mid text-text-muted hover:text-text-primary",
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

            {/* Personalization nudge for signed-out users */}
            {user === null && briefing && (
              <div className="my-6 px-4 py-4 rounded-xl border text-center" style={{ background: 'rgba(245, 166, 35, 0.08)', borderColor: 'var(--gold-border)' }}>
                <p className="font-sans text-[13px] text-espresso font-semibold mb-1">
                  This brief is personalized for signed-in users.
                </p>
                <p className="font-sans text-[12px] text-text-secondary mb-3">
                  Sign in to get a brief built around your sectors and watchlist.
                </p>
                <button
                  type="button"
                  onClick={() => setShowSignIn(true)}
                  className="px-4 py-2 rounded-xl font-sans text-[12px] font-semibold cursor-pointer transition-colors"
                  style={{ background: 'var(--gold)', color: 'var(--cream)' }}
                >
                  Sign in with Google — Free
                </button>
              </div>
            )}

            {/* Stories */}
            {rankedStories.length > 0 && (
              <section>
                <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted mb-3">
                  {storiesLabel}
                </h2>
                {(() => {
                  const GATE_LIMIT = user === null ? 3 : rankedStories.length;
                  const visibleStories = rankedStories.slice(0, GATE_LIMIT);
                  const hasMore = user === null && rankedStories.length > GATE_LIMIT;
                  return (
                    <>
                      {visibleStories[0] && (
                        <div className="relative">
                          {(visibleStories[0].tags ?? []).some((t) => isOnWatchlist(t, profile)) && (
                            <span className="inline-flex items-center gap-1 font-sans text-[10px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5 mb-1">
                              Watching
                            </span>
                          )}
                          <LeadStoryCard story={visibleStories[0]} />
                        </div>
                      )}
                      <div className="mt-2">
                        {visibleStories.slice(1).map((story, i) => (
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
                      {hasMore && (
                        <div className="relative mt-2">
                          <div style={{ maxHeight: '48px', overflow: 'hidden', pointerEvents: 'none', userSelect: 'none', opacity: 0.7 }}>
                            {rankedStories[GATE_LIMIT] && (
                              <div className="bg-white border border-border-base rounded-xl p-3">
                                <p className="font-data text-[9px] text-text-muted">{rankedStories[GATE_LIMIT].source}</p>
                                <p className="font-display text-[13px] font-bold text-espresso leading-snug mt-1 line-clamp-1">{rankedStories[GATE_LIMIT].title}</p>
                              </div>
                            )}
                          </div>
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px', background: 'linear-gradient(to bottom, transparent, var(--cream))' }} />
                        </div>
                      )}
                      {hasMore && (
                        <div className="flex items-center justify-between px-3 py-2.5 mt-1 rounded-xl border" style={{ background: 'rgba(245, 166, 35, 0.08)', borderColor: 'var(--gold-border)' }}>
                          <span className="font-sans text-[12px]" style={{ color: 'var(--gold)' }}>
                            Sign in to see all {rankedStories.length} stories
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowSignIn(true)}
                            className="font-sans text-[11px] font-semibold cursor-pointer ml-3 flex-shrink-0"
                            style={{ color: 'var(--gold)', background: 'none', border: 'none', padding: 0 }}
                          >
                            Sign in →
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
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
