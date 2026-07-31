"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import { useUserProfile } from "@/hooks/useUserProfile";
import { DashTile } from "@/components/dashboard/dash-tile";
import { CallRecord } from "@/components/dashboard/call-record";
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
import { PersonalizationBanner } from "@/components/personalization/PersonalizationBanner";
import type { StoryData } from "@/components/dashboard";
import { CompetitorAlertsWidget } from "@/components/dashboard/competitor-alerts-widget";
import { CollectiveSignalsWidget } from "@/components/dashboard/collective-signals-widget";
import { CursorGlow, DashboardIntro, DatePill } from "@/components/dashboard/dashboard-fx";
import {
  MarketCardEditor,
  MARKET_CARD_OPTIONS,
  SortableMarketCard,
  labelForSymbol,
} from "@/components/dashboard/market-card-editor";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText, Pencil, Plus, Check } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import { fetchTopStories, TOP_STORIES_MAX_AGE_DAYS } from "@/lib/top-stories";
import { sortByRelevance, isOnWatchlist } from "@/lib/personalization";
import type { ContentDescriptor } from "@/lib/personalization";
import { useLiveMood } from "@/hooks/useLiveMood";

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

const SPARK_DAYS = 12;

interface MarketCardData {
  symbol: string;
  label: string;
  value: string;
  pct: number;
  change?: number;
  displayUnit?: "percent" | "bps";
  asOf?: string | null;
  closed?: boolean;
}

const DEFAULT_MARKET_CARDS = ["SPY", "VIX", "TNX", "SIGNALS"];
const MIN_CARDS = 2;
const MAX_CARDS = 4;

// Static Tailwind classes per card count — referenced here so the v4 JIT
// content scanner picks them up (dynamic template strings would be stripped).
function gridColsForCount(n: number): string {
  switch (n) {
    case 2:
      return "grid-cols-2";
    case 3:
      return "grid-cols-3";
    case 4:
      return "grid-cols-4";
    default:
      return "grid-cols-4";
  }
}

