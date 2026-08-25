"use client";

import { useState, useEffect, useMemo, Suspense, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AppShell } from "@/components/shell";
import {
  DashboardScreen,
  MobileDashboardRoute,
  buildDashboardData,
  useMobileRecords,
  type DashQuote,
  type DashStage,
} from "@/components/dashboard-mobile";
import { useUserProfile } from "@/hooks/useUserProfile";
import { DashTile } from "@/components/dashboard/dash-tile";
import {
  DashboardReadyProvider,
  DashboardRevealGate,
  useDashboardReady,
  useDashboardSource,
} from "@/components/dashboard/dashboard-ready";
import { DeskRecordSummary } from "@/components/dashboard/desk-record-summary";
import {
  Greeting,
  StatCard,
  AISignalBar,
  DailyBriefsWidget,
  WatchlistWidget,
  OnboardingBanner,
  SystemIntelligenceWidget,
  WatchlistFeed,
} from "@/components/dashboard";
import { PersonalizationBanner } from "@/components/personalization/PersonalizationBanner";
import type { StoryData } from "@/components/dashboard";
import { YourCallsWidget } from "@/components/dashboard/your-calls-widget";
import { FollowingWidget } from "@/components/dashboard/following-widget";
import { CursorGlow, DashboardIntro, DatePill, TileSpotlight } from "@/components/dashboard/dashboard-fx";
import { FreshRadar } from "@/components/dashboard/fresh-radar";
import { RotatingLeadHero } from "@/components/dashboard/rotating-lead-hero";
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
import { fetchTopStories, parseSourceTicker, TOP_STORIES_MAX_AGE_DAYS } from "@/lib/top-stories";
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

/**
 * The dashboard is wrapped so every source below can register with the reveal
 * gate. The provider must sit ABOVE the component that calls useDashboardSource,
 * hence the split.
 */
export default function DashboardPage() {
  return (
    <DashboardReadyProvider>
      <DashboardPageInner />
    </DashboardReadyProvider>
  );
}

