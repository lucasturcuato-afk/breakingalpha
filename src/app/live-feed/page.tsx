"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef, useDeferredValue } from "react";
import { AppShell } from "@/components/shell";
import { FilterBar, FeedRow } from "@/components/feed";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AlignLeft, Bookmark, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@supabase/ssr";
import { getCompleteness, getAdjustedScore } from "@/lib/article-signal";
import type { StoryData } from "@/components/dashboard";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { useLiveMood } from "@/hooks/useLiveMood";

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

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

interface DuplicateArticleSummary {
  id: string;
  title: string;
  source: string;
  url?: string;
  publishedAt?: string;
}

interface DedupedStory extends LiveStory {
  duplicateArticles: DuplicateArticleSummary[];
}

function dedupeStories(stories: LiveStory[]): DedupedStory[] {
  const groups = new Map<string, LiveStory[]>();
  for (const s of stories) {
    const key = normalizeTitle(s.title);
    if (!key) {
      groups.set(`__standalone__${s.id}`, [s]);
      continue;
    }
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  const result: DedupedStory[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => {
      const aTime = new Date(a._publishedAt || 0).getTime();
      const bTime = new Date(b._publishedAt || 0).getTime();
      if (bTime !== aTime) return bTime - aTime;
      return (a.source || "").localeCompare(b.source || "");
    });
    const primary = arr[0];
    const others = arr.slice(1);
    result.push({
      ...primary,
      duplicateArticles: others.map((o) => ({
        id: o.id,
        title: o.title,
        source: o.source,
        url: o.url,
        publishedAt: o._publishedAt,
      })),
    });
  }

  return result;
}

