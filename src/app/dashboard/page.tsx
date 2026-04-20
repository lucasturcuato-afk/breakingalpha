"use client";

import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { useUserProfile } from "@/hooks/useUserProfile";
import { PanelWidget } from "@/components/shell/right-panel";
import {
  Greeting,
  StatCard,
  AISignalBar,
  LeadStoryCard,
  CompactStoryCard,
  DailyBriefsWidget,
  ActiveThesesWidget,
  WatchlistWidget,
  OnboardingBanner,
  SystemIntelligenceWidget,
  WatchlistFeed,
} from "@/components/dashboard";
import type { StoryData } from "@/components/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import { sortByRelevance, isOnWatchlist } from "@/lib/personalization";
import type { ContentDescriptor } from "@/lib/personalization";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

const sparkSignals = [3, 5, 2, 7, 4, 8, 6, 9, 5, 11, 8, 14];

interface MarketIndices {
  spx: { value: string; pct: number } | null;
  vix: { value: string; pct: number } | null;
  tnx: { value: string; pct: number } | null;
}

// ── "For You" scoring helpers ──

function storyToContent(story: StoryData): ContentDescriptor {
  return {
    sectors: [story.sector, ...(story.industry_verticals ?? [])].filter(Boolean) as string[],
    tickers: story.tags ?? [],
    title: story.title,
    categories: story.activity_types ?? [],
  };
}

function sectorMatches(articleSector: string | undefined, profileSectors: string[]): boolean {
  if (!articleSector) return false;
  const lower = articleSector.toLowerCase();
  return profileSectors.some((ps) => {
    const pl = ps.toLowerCase();
    return lower.includes(pl) || pl.includes(lower);
  });
}