function DashboardPageInner() {
  const { profile, refetch: refetchProfile, updateProfile } = useUserProfile();
  const [stories, setStories] = useState<StoryData[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  // A failed Top Stories read renders an error state. It used to fall through
  // to "No stories yet", which blamed the pipeline for a database timeout.
  const [storiesError, setStoriesError] = useState(false);
  const [storyCount, setStoryCount] = useState(0);
  // True when the count queries errored. Rendered as an explicit absence rather
  // than as 0, which would read as "no articles today".
  const [countsFailed, setCountsFailed] = useState(false);
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

  const settleStories = useDashboardSource("stories");

  useEffect(() => {
    // Cold-start: the four data groups below are independent, so they run in
    // PARALLEL and each fills its section as it resolves. Previously they ran
    // sequentially in one function, which held the hero (the slowest visual)
    // behind counts/spark/briefing round-trips and made tiles pop in one by
    // one over many seconds.
    const supabase = getSupabase();

    // 1. Stat-band counts (today + bullish/bearish split)
    async function loadCounts() {
      // count: "exact". This was count: "planned" for exactly as long as
      // `ingested_at` had no index.
      //
      // History, because the trade-off is not obvious. Before the index,
      // count: "exact" returned HTTP 500 / 57014 on EVERY call at ~3.5s. The
      // window made no difference -- 1h, 6h, 24h and 72h all timed out in
      // ~3.5s -- the signature of a sequential scan over all ~169k rows. The
      // catch swallowed it and the stat band silently showed zeros.
      //
      // count: "planned" made it return, but returned the wrong number. The
      // planner cannot estimate the selectivity of a leading-wildcard ILIKE, so
      // it fell back to a guess of 1. Measured against production on the same
      // predicate, same minute:
      //
      //             planned    exact
      //   total         285     1279
      //   bullish         1      284      <- not a rounding error
      //   bearish         1      118
      //
      // With idx_articles_ingested_at in place, count: "exact" is ~300ms and
      // correct. There is no longer a trade to make.
      //
      // If these ever regress to multi-second timeouts, check that the index
      // still exists before reaching for "planned" again -- a fast wrong number
      // is worse than a slow right one on a tile the user reads as fact.
      const todayMidnight = new Date();
      todayMidnight.setUTCHours(0, 0, 0, 0);
      const iso = todayMidnight.toISOString();
      const [total, bull, bear] = await Promise.all([
        supabase
          .from("articles")
          .select("id", { count: "exact", head: true })
          .gte("ingested_at", iso),
        supabase
          .from("articles")
          .select("id", { count: "exact", head: true })
          .gte("ingested_at", iso)
          .ilike("sentiment", "%bullish%"),
        supabase
          .from("articles")
          .select("id", { count: "exact", head: true })
          .gte("ingested_at", iso)
          .ilike("sentiment", "%bearish%"),
      ]);

      // A failed count is now VISIBLE. Previously any error fell through to the
      // initial 0 and read as "no articles today", which is a different fact
      // from "we could not count them".
      const failed = [total, bull, bear].filter((r) => r.error);
      if (failed.length > 0) {
        console.error(
          "Dashboard counts failed:",
          failed.map((r) => r.error?.message).join(" | "),
        );
        setCountsFailed(true);
        return;
      }
      setCountsFailed(false);
      setStoryCount(total.count ?? 0);
      setBullishCount(bull.count ?? 0);
      setBearishCount(bear.count ?? 0);
    }

    // 2. Signals sparkline (12-day ingest buckets)
    async function loadSpark() {
      // Reads the ALREADY-AGGREGATED per-run ingest counts instead of pulling
      // every article row and bucketing them in the browser.
      //
      // The previous version selected `ingested_at` for every article in the
      // window -- roughly 31,000 rows at current volume -- and PostgREST capped
      // the response at its default 1,000. So the sparkline was computed from
      // an arbitrary truncated 1,000 rows and was WRONG, not merely slow.
      // Measured: 633ms, `content-range: 0-999/*`, 1000 rows returned.
      //
      // pipeline_runs carries ingest_count per run and is small (201 rows over
      // the same 12-day window, 468ms).
      //
      // WHAT ingest_count IS, exactly: the number of `articles` rows INSERTED by
      // one run's ingest step -- `stored = len(article_ids)` in
      // backend/ingest.py, taken AFTER the relevance gate and AFTER dedup. It is
      // not articles fetched, not articles that passed the filter but deduped
      // away, and not articles selected for the brief (that is `selected_count`,
      // a different column). So these buckets are "new articles stored per day",
      // which is the same quantity the tile's own value shows for today.
      //
      // Verified against the source of truth: for 11 of the last 12 days, the
      // per-day sum of ingest_count equals an exact count of `articles` by
      // ingested_at, to the row.
      //
      // KNOWN GAP, do not mistake it for a bug here. ingest is step [1/16] and
      // observe.record_run() is step [4/16], so a run that stores articles and
      // then dies before reaching step 4 writes no pipeline_runs row at all.
      // The one unguarded statement in that window is run_synthesize() at
      // run.py:189; every other step between them is wrapped in a soft-fail
      // guard. 2026-08-03 is exactly that shape: 534 articles really landed, no
      // run row carries a count, and this sparkline plots 0 for that day.
      // Fixing it is a backend change (record the ingest count when ingest
      // finishes, not at step 4), not a frontend one. See
      // scratch/PIPELINE_RUN_RECORDING_GAP.md.
      //
      // Runs that never ingest (edgar_ingestion, daily_grading,
      // outcome_evaluator, xbrl_facts_ingestion) carry a null ingest_count and
      // are skipped. That is correct, not a second gap: none of them insert
      // into `articles` at all.
      try {
        const sparkStart = new Date();
        sparkStart.setUTCHours(0, 0, 0, 0);
        sparkStart.setUTCDate(sparkStart.getUTCDate() - (SPARK_DAYS - 1));
        const { data: runRows, error } = await supabase
          .from("pipeline_runs")
          .select("started_at, ingest_count")
          .gte("started_at", sparkStart.toISOString())
          .not("ingest_count", "is", null);
        if (error) {
          console.error("Failed to load dashboard sparkline:", error.message);
          return;
        }
        const buckets = new Array(SPARK_DAYS).fill(0);
        const baseMs = sparkStart.getTime();
        const dayMs = 86400000;
        for (const row of runRows ?? []) {
          const idx = Math.floor((new Date(row.started_at).getTime() - baseMs) / dayMs);
          if (idx >= 0 && idx < SPARK_DAYS) buckets[idx] += row.ingest_count ?? 0;
        }
        setSparkSignals(buckets);
      } catch (e) {
        console.error("Failed to load dashboard sparkline:", e);
      }
    }

    // 3. Latest briefing headline + market_tone (AI signal bar)
    async function loadBriefing() {
      try {
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
      } catch (e) {
        console.error("Failed to load dashboard briefing:", e);
      }
    }

    // 4. Top Stories (the hero) — the critical visual path, no longer queued
    //    behind the other three groups.
    async function loadStories() {
      try {
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
                sentimentReason: a.sentiment_reason || undefined,
                relevanceReason: a.relevance_reason || undefined,
                sourceTicker: parseSourceTicker(a.source),
              };
            }),
          );
        }
      } catch (e) {
        console.error("Failed to load dashboard stories:", e);
        setStoriesError(true);
      } finally {
        setStoriesLoading(false);
      }
    }

    // Dashboard reveal gate — page-level Supabase reads. The four groups are
    // independent and each fills its own section, so the gate waits for ALL of
    // them via allSettled: a rejected group settles exactly like a resolved
    // one, and each function already swallows its own errors into an empty
    // state, so a failure reveals the page with that section empty.
    void Promise.allSettled([
      loadCounts(),
      loadSpark(),
      loadBriefing(),
      loadStories(),
    ]).finally(() => settleStories());
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

  // Dashboard reveal gate — page-level market cards. Settles once the effect
  // above has run to completion, including its early returns (no symbols, a
  // non-ok response) and its catch, so an unpriced or dead feed reveals the
  // page with the cards showing "no quote" rather than holding it.
  const settleMarketCards = useDashboardSource("market-cards");
  useEffect(() => {
    settleMarketCards();
  }, [marketCards, settleMarketCards]);

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
          // countsFailed renders the absence. Showing "0" here would assert
          // there were no articles today, which is a different fact from "the
          // count query failed" -- and it is the fact this tile showed for as
          // long as count: "exact" was timing out.
          value={countsFailed ? "no count" : String(storyCount)}
          change={0}
          accentGold
          sparkData={sparkSignals}
          detailRows={
            countsFailed
              ? [{ label: "Counts", value: "unavailable" }]
              : [
                  { label: "Bullish", value: String(bullishCount) },
                  { label: "Bearish", value: String(bearishCount) },
                ]
          }
          editOverlay={overlay}
          showDivider={i > 0}
        />
      );
    }
    const card = marketCards[sym.toUpperCase()];
    // No card, or a card the feed could not price: render the absence. The
    // previous `card?.pct ?? 0` printed "0.00%" for a symbol nothing quoted.
    const unknown = !card || card.value === "—";
    return (
      <StatCard
        key={sym}
        label={card?.label ?? labelForSymbol(sym)}
        value={card?.value ?? "—"}
        change={card?.pct ?? 0}
        changeAbs={card?.change}
        displayUnit={card?.displayUnit}
        changeUnknown={unknown}
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

  /* ── the mobile screen's data ─────────────────────────────────────────
   *
   * Below md the phone draws its own screen beside the desktop layout, and
   * until now it drew a fixture. It reads the SAME state the widgets above
   * read; not one loader on this page is rewired, moved or re-run to feed it,
   * and the desktop tree below is byte-identical to what it was.
   *
   * `useDashboardReady` is the readiness signal, and it is free: the reveal
   * gate already registers every page-level source and flips `isReady` when
   * all of them have settled or the 10s ceiling is hit. Reading it here adds
   * no source and holds nothing back. Before it flips, `mobileData` is null
   * and the phone shows the loading skeleton rather than a half-built morning
   * with a zero count in it.
   *
   * The two record reads are the one thing this page does not already do at
   * page level; they live inside desktop widgets as component state. Lifting
   * them would be rewiring two desktop loaders, so `useMobileRecords` reads
   * the same two sources through the same two shared libraries, and only
   * below the md breakpoint, so a desktop load fires nothing extra.
   */
  const { isReady: dashRevealed } = useDashboardReady();
  const mobileRecords = useMobileRecords();
  const mobileReady = dashRevealed && mobileRecords.status !== "loading";

  const mobileData = useMemo(() => {
    if (!mobileReady) return null;
    return buildDashboardData({
      now: new Date(),
      firstName: profile?.first_name ?? null,
      storyCount,
      bullishCount,
      bearishCount,
      countsFailed,
      marketSymbols: userMarketCards,
      quotes: marketCards as Record<string, DashQuote | null | undefined>,
      briefHeadline: briefingHeadline,
      /* The base Top Stories list, not `displayStories`. The phone has its
         own For You lens and must not inherit which tab the desk is on. */
      stories,
      watchlistTickers: profile?.watchlist_tickers ?? [],
      profileSectors: profile?.sectors ?? [],
      yourRecord: mobileRecords.yourRecord,
      deskRecord: mobileRecords.deskRecord,
      gradedInLastDay: mobileRecords.gradedInLastDay,
    });
  }, [
    mobileReady,
    profile,
    storyCount,
    bullishCount,
    bearishCount,
    countsFailed,
    userMarketCards,
    marketCards,
    briefingHeadline,
    stories,
    mobileRecords,
  ]);

  /* A failed Top Stories read is the only page-level failure the phone can
     state as one. Everything else is absent rather than broken, and absence is
     drawn by leaving the section out. */
  const mobileStage: DashStage = storiesError ? "error" : "ready";

  return (
    <AppShell
      pageTitle="Dashboard"
      mood={mood}
      moodHeadline={moodHeadline}
      moodDetails={moodDetails}
      mobileFullBleed
    >
      {/* Today, below md. The mobile drawing of this route, composed beside
          the desktop layout rather than replacing it: every loader, widget and
          reveal gate below is untouched.

          Untouched is not unmounted, and the distinction is worth stating
          rather than glossing. `hidden md:block` is `display:none`, so on a
          phone the desk's four loaders still run, its market-indices fetch
          still goes out, and its widgets still render into a hidden subtree
          that nothing reads. That is the cost of composing instead of
          rewriting, and it is deliberate for this unit: unmounting the desk
          below md means branching a 942-line page on a breakpoint, which is
          the rewrite this was meant to avoid. Worth revisiting once the
          mobile screen has a loader of its own, which is now the case: the
          phone reads `mobileData` below, built from this page's own state.
          Unmounting the desk below md is the next step and it is not this
          unit's.

          Gating lives in a CLASS, never in an inline style. An inline display
          beats the class at every breakpoint, which is the defect that shipped
          the tab bar to desktop once already. */}
      <div className="md:hidden">
        <Suspense fallback={<DashboardScreen stage="loading" data={null} />}>
          <MobileDashboardRoute data={mobileData} stage={mobileStage} />
        </Suspense>
      </div>

      <div className="hidden md:block">
      <DashboardRevealGate>
      <div className="dash-contentwrap dash-dots max-w-[1440px] mx-auto px-6 md:px-12 py-6 md:py-8 pb-16">
        <CursorGlow />
        <TileSpotlight />
        <DashboardIntro storyCount={storyCount} />

        {/* Onboarding banner */}
        <OnboardingBanner />
        <PersonalizationBanner />

        {/* Greeting header — kicker/title/subtitle + date pill + arrange controls */}
        <div className="dash-rise flex items-start justify-between gap-4 flex-wrap mt-1">
          {/* No fallback sentence. `greetingSubtitle` is derived from the
              user's own watchlist, sectors and the latest briefing's tone;
              when none of those produce a line there is nothing true to say
              about the tape, so the greeting says nothing about it. The old
              default asserted a specific market condition nothing had
              measured. */}
          <Greeting storyCount={storyCount} context={greetingSubtitle} />
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
        <div className="dash-rise mt-2" style={{ animationDelay: "100ms" }}>
          <SystemIntelligenceWidget />
        </div>

        {/* AI signal bar */}
        <div className="dash-rise mt-3" style={{ animationDelay: "140ms" }} data-tour="ai-signal-bar">
          <AISignalBar
            text={briefingHeadline ?? "Loading intelligence briefing..."}
            boldParts={[]}
          />
        </div>

        {/* Top Stories — immersive rotating lead hero */}
        <div className="dash-rise mt-[18px]" style={{ animationDelay: "180ms" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-[18px] font-medium text-espresso inline-flex items-center gap-1.5">
                Top Stories
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
            // Hero-sized skeleton (dark ember silhouette + rundown strip line)
            // so the resolved hero causes no layout shift.
            <div>
              <Skeleton className="h-[380px] rounded-2xl bg-[#241a10]/20" />
              <Skeleton className="h-6 w-2/3 rounded-md mt-3" />
            </div>
          ) : storiesError ? (
            <EmptyState
              icon={<FileText size={32} />}
              title="Couldn't load top stories"
              description="The story query failed. It will retry on the next refresh."
            />
          ) : displayStories.length === 0 ? (
            <EmptyState
              icon={<FileText size={32} />}
              title="No stories yet"
              description="Stories will appear once articles are ingested by the pipeline."
            />
          ) : (
            /* Top stories live ONLY in the revolving hero (it cycles all ~4);
               the numbered list that duplicated them below was removed. */
            <div className="dash-fill-in">
              <RotatingLeadHero
                stories={displayStories.slice(0, 4)}
                isWatching={(s) =>
                  storyTab === "for-you" && (s.tags ?? []).some((t) => isOnWatchlist(t, profile))
                }
              />
            </div>
          )}
        </div>

        {/* Radar row — The Watch newsroom (lead deck + wire + fresh radar) and
            Your calls. Fresh-on-radar lives inside the newsroom tile per the
            mockup; it renders nothing when no not-tracked ticker surfaces.

            items-start, NOT items-stretch. Stretch equalises the two column
            heights, so whichever column is shorter is padded out with dead
            space rather than ending where its content ends. Measured on the
            live page: both columns 853px, the left column's content ending
            550px in, leaving 303px of empty tile below a single Fresh-on-radar
            card. The stretch predates #542; that PR split the right column into
            two tiles (Your calls + Signalera's record, the second flex-1),
            which made it tall enough for the gap to become obvious.

            A ragged bottom edge is the correct trade: there is genuinely
            nothing to put in the space when Fresh-on-radar surfaces one card,
            and no height is hardcoded either way. */}
        <div className="mt-[18px] grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-[18px] items-start">
          <WatchlistFeed
            riseDelay={220}
            fresh={<FreshRadar stories={stories} watchlistTickers={watchlistTickers} embedded />}
          />
          {/* Your calls = the user's OWN claims (/api/radar/claims), and
              nothing else. Signalera's graded brief-call record is a separate
              tile below, under its own heading. Two records, two objects: the
              desk's numbers are never rendered under a "Your" heading, and an
              empty personal record says so rather than borrowing them. */}
          {/* No h-full: the column is as tall as its two tiles, not as tall as
              the grid row. */}
          <div className="flex flex-col gap-[18px]">
            <DashTile title="Your calls" subtitle="your tracked views" riseDelay={300}>
              <YourCallsWidget />
            </DashTile>
            {/* No flex-1: it would expand to fill whatever height the column
                has, which is what made this column the taller of the two. */}
            <DashTile
              title="Signalera&rsquo;s record"
              subtitle="the desk&rsquo;s graded calls"
              riseDelay={320}
            >
              <DeskRecordSummary />
            </DashTile>
          </div>
        </div>

        {/* Follow row — Watchlist + Following. Same shape as the Radar row and
            the same latent bug: items-stretch + h-full padded the shorter tile
            out to match the taller one. It did not reproduce on the day the
            Radar row did only because these two happened to be similar heights.
            Fixed here too rather than left to surface later. */}
        <div className="mt-[18px] grid grid-cols-1 lg:grid-cols-[1fr_1.9fr] gap-[18px] items-start">
          <DashTile title="Watchlist" riseDelay={340}>
            <WatchlistWidget />
          </DashTile>
          {/* Following = the user's real Radar follows, each with its latest
              matching headline, from /api/radar/following-feed. Replaces the
              competitor/community fallback that stood in before Radar's
              follow storage existed on this branch. */}
          <DashTile title="Following" subtitle="desks & sectors you track" riseDelay={380}>
            <FollowingWidget />
          </DashTile>
        </div>

        {/* Daily briefs */}
        <div className="mt-[18px]">
          <DashTile title="Daily Briefs" subtitle="morning & evening" riseDelay={420}>
            <DailyBriefsWidget />
          </DashTile>
        </div>

      </div>
      </DashboardRevealGate>
      </div>
    </AppShell>
  );
}
