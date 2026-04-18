"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { PreviewContext } from "@/lib/preview-context";
import {
  Greeting,
  StatCard,
  LeadStoryCard,
  CompactStoryCard,
} from "@/components/dashboard";
import type { StoryData } from "@/components/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { FileText } from "lucide-react";
import Link from "next/link";
import { getCompleteness, getAdjustedScore } from "@/lib/article-signal";

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

export default function PreviewPage() {
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storyCount, setStoryCount] = useState(0);
  const [indices, setIndices] = useState<{
    spx: { value: string; pct: number } | null;
    vix: { value: string; pct: number } | null;
    tnx: { value: string; pct: number } | null;
  }>({ spx: null, vix: null, tnx: null });
  const [signInOpen, setSignInOpen] = useState(false);

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
          console.error("Preview stories query error:", error.message);
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
        console.error("Failed to load preview stories:", e);
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

  return (
    <PreviewContext.Provider value={true}>
      <AppShell
        pageTitle="Dashboard"
        mood="risk-off"
        moodHeadline="Risk-Off regime"
        moodDetails={["VIX 18.5 ▲", "10Y 4.52%", "DXY strengthening"]}
        isPreview={true}
      >
        <div className="p-6 space-y-5 max-w-[960px]">
          {/* Greeting */}
          <Greeting
            storyCount={storyCount}
            context="markets are adjusting to new export policy data."
          />

          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-2.5">
            <StatCard label="S&P 500" value={indices.spx?.value ?? "—"} change={indices.spx?.pct ?? 0} accentGold detailRows={[]} />
            <StatCard label="VIX Fear Index" value={indices.vix?.value ?? "—"} change={indices.vix?.pct ?? 0} detailRows={[]} />
            <StatCard label="10Y Yield" value={indices.tnx?.value ?? "—"} change={indices.tnx?.pct ?? 0} detailRows={[]} />
            <StatCard label="Signals Today" value={String(storyCount)} change={0} accentGold sparkData={sparkSignals} detailRows={[{ label: "Bullish", value: "—" }, { label: "Bearish", value: "—" }]} />
          </div>

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
                <LeadStoryCard story={stories[0]} />
                <div className="mt-2 space-y-0">
                  {stories.slice(1).map((story, i) => (
                    <CompactStoryCard key={story.id} story={story} number={i + 2} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Personalization nudge — sign-in CTA */}
          <div className="rounded-xl border border-border-base bg-parchment-mid px-5 py-4 flex items-center justify-between">
            <div>
              <p className="font-sans text-[13px] font-semibold text-espresso">Personalize your feed</p>
              <p className="font-sans text-[11px] text-text-secondary mt-0.5">Sign in to unlock sector filtering, thesis tracking, and watchlist alerts.</p>
            </div>
            <button
              type="button"
              onClick={() => setSignInOpen(true)}
              className="flex-shrink-0 ml-4 px-4 py-2 rounded-lg font-sans text-[12px] font-semibold cursor-pointer transition-all"
              style={{ backgroundColor: "var(--espresso)", color: "var(--cream)" }}
            >
              Sign in free →
            </button>
          </div>
        </div>

        <SignInModal
          isOpen={signInOpen}
          onClose={() => setSignInOpen(false)}
          headline="Sign in to personalize"
          message="Unlock sector filtering, watchlist alerts, and AI-generated briefs tailored to your portfolio."
        />
      </AppShell>
    </PreviewContext.Provider>
  );
}
