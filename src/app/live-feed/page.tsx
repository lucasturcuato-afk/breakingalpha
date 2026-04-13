"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { AppShell } from "@/components/shell";
import { FilterBar, FeedRow } from "@/components/feed";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AlignLeft, Bookmark, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@supabase/ssr";
import type { StoryData } from "@/components/dashboard";

interface LiveStory extends StoryData {
  _publishedAt?: string;
  _relevanceScore?: number;
  _sentimentRaw?: string | null;
  isAlert?: boolean;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

type SortOption = "newest" | "oldest" | "relevance" | "sentiment";

function sentimentFromDb(s: string | null): string {
  if (!s) return "neutral";
  const l = s.toLowerCase();
  if (l === "positive" || l === "bullish") return "bullish";
  if (l === "negative" || l === "bearish") return "bearish";
  return "neutral";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getTimeBucket(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffHrs = diffMs / (1000 * 60 * 60);

  if (diffHrs < 1) return "LAST HOUR";
  if (date.toDateString() === now.toDateString()) return "TODAY";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "YESTERDAY";

  return "EARLIER";
}

export default function LiveFeedPage() {
  const [selectedVerticals, setSelectedVerticals] = useState<string[]>([]);
  const [selectedActivityTypes, setSelectedActivityTypes] = useState<string[]>([]);
  const [showAlertsOnly, setShowAlertsOnly] = useState(false);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>("newest");
  const [articles, setArticles] = useState<LiveStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [newArticleIds, setNewArticleIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("signalera_saved_articles");
      if (stored) return new Set(JSON.parse(stored));
    } catch { /* ignore parse errors */ }
    return new Set();
  });
  const prevIdsRef = useRef<Set<string>>(new Set());