export default function LiveFeedPage() {
  const { mood, moodHeadline, moodDetails } = useLiveMood();
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
  const [user, setUser] = useState<{ id: string } | null | undefined>(undefined);
  const [showSignIn, setShowSignIn] = useState(false);

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
      // Published-date floor so stale items (date-less or weeks old) never
      // surface on the live feed. NULL published_at is excluded by gte.
      const publishedFloor7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await getSupabase()
        .from("articles")
        .select("id, title, source, sector, industry_verticals, activity_types, sentiment, summary, content, published_at, ingested_at, url, companies, relevance_score")
        .gte("published_at", publishedFloor7d)
        .order("ingested_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      if (!data) return;

      // Batch fetch source credibility
      const uniqueSources = [...new Set(data.map(a => a.source).filter(Boolean) as string[])];
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

      const stories: LiveStory[] = data.map((a) => {
        const completeness = getCompleteness(a.content, a.summary);
        const companies = (() => {
          let cos = a.companies;
          if (typeof cos === "string") {
            try { cos = JSON.parse(cos); } catch { cos = []; }
          }
          return Array.isArray(cos) ? cos : [];
        })();
        return {
          id: a.id,
          title: a.title || "Untitled",
          source: a.source || "Unknown",
          timestamp: timeAgo(a.published_at || a.ingested_at),
          sentiment: sentimentFromDb(a.sentiment),
          sector: a.sector || undefined,
          industry_verticals: a.industry_verticals ?? [],
          activity_types: a.activity_types ?? [],
          summary: a.summary || undefined,
          tags: companies.slice(0, 3),
          companies,
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
          completeness,
          adjustedScore: getAdjustedScore(a.relevance_score ?? null, completeness),
          sourceWinRate: credMap.get(a.source) ?? null,
        };
      });

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

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id } : null);
    }).catch(() => setUser(null));
  }, []);

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

  const handleAlertsToggle = useCallback(() => setShowAlertsOnly((prev) => !prev), []);
  const handleSavedToggle = useCallback(() => setShowSavedOnly((prev) => !prev), []);

  // Defer the filter-state that drives the expensive list recomputation. The
  // chips themselves keep reading `selectedVerticals`/`selectedActivityTypes`
  // so their active color flips instantly on click. The ~100-row feed
  // re-reconciliation runs as a concurrent transition and can be interrupted
  // if the user clicks another chip before it finishes.
  const deferredVerticals = useDeferredValue(selectedVerticals);
  const deferredActivityTypes = useDeferredValue(selectedActivityTypes);
  const deferredShowAlerts = useDeferredValue(showAlertsOnly);
  const deferredShowSaved = useDeferredValue(showSavedOnly);
  const isFilterPending =
    deferredVerticals !== selectedVerticals ||
    deferredActivityTypes !== selectedActivityTypes ||
    deferredShowAlerts !== showAlertsOnly ||
    deferredShowSaved !== showSavedOnly;

  const [expandedDuplicates, setExpandedDuplicates] = useState<Set<string>>(new Set());

  function toggleDuplicates(id: string) {
    setExpandedDuplicates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Filter
  const filtered: DedupedStory[] = useMemo(() => {
    const matched = sortedArticles.filter((story) => {
      if (deferredShowSaved && !savedIds.has(story.id)) return false;
      if (deferredShowAlerts && !story.isAlert) return false;

      const verticalMatch = deferredVerticals.length === 0 ||
        (story.industry_verticals ?? []).some((v) => deferredVerticals.includes(v));

      const activityMatch = deferredActivityTypes.length === 0 ||
        (story.activity_types ?? []).some((a) => deferredActivityTypes.includes(a));

      return verticalMatch && activityMatch;
    });
    return dedupeStories(matched);
  }, [sortedArticles, savedIds, deferredShowSaved, deferredShowAlerts, deferredVerticals, deferredActivityTypes]);

  // Alert count used to be computed inline as `articles.filter(...).length` on
  // every render. Pull it out so chip clicks don't re-scan 100 articles to
  // compute a number that only changes when `articles` changes.
  const alertCount = useMemo(
    () => articles.reduce((n, s) => n + (s.isAlert ? 1 : 0), 0),
    [articles],
  );

  // Per-pill counts (articles matching each sector / activity) — derived from
  // `articles` only, not from filter state, so they update on 60s poll but
  // stay stable across filter-chip clicks. Used by FilterPill to render
  // "Technology 12", "Healthcare 8", etc.
  const verticalCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) {
      for (const v of a.industry_verticals ?? []) {
        m.set(v, (m.get(v) ?? 0) + 1);
      }
    }
    return m;
  }, [articles]);

  const activityCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) {
      for (const t of a.activity_types ?? []) {
        m.set(t, (m.get(t) ?? 0) + 1);
      }
    }
    return m;
  }, [articles]);

  // Group by time bucket
  const grouped = useMemo(() => {
    const buckets: Record<string, DedupedStory[]> = {};
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
    <AppShell pageTitle="Live Feed" mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-parchment border-b border-border-base">
        <FilterBar
          selectedVerticals={selectedVerticals}
          selectedActivityTypes={selectedActivityTypes}
          onVerticalToggle={handleVerticalToggle}
          onActivityTypeToggle={handleActivityTypeToggle}
          showAlertsOnly={showAlertsOnly}
          onAlertsToggle={handleAlertsToggle}
          showSavedOnly={showSavedOnly}
          onSavedToggle={handleSavedToggle}
          alertCount={alertCount}
          verticalCounts={verticalCounts}
          activityCounts={activityCounts}
        />
        {/* Sort + refresh row */}
        <div className="flex items-center justify-end gap-3 px-6 py-1.5 border-t border-border-subtle">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="font-sans text-[10px] bg-parchment-mid border border-border-base rounded-lg px-2.5 py-1.5 text-text-secondary cursor-pointer"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="relevance">By relevance</option>
            <option value="sentiment">By sentiment</option>
          </select>
          {lastRefresh && (
            <span className="font-sans text-[9px] text-text-faint whitespace-nowrap">
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

      {/* Preview banner for signed-out users */}
      {user === null && (
        <div className="flex items-center justify-between mb-4 px-4 py-2.5 rounded-xl border mx-6 mt-4" style={{ background: 'rgba(245, 166, 35, 0.08)', borderColor: 'var(--gold-border)' }}>
          <span className="font-sans text-[12px]" style={{ color: 'var(--gold)' }}>
            You&apos;re viewing a preview. Sign in to personalize your feed.
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

      {/* Feed */}
      <div
        style={{
          opacity: isFilterPending ? 0.6 : 1,
          transition: "opacity 120ms ease-out",
        }}
      >
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
          (() => {
            const GATE_LIMIT = user === null ? 5 : filtered.length;
            let shownCount = 0;
            const gatedGroups: React.ReactElement[] = [];
            let gateHit = false;

            for (const group of grouped) {
              if (gateHit) break;
              const remaining = GATE_LIMIT - shownCount;
              const visibleStories = group.stories.slice(0, remaining);
              shownCount += visibleStories.length;
              if (shownCount >= GATE_LIMIT && user === null && filtered.length > GATE_LIMIT) {
                gateHit = true;
              }

              gatedGroups.push(
                <div key={group.label}>
                  {/* Time bucket header */}
                  <div className="sticky top-[108px] z-[5] bg-parchment/95 backdrop-blur-sm px-6 py-1.5 border-b border-border-subtle">
                    <div className="flex items-center gap-2">
                      <span className="font-sans text-[10px] font-semibold text-text-muted">
                        {group.label.charAt(0) + group.label.slice(1).toLowerCase()}
                      </span>
                      <span className="font-sans text-[9px] text-text-faint">
                        {group.stories.length} {group.stories.length === 1 ? "article" : "articles"}
                      </span>
                      {group.label === "LAST HOUR" && newArticleIds.size > 0 && (
                        <span className="inline-flex items-center gap-1 ml-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-signal-up animate-pulse" />
                          <span className="font-sans text-[9px] text-signal-up font-semibold">
                            {newArticleIds.size} new
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Articles in bucket */}
                  {visibleStories.map((story) => {
                    const isExpanded = expandedDuplicates.has(story.id);
                    return (
                      <div key={story.id} className="relative">
                        {newArticleIds.has(story.id) && (
                          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-signal-up" />
                        )}
                        <FeedRow
                          story={story}
                          saved={savedIds.has(story.id)}
                          onBookmark={handleBookmark}
                        />
                        {story.duplicateArticles.length > 0 && (
                          <div className="px-6 -mt-1 pb-2">
                            <button
                              type="button"
                              onClick={() => toggleDuplicates(story.id)}
                              className="font-sans text-[9px] font-semibold text-text-muted bg-parchment-mid border border-border-base rounded px-1.5 py-0.5 cursor-pointer hover:text-text-primary hover:border-border-hover transition-colors"
                            >
                              {isExpanded ? "▴" : "▾"} +{story.duplicateArticles.length} {story.duplicateArticles.length === 1 ? "source" : "sources"}
                              {!isExpanded && story.duplicateArticles.length > 0 && `: ${story.duplicateArticles.slice(0, 3).map((d) => d.source).join(", ")}`}
                            </button>
                            {isExpanded && (
                              <div className="mt-2 ml-2 pl-3 border-l-2 border-border-base space-y-1.5">
                                {story.duplicateArticles.map((dup) => (
                                  <div key={dup.id} className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-sans text-[12px] text-text-primary leading-snug truncate">
                                        {dup.title}
                                      </p>
                                      <p className="font-sans text-[9px] text-text-muted mt-0.5">
                                        {dup.source}
                                        {dup.publishedAt && ` · ${timeAgo(dup.publishedAt)}`}
                                      </p>
                                    </div>
                                    {dup.url ? (
                                      <a
                                        href={dup.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-shrink-0 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
                                      >
                                        Read source →
                                      </a>
                                    ) : (
                                      <span className="flex-shrink-0 font-sans text-[10px] text-text-faint">No link</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            }

            return (
              <>
                {gatedGroups}
                {gateHit && (
                  <>
                    <div className="relative mt-2 mx-6">
                      <div style={{ maxHeight: '48px', overflow: 'hidden', pointerEvents: 'none', userSelect: 'none', opacity: 0.7 }}>
                        {filtered[GATE_LIMIT] && (
                          <div className="bg-white border border-border-base rounded-xl p-3">
                            <p className="font-sans text-[9px] text-text-muted">{filtered[GATE_LIMIT].source}</p>
                            <p className="font-display text-[13px] font-bold text-espresso leading-snug mt-1 line-clamp-1">{filtered[GATE_LIMIT].title}</p>
                          </div>
                        )}
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px', background: 'linear-gradient(to bottom, transparent, var(--cream))' }} />
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5 mt-1 mx-6 rounded-xl border" style={{ background: 'rgba(245, 166, 35, 0.08)', borderColor: 'var(--gold-border)' }}>
                      <span className="font-sans text-[12px]" style={{ color: 'var(--gold)' }}>
                        Sign in to see the full live feed
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
                  </>
                )}
              </>
            );
          })()
        )}
      </div>

      <SignInModal
        isOpen={showSignIn}
        onClose={() => setShowSignIn(false)}
        headline="Sign in to access the live feed"
        message="Get real-time deal flow, M&A signals, and market coverage with a free account."
      />
    </AppShell>
  );
}
