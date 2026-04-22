"use client";

import { useState, useEffect, useMemo } from "react";
import { AppShell } from "@/components/shell";
import { PanelWidget } from "@/components/shell/right-panel";
import { TickerStrip } from "@/components/brief/ticker-strip";
import { MarketPulse } from "@/components/brief/market-pulse";
import { LeadHero } from "@/components/brief/lead-hero";
import { BriefSection } from "@/components/brief/brief-section";
import { SectorSignalCard } from "@/components/brief/sector-signal-card";
import { TopDeals } from "@/components/brief/top-deals";
import { TopStories } from "@/components/brief/top-stories";
import { ExportMenu } from "@/components/brief/export-menu";
import { ShareButton } from "@/components/brief/share-button";
import { ActiveThesesWidget } from "@/components/dashboard/active-theses-widget";
import { WatchlistWidget } from "@/components/dashboard/watchlist-widget";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";
import { FileText, AlignLeft, LayoutGrid } from "lucide-react";
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
  id?: string;
  headline?: string;
  summary?: string;
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
  const [sectionRatings, setSectionRatings] = useState<Record<string, number>>({});
  const [leadMemoOpen, setLeadMemoOpen] = useState(false);
  const [leadMemoContent, setLeadMemoContent] = useState("");
  const [toast, setToast] = useState("");
  const [user, setUser] = useState<{ id: string; email?: string | null } | null | undefined>(undefined);
  const [showSignIn, setShowSignIn] = useState(false);
  const [formatLabel, setFormatLabel] = useState<string | null>(null);
  const [userAddendum, setUserAddendum] = useState<string | null>(null);
  const [briefView, setBriefView] = useState<"editorial" | "dashboard">("editorial");
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const router = useRouter();

  // Persist brief view preference
  useEffect(() => {
    const stored = localStorage.getItem("signalera_brief_view");
    if (stored === "editorial" || stored === "dashboard") setBriefView(stored);
  }, []);
  useEffect(() => {
    localStorage.setItem("signalera_brief_view", briefView);
  }, [briefView]);

  // Fetch existing section ratings on mount
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
            market_tone: b.market_tone,
            sections: sections || {},
            sector_breakdown: sectorBreakdown || {},
            top_deals: Array.isArray(topDeals) ? topDeals : [],
            deals: b.deals || [],
            created_at: b.created_at,
            market_pulse: marketPulse,
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
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
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

  // Dashboard-mode weighted grid: longest section gets the full row, others share half-width.
  const dashboardSections = useMemo(() => {
    if (sections.length === 0) return [] as Array<typeof sections[number] & { span: number }>;
    const scored = sections.map((s) => ({ ...s, score: (s.content ?? "").length }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s, i) => ({ ...s, span: i === 0 ? 6 : 3 }));
  }, [sections]);

  // Default active tab to first section key (or preserve if still valid)
  useEffect(() => {
    if (sections.length === 0) return;
    const stillValid = activeTabKey && sections.some((s) => s.key === activeTabKey);
    if (!stillValid) setActiveTabKey(sections[0].key);
  }, [sections, activeTabKey]);

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
      mood={
        briefing?.market_tone?.toLowerCase().includes("bearish") || briefing?.market_tone?.toLowerCase().includes("risk-off")
          ? "risk-off"
          : briefing?.market_tone?.toLowerCase().includes("bullish") || briefing?.market_tone?.toLowerCase().includes("risk-on")
            ? "risk-on"
            : "neutral"
      }
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
            <MarketPulse pulse={briefing?.market_pulse} />
            <LeadHero
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

            {/* Per-user personalized addendum from user_synthesis pipeline */}
            {userAddendum && (
              <div className="mb-4 px-4 py-3 rounded-xl border border-gold/20 bg-gold-muted/30">
                <p className="font-sans text-[10px] uppercase tracking-widest font-bold text-gold mb-1.5">
                  Your Personalized Briefing
                </p>
                <p className="font-sans text-[12px] text-text-primary leading-relaxed whitespace-pre-line">
                  {userAddendum}
                </p>
              </div>
            )}

            {/* Export & Share */}
            <div className="flex items-center gap-2 mb-4">
              {user === null ? (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setShowSignIn(true)}
                >
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
                <TopDeals deals={briefing.top_deals} />
              </section>
            )}

            {/* Analyst briefing sections */}
            {sections.length > 0 && (
              <section className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted">
                    Analyst Briefing
                  </h2>
                  <div className="flex border border-border-base rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setBriefView("editorial")}
                      className={cn(
                        "p-1.5 transition-colors cursor-pointer",
                        briefView === "editorial" ? "bg-gold text-cream" : "text-text-muted hover:text-text-secondary",
                      )}
                      aria-label="Editorial view"
                    >
                      <AlignLeft size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setBriefView("dashboard")}
                      className={cn(
                        "p-1.5 transition-colors cursor-pointer",
                        briefView === "dashboard" ? "bg-gold text-cream" : "text-text-muted hover:text-text-secondary",
                      )}
                      aria-label="Dashboard view"
                    >
                      <LayoutGrid size={14} />
                    </button>
                  </div>
                </div>

                {briefView === "editorial" ? (
                  <>
                    {/* Tab row */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {sections.map((section) => (
                        <button
                          key={section.key}
                          type="button"
                          onClick={() => setActiveTabKey(section.key)}
                          className={cn(
                            "font-sans text-[11px] px-3 py-1.5 rounded-full border transition-all cursor-pointer",
                            activeTabKey === section.key
                              ? "bg-espresso text-cream border-espresso"
                              : "bg-transparent text-text-secondary border-border-base hover:border-border-hover",
                          )}
                        >
                          {SECTION_TITLES[section.key] || section.key}
                        </button>
                      ))}
                    </div>

                    {/* Active tab content — full width */}
                    <div className="grid grid-cols-1 gap-2.5">
                      {(() => {
                        const active = sections.find((s) => s.key === activeTabKey) ?? sections[0];
                        if (!active) return null;
                        return (
                          <BriefSection
                            key={active.key}
                            title={active.title}
                            content={active.content}
                            fullWidth
                            expanded={expandedSection === active.key}
                            onToggle={() => setExpandedSection(expandedSection === active.key ? null : active.key)}
                            onGenerateMemo={() => {
                              setMemoTitle(active.title);
                              setMemoContent(stripHtml(active.content));
                              setMemoOpen(true);
                            }}
                            addingThesis={addingThesis}
                            onAddThesis={async () => {
                              setAddingThesis(true);
                              try {
                                await getSupabase().from("theses").insert({
                                  title: active.title,
                                  conviction: "WATCH",
                                  sector: "General",
                                  rationale: stripHtml(active.content),
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
                            sectionKey={active.key}
                            onRate={handleSectionRate}
                            currentRating={sectionRatings[active.key] ?? 0}
                          />
                        );
                      })()}
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-6 gap-2.5">
                    {dashboardSections.map((section) => (
                      <div
                        key={section.key}
                        className={section.span === 6 ? "col-span-6" : "col-span-3"}
                      >
                        <BriefSection
                          title={section.title}
                          content={section.content}
                          fullWidth
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
                          sectionKey={section.key}
                          onRate={handleSectionRate}
                          currentRating={sectionRatings[section.key] ?? 0}
                        />
                      </div>
                    ))}
                  </div>
                )}
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
              <TopStories
                stories={rankedStories}
                label={storiesLabel}
                gateLimit={user === null ? 3 : rankedStories.length}
                onSignInPrompt={() => setShowSignIn(true)}
                watchlistTickers={profile?.watchlist_tickers ?? []}
              />
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