  const handleBookmark = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("signalera_saved_articles", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const fetchArticles = useCallback(async () => {
    try {
      const { data, error } = await getSupabase()
        .from("articles")
        .select("id, title, source, sector, industry_verticals, activity_types, sentiment, summary, published_at, ingested_at, url, companies, relevance_score")
        .order("ingested_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      if (!data) return;

      const stories: LiveStory[] = data.map((a) => ({
        id: a.id,
        title: a.title || "Untitled",
        source: a.source || "Unknown",
        timestamp: timeAgo(a.published_at || a.ingested_at),
        sentiment: sentimentFromDb(a.sentiment),
        sector: a.sector || undefined,
        industry_verticals: a.industry_verticals ?? [],
        activity_types: a.activity_types ?? [],
        summary: a.summary || undefined,
        tags: (() => {
          let cos = a.companies;
          if (typeof cos === "string") {
            try { cos = JSON.parse(cos); } catch { cos = []; }
          }
          return Array.isArray(cos) ? cos.slice(0, 3) : [];
        })(),
        url: a.url || undefined,
        read: false,
        saved: false,
        _publishedAt: a.published_at || a.ingested_at,
        _relevanceScore: a.relevance_score || 0,
        _sentimentRaw: a.sentiment,
        isAlert: (
          (a.sentiment?.toLowerCase() === "bearish" || a.sentiment?.toLowerCase() === "negative") &&
          Date.now() - new Date(a.published_at || a.ingested_at).getTime() < 48 * 3600 * 1000
        ),
      }));

      // Detect new articles since last refresh
      const currentIds = new Set(stories.map((s) => s.id));
      if (prevIdsRef.current.size > 0) {
        const newIds = new Set<string>();
        currentIds.forEach((id) => {
          if (!prevIdsRef.current.has(id)) newIds.add(id);
        });
        if (newIds.size > 0) setNewArticleIds(newIds);
      }
      prevIdsRef.current = currentIds;

      setArticles(stories);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Failed to fetch articles:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + 60s polling
  useEffect(() => {
    fetchArticles();
    const interval = setInterval(fetchArticles, 60000);
    return () => clearInterval(interval);
  }, [fetchArticles]);

  // Clear new indicators after 30 seconds
  useEffect(() => {
    if (newArticleIds.size === 0) return;
    const timer = setTimeout(() => setNewArticleIds(new Set()), 30000);
    return () => clearTimeout(timer);
  }, [newArticleIds]);

  // Sort articles
  const sortedArticles = useMemo(() => {
    const copy = [...articles];
    switch (sort) {
      case "newest":
        return copy; // already sorted by ingested_at desc
      case "oldest":
        return copy.reverse();
      case "relevance":
        return copy.sort((a, b) => (b._relevanceScore || 0) - (a._relevanceScore || 0));
      case "sentiment": {
        const sentOrder: Record<string, number> = { bullish: 0, neutral: 1, bearish: 2, "risk-off": 3 };
        return copy.sort((a, b) => (sentOrder[a.sentiment] ?? 1) - (sentOrder[b.sentiment] ?? 1));
      }
      default:
        return copy;
    }
  }, [articles, sort]);

  const handleVerticalToggle = useCallback((v: string) => {
    setSelectedVerticals((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  }, []);

  const handleActivityTypeToggle = useCallback((a: string) => {
    setSelectedActivityTypes((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  }, []);

  // Filter
  const filtered: LiveStory[] = useMemo(() => {
    return sortedArticles.filter((story) => {
      if (showSavedOnly && !savedIds.has(story.id)) return false;
      if (showAlertsOnly && !story.isAlert) return false;

      const verticalMatch = selectedVerticals.length === 0 ||
        (story.industry_verticals ?? []).some((v) => selectedVerticals.includes(v));

      const activityMatch = selectedActivityTypes.length === 0 ||
        (story.activity_types ?? []).some((a) => selectedActivityTypes.includes(a));

      return verticalMatch && activityMatch;
    });
  }, [sortedArticles, savedIds, showSavedOnly, showAlertsOnly, selectedVerticals, selectedActivityTypes]);

  // Group by time bucket
  const grouped = useMemo(() => {
    const buckets: Record<string, LiveStory[]> = {};
    const bucketOrder = ["LAST HOUR", "TODAY", "YESTERDAY", "EARLIER"];
    filtered.forEach((story) => {
      const bucket = getTimeBucket(story._publishedAt || "");
      if (!buckets[bucket]) buckets[bucket] = [];
      buckets[bucket].push(story);
    });
    return bucketOrder
      .filter((b) => buckets[b]?.length)
      .map((b) => ({ label: b, stories: buckets[b] }));
  }, [filtered]);

  return (
    <AppShell pageTitle="Live Feed" mood="risk-off" moodHeadline="Risk-Off regime" moodDetails={["VIX 18.5", "10Y 4.52%"]}>
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-parchment border-b border-border-base">
        <FilterBar
          selectedVerticals={selectedVerticals}
          selectedActivityTypes={selectedActivityTypes}
          onVerticalToggle={handleVerticalToggle}
          onActivityTypeToggle={handleActivityTypeToggle}
          showAlertsOnly={showAlertsOnly}
          onAlertsToggle={() => setShowAlertsOnly((prev) => !prev)}
          showSavedOnly={showSavedOnly}
          onSavedToggle={() => setShowSavedOnly((prev) => !prev)}
          alertCount={articles.filter((s) => s.isAlert).length}
        />
        {/* Sort + refresh row */}
        <div className="flex items-center justify-end gap-3 px-6 py-1.5 border-t border-border-subtle">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="font-data text-[10px] bg-parchment-mid border border-border-base rounded-lg px-2.5 py-1.5 text-text-secondary cursor-pointer"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="relevance">By relevance</option>
            <option value="sentiment">By sentiment</option>
          </select>
          {lastRefresh && (
            <span className="font-data text-[9px] text-text-faint whitespace-nowrap">
              Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchArticles();
            }}
            className="p-1.5 rounded-lg hover:bg-parchment-mid transition-colors cursor-pointer"
            aria-label="Refresh"
          >
            <RefreshCw size={12} className={cn("text-text-muted", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Feed */}
      <div>
        {loading && articles.length === 0 ? (
          <div className="space-y-0">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="border-b border-border-subtle px-6 py-4 space-y-2">
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-24" />
                </div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          showSavedOnly ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-full bg-parchment-mid flex items-center justify-center">
                <Bookmark size={20} className="text-text-muted" />
              </div>
              <div className="font-sans font-semibold text-text-primary text-sm">No saved articles yet</div>
              <div className="font-sans text-text-muted text-xs text-center max-w-[220px]">
                Click the bookmark icon on any article to save it to your reading list
              </div>
            </div>
          ) : showAlertsOnly ? (
            <EmptyState
              icon={<AlignLeft size={32} />}
              title="No bearish signals in the last 48 hours"
              description="Markets are calm. Check back later for new alerts."
            />
          ) : (
            <EmptyState
              icon={<AlignLeft size={32} />}
              title="No stories match this filter"
              description="Try selecting a different filter or check back later."
            />
          )
        ) : (
          grouped.map((group) => (
            <div key={group.label}>
              {/* Time bucket header */}
              <div className="sticky top-[108px] z-[5] bg-parchment/95 backdrop-blur-sm px-6 py-1.5 border-b border-border-subtle">
                <div className="flex items-center gap-2">
                  <span className="font-data text-[9px] font-bold uppercase tracking-widest text-text-muted">
                    {group.label}
                  </span>
                  <span className="font-data text-[9px] text-text-faint">
                    {group.stories.length} {group.stories.length === 1 ? "article" : "articles"}
                  </span>
                  {group.label === "LAST HOUR" && newArticleIds.size > 0 && (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-signal-up animate-pulse" />
                      <span className="font-data text-[9px] text-signal-up font-semibold">
                        {newArticleIds.size} new
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {/* Articles in bucket */}
              {group.stories.map((story) => (
                <div key={story.id} className="relative">
                  {newArticleIds.has(story.id) && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-signal-up" />
                  )}
                  <FeedRow
                    story={{ ...story, saved: savedIds.has(story.id) }}
                    onBookmark={handleBookmark}
                  />
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