// Return the first option not already in `used`, or null if none.
function firstAvailableSymbol(used: string[]): string | null {
  for (const opt of MARKET_CARD_OPTIONS) {
    if (!used.includes(opt.symbol)) return opt.symbol;
  }
  return null;
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
  const { profile, refetch: refetchProfile, updateProfile } = useUserProfile();
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storyCount, setStoryCount] = useState(0);
  const [marketCards, setMarketCards] = useState<Record<string, MarketCardData | null>>({});
  const [bullishCount, setBullishCount] = useState(0);
  const [bearishCount, setBearishCount] = useState(0);
  const [sparkSignals, setSparkSignals] = useState<number[]>([]);
  const [briefingHeadline, setBriefingHeadline] = useState<string | null>(null);
  const [marketTone, setMarketTone] = useState<string | null>(null);
  const [storyTab, setStoryTab] = useState<"for-you" | "all">("all");
  const [isEditingCards, setIsEditingCards] = useState(false);
  // Local override of the user's chosen cards. Used while editing, and as a
  // fallback persist-path when save fails (so UI stays consistent).
  const [marketCardsOverride, setMarketCardsOverride] = useState<string[] | null>(null);

  // DnD sensors — Pointer for mouse/stylus, Touch for mobile drag. Short
  // activation distances so small drags still register; touch uses a 150ms
  // delay so scrolling and tapping remain responsive.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  // Refetch profile when window regains focus (e.g. returning from settings)
  useEffect(() => {
    function onFocus() { refetchProfile(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetchProfile]);

  useEffect(() => {
    async function loadStories() {
      try {
        const supabase = getSupabase();

        // Count articles ingested today (since midnight UTC)
        const todayMidnight = new Date();
        todayMidnight.setUTCHours(0, 0, 0, 0);
        const [{ count }, { count: bullish }, { count: bearish }] = await Promise.all([
          supabase
            .from("articles")
            .select("id", { count: "exact", head: true })
            .gte("ingested_at", todayMidnight.toISOString()),
          supabase
            .from("articles")
            .select("id", { count: "exact", head: true })
            .gte("ingested_at", todayMidnight.toISOString())
            .ilike("sentiment", "%bullish%"),
          supabase
            .from("articles")
            .select("id", { count: "exact", head: true })
            .gte("ingested_at", todayMidnight.toISOString())
            .ilike("sentiment", "%bearish%"),
        ]);
        setStoryCount(count ?? 0);
        setBullishCount(bullish ?? 0);
        setBearishCount(bearish ?? 0);

        // Sparkline: article counts per day for last 12 days
        const sparkStart = new Date();
        sparkStart.setUTCHours(0, 0, 0, 0);
        sparkStart.setUTCDate(sparkStart.getUTCDate() - (SPARK_DAYS - 1));
        const { data: sparkRows } = await supabase
          .from("articles")
          .select("ingested_at")
          .gte("ingested_at", sparkStart.toISOString());
        if (sparkRows) {
          const buckets = new Array(SPARK_DAYS).fill(0);
          const baseMs = sparkStart.getTime();
          const dayMs = 86400000;
          for (const row of sparkRows) {
            const idx = Math.floor((new Date(row.ingested_at).getTime() - baseMs) / dayMs);
            if (idx >= 0 && idx < SPARK_DAYS) buckets[idx]++;
          }
          setSparkSignals(buckets);
        }

        // Fetch latest briefing headline + market_tone
        const { data: briefRow } = await supabase
          .from("briefings")
          .select("headline, market_tone")
          .neq("headline", "Market Intelligence Unavailable")
          .order("created_at", { ascending: false })
          .limit(1);
        if (briefRow?.[0]) {
          const b = briefRow[0] as { headline: string | null; market_tone: string | null };
          if (b.headline) setBriefingHeadline(b.headline);
          if (b.market_tone) setMarketTone(b.market_tone);
        }

        // Top Stories: highest relevance within the shared recency window.
        // See src/lib/top-stories.ts for the single-source-of-truth windows.
        const data = await fetchTopStories(supabase);

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
              // Signal is the model's native relevance_score; completeness is a
              // separate badge and no longer scales the number.
              const adjustedScore = getAdjustedScore(a.relevance_score, completeness);
              const companies = (() => {
                if (!a.companies) return undefined;
                try {
                  const parsed = typeof a.companies === "string" ? JSON.parse(a.companies) : a.companies;
                  return Array.isArray(parsed) ? parsed : undefined;
                } catch { return undefined; }
              })();
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
                tags: companies?.slice(0, 3),
                companies,
                url: a.url || undefined,
                read: false,
                saved: false,
                completeness,
                adjustedScore,
                sourceWinRate: a.source ? credMap.get(a.source) ?? null : null,
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

  // Read user's market_cards preference from profile (or use defaults).
  // When a local override is set (edit mode, optimistic UI), prefer that.
  const userMarketCards = useMemo(() => {
    if (marketCardsOverride) return marketCardsOverride;
    const raw = profile?.market_cards;
    if (Array.isArray(raw) && raw.length > 0) return raw as string[];
    return DEFAULT_MARKET_CARDS;
  }, [profile, marketCardsOverride]);

  // Edit-mode handlers — all operate on local state; persistence happens on Done.
  function swapCardSymbol(index: number, newSymbol: string) {
    setMarketCardsOverride((prev) => {
      const base = prev ?? userMarketCards;
      const next = [...base];
      next[index] = newSymbol;
      return next;
    });
  }

  function removeCardAt(index: number) {
    setMarketCardsOverride((prev) => {
      const base = prev ?? userMarketCards;
      if (base.length <= MIN_CARDS) return base;
      return base.filter((_, i) => i !== index);
    });
  }

  function addCard() {
    setMarketCardsOverride((prev) => {
      const base = prev ?? userMarketCards;
      if (base.length >= MAX_CARDS) return base;
      const next = firstAvailableSymbol(base);
      if (!next) return base;
      return [...base, next];
    });
  }

  function enterEditMode() {
    // Seed override from current cards so removals/swaps don't get clobbered.
    setMarketCardsOverride(userMarketCards);
    setIsEditingCards(true);
  }

  async function finishEditing() {
    const next = marketCardsOverride;
    setIsEditingCards(false);
    if (!next) return;

    // Unauthenticated (profile === null): skip persistence, keep local state.
    if (profile) {
      // Fire and forget — optimistic UI already shows `next` via override.
      updateProfile({ market_cards: next }).then((ok) => {
        if (ok) {
          // Clear the override so profile becomes the source of truth again.
          setMarketCardsOverride(null);
        }
        // On failure: keep override in place so UI is consistent with intent.
      });
    }
  }

  // Drag-to-reorder — update local state immediately, then persist through the
  // same path Done uses. Runs while the user is still in edit mode, so the
  // override stays set; Done clears it on success.
  function handleCardDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = userMarketCards.indexOf(String(active.id));
    const newIndex = userMarketCards.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(userMarketCards, oldIndex, newIndex);
    setMarketCardsOverride(next);

    if (profile) {
      updateProfile({ market_cards: next }).catch(() => {
        // Keep the override so the UI stays consistent with intent.
      });
    }
  }

  // Fetch market card data for user's chosen symbols
  useEffect(() => {
    async function loadMarketCards() {
      const marketSymbols = userMarketCards.filter((s) => s !== "SIGNALS");
      if (marketSymbols.length === 0) return;
      try {
        const res = await fetch(`/api/market-indices?symbols=${marketSymbols.join(",")}`);
        if (!res.ok) return;
        const data = await res.json();
        setMarketCards(data.cards ?? {});
      } catch {
        // Leave cards empty — will show "—"
      }
    }
    loadMarketCards();
  }, [userMarketCards]);

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

  // Compute mood from live VIX data
  const { mood, moodHeadline, moodDetails } = useLiveMood();

  // Shared per-card render — used by both the edit-mode sortable grid and the
  // static normal-mode grid. Returns a StatCard keyed on symbol so React list
  // reconciliation stays stable as the row order changes.
  function renderStatCard(sym: string, i: number, overlay?: ReactNode) {
    if (sym === "SIGNALS") {
      return (
        <StatCard
          key={sym}
          label={labelForSymbol("SIGNALS")}
          value={String(storyCount)}
          change={0}
          accentGold
          sparkData={sparkSignals}
          detailRows={[
            { label: "Bullish", value: String(bullishCount) },
            { label: "Bearish", value: String(bearishCount) },
          ]}
          editOverlay={overlay}
          showDivider={i > 0}
        />
      );
    }
    const card = marketCards[sym.toUpperCase()];
    return (
      <StatCard
        key={sym}
        label={card?.label ?? labelForSymbol(sym)}
        value={card?.value ?? "—"}
        change={card?.pct ?? 0}
        changeAbs={card?.change}
        displayUnit={card?.displayUnit}
        stale={card?.closed ?? false}
        accentGold={i === 0}
        detailRows={[]}
        editOverlay={overlay}
        showDivider={i > 0}
      />
    );
  }

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

    // Market tone from latest briefing
    if (marketTone) {
      const toneMap: Record<string, string> = {
        "RISK-ON": "markets are risk-on — momentum signals dominating your feed.",
        "RISK-OFF": "risk-off tone detected — defensive themes rising in your feed.",
        "MIXED": "mixed signals across sectors — watch for divergences.",
        "NEUTRAL": "markets are consolidating — monitoring for directional catalysts.",
      };
      return toneMap[marketTone] ?? undefined;
    }

    return undefined;
  }, [profile, stories, watchlistTickers, marketTone]);

  return (
    <AppShell
      pageTitle="Dashboard"
      mood={mood}
      moodHeadline={moodHeadline}
      moodDetails={moodDetails}
    >
      <div className="dash-contentwrap dash-dots max-w-[1440px] mx-auto px-6 md:px-12 py-6 md:py-8 pb-16">
        <CursorGlow />
        <DashboardIntro storyCount={storyCount} />

        {/* Onboarding banner */}
        <OnboardingBanner />
        <PersonalizationBanner />

        {/* Greeting header — kicker/title/subtitle + date pill + arrange controls */}
        <div className="dash-rise flex items-start justify-between gap-4 flex-wrap mt-1">
          <Greeting
            storyCount={storyCount}
            context={greetingSubtitle ?? "markets are adjusting to new export policy data."}
          />
          <div className="flex flex-col items-end gap-2.5 ml-auto">
            <DatePill />
            {/* Edit-mode controls: pencil to enter, Done + Plus while editing. */}
            <div className="flex items-center gap-2">
            {isEditingCards ? (
              <>
                <button
                  type="button"
                  onClick={addCard}
                  disabled={userMarketCards.length >= MAX_CARDS}
                  aria-label="Add card"
                  className={cn(
                    "inline-flex items-center gap-1 font-sans text-[10px] font-semibold",
                    "text-gold hover:text-gold-dark transition-colors cursor-pointer",
                    "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gold",
                  )}
                >
                  <Plus size={11} />
                  Add
                </button>
                <button
                  type="button"
                  onClick={finishEditing}
                  aria-label="Done editing"
                  className={cn(
                    "inline-flex items-center gap-1 font-sans text-[10px] font-semibold",
                    "text-gold hover:text-gold-dark transition-colors cursor-pointer",
                  )}
                >
                  <Check size={11} />
                  Done
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={enterEditMode}
                aria-label="Customize cards"
                className={cn(
                  "inline-flex items-center gap-1 font-sans text-[10px] font-semibold",
                  "text-gold hover:text-gold-dark transition-colors cursor-pointer",
                )}
              >
                <Pencil size={11} />
                Customize
              </button>
            )}
            </div>
          </div>
        </div>

        {/* Stat band — four editorial figure cells with count-up */}
        <div className="dash-rise mt-2" style={{ animationDelay: "80ms" }}>
          <div
            className="dash-tile relative rounded-2xl bg-white border border-border-base overflow-hidden"
            style={{ borderTop: "2px solid rgba(212,168,75,0.5)" }}
          >
            {isEditingCards ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleCardDragEnd}
              >
                <SortableContext
                  items={userMarketCards}
                  strategy={horizontalListSortingStrategy}
                >
                  <div className={cn("grid", gridColsForCount(userMarketCards.length))}>
                  {userMarketCards.map((sym, i) => {
                    const overlay: ReactNode = (
                      <MarketCardEditor
                        currentSymbol={sym}
                        selectedSymbols={userMarketCards}
                        onSwap={(next) => swapCardSymbol(i, next)}
                        onRemove={() => removeCardAt(i)}
                        disableRemove={userMarketCards.length <= MIN_CARDS}
                      />
                    );
                    return (
                      <SortableMarketCard key={sym} id={sym}>
                        {renderStatCard(sym, i, overlay)}
                      </SortableMarketCard>
                    );
                  })}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className={cn("grid", gridColsForCount(userMarketCards.length))}>
                {userMarketCards.map((sym, i) => renderStatCard(sym, i))}
              </div>
            )}
          </div>
        </div>

        {/* System Intelligence */}
        <div className="mt-2">
          <SystemIntelligenceWidget />
        </div>

        {/* AI signal bar */}
        <div className="mt-3" data-tour="ai-signal-bar">
          <AISignalBar
            text={briefingHeadline ?? "Loading intelligence briefing..."}
            boldParts={[]}
          />
        </div>

        {/* Radar row — The Watch (watchlist feed) + Your calls (active theses) */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-[18px] items-start">
          <WatchlistFeed riseDelay={120} />
          <DashTile title="Your calls" subtitle="graded track record" riseDelay={180}>
            <CallRecord />
            <div className="mt-4 pt-4 border-t border-border-subtle">
              <ActiveThesesWidget />
            </div>
          </DashTile>
        </div>

        {/* Follow row — Watchlist + Following (competitor + community signals) */}
        <div className="mt-[18px] grid grid-cols-1 lg:grid-cols-[1fr_1.9fr] gap-[18px] items-start">
          <DashTile title="Watchlist" riseDelay={240}>
            <WatchlistWidget />
          </DashTile>
          <DashTile title="Following" subtitle="desks & sectors you track" riseDelay={300}>
            <div className="space-y-5">
              <div>
                <p className="font-data text-[10px] tracking-[0.01em] text-text-faint mb-2">
                  Competitor activity
                </p>
                <CompetitorAlertsWidget />
              </div>
              <div>
                <p className="font-data text-[10px] tracking-[0.01em] text-text-faint mb-2">
                  Community signals
                </p>
                <CollectiveSignalsWidget />
              </div>
            </div>
          </DashTile>
        </div>

        {/* Daily briefs */}
        <div className="mt-[18px]">
          <DashTile title="Daily Briefs" subtitle="morning & evening" riseDelay={360}>
            <DailyBriefsWidget />
          </DashTile>
        </div>

        {/* Stories section */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h2 className="font-sans text-[11px] font-medium text-text-muted inline-flex items-center gap-1.5">
                Top Stories — hover to expand
                <InfoTooltip content={`The highest-signal stories from the last ${TOP_STORIES_MAX_AGE_DAYS} days, ranked by Signalera's relevance algorithm.`} side="bottom" iconSize={10} />
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
                  For You <InfoTooltip content="Stories ranked by relevance to your watchlist and sectors. Set up in Settings." side="bottom" iconSize={10} />
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