export default function DashboardPage() {
  const { profile } = useUserProfile();
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storyCount, setStoryCount] = useState(0);
  const [indices, setIndices] = useState<MarketIndices>({ spx: null, vix: null, tnx: null });
  const [storyTab, setStoryTab] = useState<"for-you" | "all">("all");

  useEffect(() => {
    async function loadStories() {
      try {
        const supabase = getSupabase();

        // Count articles ingested today (since midnight UTC)
        const todayMidnight = new Date();
        todayMidnight.setUTCHours(0, 0, 0, 0);
        const { count } = await supabase
          .from("articles")
          .select("id", { count: "exact", head: true })
          .gte("ingested_at", todayMidnight.toISOString());
        setStoryCount(count ?? 0);

        // Get top 4 stories
        const { data, error } = await supabase
          .from("articles")
          .select("id, title, source, summary, content, sector, industry_verticals, activity_types, sentiment, published_at, ingested_at, url, companies, relevance_score")
          .order("relevance_score", { ascending: false })
          .order("ingested_at", { ascending: false })
          .limit(4);

        if (error) {
          console.error("Dashboard stories query error:", error.message);
          return;
        }

        if (data) {
          // Fetch source credibility in one batched query
          let credMap = new Map<string, number>();
          try {
            const sources = [...new Set(data.map((a) => a.source).filter(Boolean))] as string[];
            if (sources.length > 0) {
              const { data: credData } = await supabase
                .from("source_credibility")
                .select("source, win_rate")
                .in("source", sources);
              credMap = new Map(credData?.map((r: { source: string; win_rate: number }) => [r.source, r.win_rate]) ?? []);
            }
          } catch {
            // credibility data is optional
          }

          setStories(
            data.map((a) => {
              const completeness = getCompleteness(a.content, a.summary);
              const adjustedScore = getAdjustedScore(a.relevance_score, completeness);
              return {
                id: a.id,
                title: a.title || "Untitled",
                source: a.source || "Unknown",
                timestamp: timeAgo(a.published_at || a.ingested_at),
                sentiment: (a.sentiment || "neutral").toLowerCase(),
                sector: a.sector || undefined,
                industry_verticals: a.industry_verticals ?? [],
                activity_types: a.activity_types ?? [],
                summary: a.summary || undefined,
                tags: (() => {
                  if (!a.companies) return undefined;
                  try {
                    const parsed = typeof a.companies === "string" ? JSON.parse(a.companies) : a.companies;
                    return Array.isArray(parsed) ? parsed.slice(0, 3) : undefined;
                  } catch { return undefined; }
                })(),
                url: a.url || undefined,
                read: false,
                saved: false,
                completeness,
                adjustedScore,
                sourceWinRate: credMap.get(a.source) ?? null,
              };
            }),
          );
        }
      } catch (e) {
        console.error("Failed to load dashboard stories:", e);
      } finally {
        setStoriesLoading(false);
      }
    }
    loadStories();
  }, []);

  useEffect(() => {
    async function loadIndices() {
      try {
        const res = await fetch("/api/market-indices");
        if (!res.ok) return;
        const data = await res.json();
        setIndices({
          spx: data.spx ?? null,
          vix: data.vix ?? null,
          tnx: data.tnx ?? null,
        });
      } catch {
        // Leave indices as null — cards will show "—"
      }
    }
    loadIndices();
  }, []);

  // Switch to "For You" tab when profile is loaded and onboarded
  useEffect(() => {
    if (profile?.onboarding_completed) {
      setStoryTab("for-you");
    }
  }, [profile]);

  // "For You" scored + sorted stories
  const forYouStories = useMemo(() => {
    if (!profile) return stories;
    return sortByRelevance(stories, profile, storyToContent);
  }, [stories, profile]);

  const displayStories = storyTab === "for-you" ? forYouStories : stories;
  const watchlistTickers = profile?.watchlist_tickers ?? [];

  // Personalized greeting subtitle
  const greetingSubtitle = useMemo(() => {
    if (!profile || !profile.onboarding_completed) return undefined;

    // Check watchlist ticker mentions
    if (watchlistTickers.length > 0) {
      for (const ticker of watchlistTickers) {
        const mentionCount = stories.filter((s) =>
          `${s.title} ${s.tags?.join(" ") ?? ""}`.toUpperCase().includes(ticker.toUpperCase())
        ).length;
        if (mentionCount > 0) {
          return `${ticker} is moving — ${mentionCount} signal${mentionCount !== 1 ? "s" : ""} in your feed about it.`;
        }
      }
    }

    // Sector-based subtitle
    const sectors = profile.sectors ?? [];
    if (sectors.length > 0) {
      const topSector = sectors[0];
      const sectorCount = stories.filter((s) => sectorMatches(s.sector, [topSector])).length;
      if (sectorCount > 0) {
        return `${sectorCount} ${topSector} signal${sectorCount !== 1 ? "s" : ""} in your feed today.`;
      }
    }

    // Risk appetite defensive
    if (profile.risk_appetite === "defensive") {
      return "Risk-off conditions detected — prioritizing macro signals.";
    }

    return undefined;
  }, [profile, stories, watchlistTickers]);

  return (
    <AppShell
      pageTitle="Dashboard"
      mood="risk-off"
      moodHeadline="Risk-Off regime"
      moodDetails={["VIX 18.5 ▲", "10Y 4.52%", "DXY strengthening"]}
      rightPanel={
        <>
          <PanelWidget title="Daily Briefs">
            <DailyBriefsWidget />
          </PanelWidget>
          <PanelWidget title="Active Theses">
            <ActiveThesesWidget />
          </PanelWidget>
          <PanelWidget title="Watchlist">
            <WatchlistWidget />
          </PanelWidget>
        </>
      }
    >
      <div className="px-6 py-4 max-w-[960px]">
        {/* Onboarding banner */}
        <OnboardingBanner />

        {/* Greeting */}
        <Greeting
          storyCount={storyCount}
          context={greetingSubtitle ?? "markets are adjusting to new export policy data."}
        />

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-2.5 mt-4">
          <StatCard
            label="S&P 500"
            value={indices.spx?.value ?? "—"}
            change={indices.spx?.pct ?? 0}
            accentGold
            detailRows={[]}
          />
          <StatCard
            label="VIX Fear Index"
            value={indices.vix?.value ?? "—"}
            change={indices.vix?.pct ?? 0}
            detailRows={[]}
          />
          <StatCard
            label="10Y Yield"
            value={indices.tnx?.value ?? "—"}
            change={indices.tnx?.pct ?? 0}
            detailRows={[]}
          />
          <StatCard
            label="Signals Today"
            value={String(storyCount)}
            change={0}
            accentGold
            sparkData={sparkSignals}
            detailRows={[
              { label: "Bullish", value: "—" },
              { label: "Bearish", value: "—" },
            ]}
          />
        </div>

        {/* System Intelligence */}
        <div className="mt-2">
          <SystemIntelligenceWidget />
        </div>

        {/* AI signal bar */}
        <div className="mt-3">
          <AISignalBar
            text="Fed language shift detected across 3 FOMC transcripts — dovish pivot probability rising. Bond markets already pricing in."
            boldParts={["Fed language shift", "dovish pivot probability rising"]}
          />
        </div>

        {/* Watchlist Feed */}
        <div className="mt-4">
          <WatchlistFeed />
        </div>

        {/* Stories section */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h2 className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                Top Stories — hover to expand
              </h2>
              {/* Tab bar */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStoryTab("for-you")}
                  className={cn(
                    "font-sans text-[11px] pb-1 cursor-pointer transition-colors border-b-2",
                    storyTab === "for-you"
                      ? "border-gold text-gold font-semibold"
                      : "border-transparent text-text-muted hover:text-text-secondary",
                  )}
                >
                  For You
                </button>
                <button
                  type="button"
                  onClick={() => setStoryTab("all")}
                  className={cn(
                    "font-sans text-[11px] pb-1 cursor-pointer transition-colors border-b-2",
                    storyTab === "all"
                      ? "border-gold text-gold font-semibold"
                      : "border-transparent text-text-muted hover:text-text-secondary",
                  )}
                >
                  All
                </button>
              </div>
            </div>
            <Link
              href="/live-feed"
              className="font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
            >
              View all →
            </Link>
          </div>

          {storiesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          ) : displayStories.length === 0 ? (
            <EmptyState
              icon={<FileText size={32} />}
              title="No stories yet"
              description="Stories will appear once articles are ingested by the pipeline."
            />
          ) : (
            <>
              {/* Lead story */}
              <div className="relative">
                {storyTab === "for-you" && (displayStories[0].tags ?? []).some((t) => isOnWatchlist(t, profile)) && (
                  <span className="inline-flex items-center gap-1 font-sans text-[10px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5 mb-1">
                    Watching
                  </span>
                )}
                <LeadStoryCard story={displayStories[0]} />
              </div>

              {/* Compact stories */}
              <div className="mt-2 space-y-0">
                {displayStories.slice(1).map((story, i) => (
                  <div key={story.id}>
                    {storyTab === "for-you" && (story.tags ?? []).some((t) => isOnWatchlist(t, profile)) && (
                      <span className="inline-flex items-center gap-1 font-sans text-[10px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5 ml-3 mb-0.5">
                        Watching
                      </span>
                    )}
                    <CompactStoryCard story={story} number={i + 2} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
