"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { PanelWidget } from "@/components/shell/right-panel";
import {
  PersonalizationBanner,
  Greeting,
  StatCard,
  AISignalBar,
  LeadStoryCard,
  CompactStoryCard,
  DailyBriefsWidget,
  ActiveThesesWidget,
  WatchlistWidget,
  OnboardingBanner,
} from "@/components/dashboard";
import type { StoryData } from "@/components/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "lucide-react";
import Link from "next/link";

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

const sparkSP = [4380, 4395, 4370, 4410, 4425, 4415, 4440, 4455, 4460, 4472, 4468, 4480];
const sparkVIX = [18.5, 17.2, 16.8, 15.9, 15.2, 14.8, 14.5, 14.1, 14.3, 14.6, 14.2, 14.2];
const sparkYield = [4.52, 4.48, 4.45, 4.42, 4.40, 4.38, 4.35, 4.33, 4.30, 4.28, 4.25, 4.22];
const sparkSignals = [3, 5, 2, 7, 4, 8, 6, 9, 5, 11, 8, 14];

export default function DashboardPage() {
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storyCount, setStoryCount] = useState(0);

  useEffect(() => {
    async function loadStories() {
      try {
        const supabase = getSupabase();

        // Get count for greeting
        const { count } = await supabase
          .from("articles")
          .select("id", { count: "exact", head: true });
        setStoryCount(count ?? 0);

        // Get top 4 stories
        const { data, error } = await supabase
          .from("articles")
          .select("id, title, source, summary, sector, sentiment, published_at, ingested_at, url, companies")
          .order("relevance_score", { ascending: false })
          .order("ingested_at", { ascending: false })
          .limit(4);

        if (error) {
          console.error("Dashboard stories query error:", error.message);
          return;
        }

        if (data) {
          setStories(
            data.map((a) => ({
              id: a.id,
              title: a.title || "Untitled",
              source: a.source || "Unknown",
              timestamp: timeAgo(a.published_at || a.ingested_at),
              sentiment: (a.sentiment || "neutral").toLowerCase(),
              sector: a.sector || undefined,
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
            })),
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
      <div className="p-6 space-y-5 max-w-[960px]">
        {/* Onboarding banner */}
        <OnboardingBanner />

        {/* Personalization banner */}
        <PersonalizationBanner />

        {/* Greeting */}
        <Greeting
          storyCount={storyCount}
          context="markets are adjusting to new export policy data."
        />

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-2.5">
          <StatCard
            label="S&P 500"
            value="4,480.22"
            change={0.38}
            accentGold
            sparkData={sparkSP}
            detailRows={[
              { label: "Day range", value: "4,370 – 4,482" },
              { label: "52w high", value: "4,818.62" },
            ]}
          />
          <StatCard
            label="VIX Fear Index"
            value="14.22"
            change={-3.12}
            sparkData={sparkVIX}
            detailRows={[
              { label: "5d avg", value: "15.1" },
              { label: "Regime", value: "Low Vol" },
            ]}
          />
          <StatCard
            label="10Y Yield"
            value="4.22%"
            change={-0.08}
            sparkData={sparkYield}
            detailRows={[
              { label: "30Y spread", value: "+42bps" },
              { label: "Real rate", value: "1.85%" },
            ]}
          />
          <StatCard
            label="Signals Today"
            value={String(storyCount)}
            change={storyCount > 0 ? 16.67 : 0}
            accentGold
            sparkData={sparkSignals}
            detailRows={[
              { label: "Bullish", value: "—" },
              { label: "Bearish", value: "—" },
            ]}
          />
        </div>

        {/* AI signal bar */}
        <AISignalBar
          text="Fed language shift detected across 3 FOMC transcripts — dovish pivot probability rising. Bond markets already pricing in."
          boldParts={["Fed language shift", "dovish pivot probability rising"]}
        />

        {/* Stories section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-sans text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Top Stories — hover to expand
            </h2>
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
          ) : stories.length === 0 ? (
            <EmptyState
              icon={<FileText size={32} />}
              title="No stories yet"
              description="Stories will appear once articles are ingested by the pipeline."
            />
          ) : (
            <>
              {/* Lead story */}
              <LeadStoryCard story={stories[0]} />

              {/* Compact stories */}
              <div className="mt-2 space-y-0">
                {stories.slice(1).map((story, i) => (
                  <CompactStoryCard key={story.id} story={story} number={i + 2} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
