"use client";

import { useState, useCallback, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell";
import { useUserProfile } from "@/hooks/useUserProfile";
import { ThesisList } from "@/components/thesis/ThesisList";
import { ThesisDetailPanel } from "@/components/thesis/thesis-detail-panel";
import { KanbanBoard } from "@/components/thesis/kanban-board";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText, Archive, RefreshCw, ChevronDown, ChevronUp, LayoutList, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThesisItem, ThesisStatus, WeeklyDigest, PatternRow, SourceCredibilityRow } from "@/components/thesis";
import { mapThesisRow } from "@/lib/thesis-mapper";

interface RelatedArticle {
  id: string;
  title: string;
  source?: string;
  ingested_at?: string;
  published_at?: string;
  summary?: string;
  sentiment?: string;
  sector?: string;
}

type ConvictionFilter = "HIGH" | "MEDIUM" | "WATCH" | "all" | "archived" | "pending_review" | "recommended";

interface UserThesisState {
  id: string;
  thesis_id: string;
  status: "active" | "archived" | "watching";
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

function sectorMatchesProfile(thesisSector: string, profileSectors: string[]): boolean {
  const lower = thesisSector.toLowerCase();
  return profileSectors.some((ps) => {
    const pl = ps.toLowerCase();
    return lower.includes(pl) || pl.includes(lower);
  });
}

// Note: the single source of truth `mapThesisRow` lives in `@/lib/thesis-mapper`.
// The API already returns canonical shape, but re-mapping here keeps the
// component resilient if the API ever returns a raw row (e.g. older build).
//
// The thesis-mapper also exposes `thesisDedupKey` and `dedupByTitleSector` for
// any consumer that needs them.

// ── System Intelligence Panel ──

function SystemIntelligencePanel({
  digest,
  patterns,
  sources,
  patternsLoading,
  sourcesLoading,
}: {
  digest: WeeklyDigest | null;
  patterns: PatternRow[];
  sources: SourceCredibilityRow[];
  patternsLoading: boolean;
  sourcesLoading: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 font-sans text-[11px] font-semibold text-gold-dark hover:text-gold transition-colors cursor-pointer mb-2"
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        System Intelligence
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 animate-in fade-in-0 slide-in-from-top-2 border-t-2 border-gold pt-3">
          {/* This Week's Learning */}
          <div className="bg-cream border border-gold-border rounded-xl p-3">
            <h4 className="font-sans text-[10px] font-semibold text-gold-dark uppercase tracking-wider mb-2">
              This Week&apos;s Learning
            </h4>
            {digest?.thesis_prompt_addendum ? (
              <p className="font-sans text-[11px] text-text-secondary leading-relaxed">
                {digest.thesis_prompt_addendum}
              </p>
            ) : (
              <p className="font-sans text-[11px] text-text-muted italic">
                Building this week&apos;s learning — first digest publishes after the next pipeline cycle.
              </p>
            )}
          </div>

          {/* Pattern Library */}
          <div className="bg-cream border border-gold-border rounded-xl p-3">
            <h4 className="font-sans text-[10px] font-semibold text-gold-dark uppercase tracking-wider mb-2">
              Pattern Library
            </h4>
            {patternsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-3 w-full" />)}
              </div>
            ) : patterns.length > 0 ? (
              <div className="space-y-1.5">
                {patterns.map((p) => (
                  <div key={p.id} className="flex items-center justify-between">
                    <span className="font-sans text-[10px] text-text-secondary truncate mr-2">
                      {p.sector || "—"} · {p.horizon || "30d"} · {p.dominant_signal || "mixed"}
                    </span>
                    <span className="font-data text-[10px] text-gold-dark flex-shrink-0">
                      {typeof p.win_rate === "number" ? `${(p.win_rate * 100).toFixed(0)}%` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-sans text-[11px] text-text-muted italic">
                Pattern library building — confirmed outcomes will populate this view.
              </p>
            )}
          </div>

          {/* Source Credibility */}
          <div className="bg-cream border border-gold-border rounded-xl p-3">
            <h4 className="font-sans text-[10px] font-semibold text-gold-dark uppercase tracking-wider mb-2">
              Source Credibility
            </h4>
            {sourcesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-3 w-full" />)}
              </div>
            ) : sources.length > 0 ? (
              <div className="space-y-1.5">
                {sources.map((s, i) => (
                  <div key={s.id ?? `src-${i}`} className="flex items-center justify-between">
                    <span className="font-sans text-[10px] text-text-secondary truncate mr-2">
                      {s.source || "Unknown"}
                    </span>
                    <span className="font-data text-[10px] text-gold-dark flex-shrink-0">
                      {typeof s.win_rate === "number" ? `${(s.win_rate * 100).toFixed(0)}%` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-sans text-[11px] text-text-muted italic">
                Source credibility building — outcomes are being attributed to source articles.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Content ──

function ThesisBoardContent() {
  const searchParams = useSearchParams();
  const [theses, setTheses] = useState<ThesisItem[]>([]);
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [sources, setSources] = useState<SourceCredibilityRow[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(true);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [convictionFilter, setConvictionFilter] = useState<ConvictionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [relatedArticles, setRelatedArticles] = useState<Record<string, RelatedArticle[]>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [archivedTheses, setArchivedTheses] = useState<ThesisItem[]>([]);
  const [archivedRefreshKey, setArchivedRefreshKey] = useState(0);
  const [userThesisStates, setUserThesisStates] = useState<UserThesisState[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const { profile } = useUserProfile();

  // Switch to recommended filter when profile is loaded and onboarded
  useEffect(() => {
    if (profile?.onboarding_completed) {
      setConvictionFilter("recommended");
    }
  }, [profile]);

  // Auto-select thesis from query param
  useEffect(() => {
    const thesisId = searchParams.get("thesis");
    if (thesisId) setSelectedId(thesisId);
  }, [searchParams]);

  // Fetch per-user thesis states
  const fetchUserThesisStates = useCallback(async () => {
    try {
      const res = await fetch("/api/user-thesis-states");
      const data = await res.json();
      if (data.states && Array.isArray(data.states)) {
        setUserThesisStates(data.states as UserThesisState[]);
      }
    } catch {
      // Soft-fail: no user states means nothing is archived for this user
      setUserThesisStates([]);
    }
  }, []);

  // Fetch theses from new GET endpoint
  const fetchTheses = useCallback(async () => {
    try {
      const res = await fetch("/api/theses");
      const data = await res.json();
      if (data.theses && Array.isArray(data.theses)) {
        const mapped: ThesisItem[] = data.theses.map(mapThesisRow);
        setTheses(mapped);
      }
      if (data.digest) {
        setDigest(data.digest as WeeklyDigest);
      }
    } catch (e) {
      console.error("Failed to fetch theses:", e);
      setError("Failed to load theses");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch patterns + sources
  const fetchIntelligence = useCallback(async () => {
    // Patterns
    try {
      const res = await fetch("/api/theses/patterns");
      const data = await res.json();
      setPatterns((data.patterns || []) as PatternRow[]);
    } catch {
      setPatterns([]);
    } finally {
      setPatternsLoading(false);
    }
    // Sources
    try {
      const res = await fetch("/api/theses/sources");
      const data = await res.json();
      setSources((data.sources || []) as SourceCredibilityRow[]);
    } catch {
      setSources([]);
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTheses();
    fetchUserThesisStates();
    fetchIntelligence();
  }, [fetchTheses, fetchUserThesisStates, fetchIntelligence]);

  const fetchArticlesForThesis = useCallback(async (thesis: ThesisItem) => {
    if (relatedArticles[thesis.id]) return;
    try {
      const ids = thesis.supporting_article_ids;
      if (ids && ids.length > 0) {
        const res = await fetch("/api/theses");
        // Use a direct Supabase fetch via the browser client
        const { createBrowserClient } = await import("@supabase/ssr");
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const { data } = await supabase
          .from("articles")
          .select("id, title, source, ingested_at, published_at, summary, sentiment, sector")
          .in("id", ids);
        void res; // consumed above but we only need supabase data
        if (data && data.length > 0) {
          setRelatedArticles((prev) => ({ ...prev, [thesis.id]: data }));
          return;
        }
      }
      // Fallback: sector-matched
      const { createBrowserClient } = await import("@supabase/ssr");
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data } = await supabase
        .from("articles")
        .select("id, title, source, ingested_at, published_at, summary, sentiment, sector")
        .eq("sector", thesis.sector)
        .order("ingested_at", { ascending: false })
        .limit(8);
      setRelatedArticles((prev) => ({ ...prev, [thesis.id]: data || [] }));
    } catch (e) {
      console.error("Failed to fetch articles for thesis:", e);
    }
  }, [relatedArticles]);

  // Auto-select first thesis after load
  useEffect(() => {
    if (theses.length > 0 && !selectedId) {
      setSelectedId(theses[0].id);
      fetchArticlesForThesis(theses[0]);
    }
  }, [theses]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const thesis = theses.find((t) => t.id === id) || archivedTheses.find((t) => t.id === id);
    if (thesis) fetchArticlesForThesis(thesis);
  };

  const handleRefresh = () => {
    setLoading(true);
    fetchTheses();
    fetchUserThesisStates();
    fetchIntelligence();
  };

  // Quick actions for pending review
  const handleQuickAction = async (id: string, newStatus: string) => {
    // Optimistic update
    setTheses((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: newStatus as ThesisStatus } : t))
    );
    try {
      const res = await fetch(`/api/theses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      // Rollback
      fetchTheses();
    }
  };

  // Derive user-archived thesis IDs from per-user states
  const userArchivedIds = useMemo(() => {
    const ids = new Set<string>();
    userThesisStates.forEach((s) => {
      if (s.status === "archived") ids.add(s.thesis_id);
    });
    return ids;
  }, [userThesisStates]);

  // Derive archived theses from the full theses list + user states
  useEffect(() => {
    if (!showArchived) return;
    setArchivedTheses(theses.filter((t) => userArchivedIds.has(t.id)));
  }, [showArchived, archivedRefreshKey, theses, userArchivedIds]);

  const handleRestore = async (id: string) => {
    try {
      const res = await fetch("/api/user-thesis-states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesis_id: id, status: "active" }),
      });
      if (!res.ok) throw new Error("Failed to restore");
      // Optimistic: remove from user states
      setUserThesisStates((prev) =>
        prev.map((s) => (s.thesis_id === id ? { ...s, status: "active" as const } : s))
      );
      setArchivedTheses((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      console.error("Failed to restore thesis:", e);
    }
  };

  const convictionCounts = useMemo(() => {
    const counts = { HIGH: 0, MEDIUM: 0, WATCH: 0, pending_review: 0, archived: 0 };
    counts.archived = userArchivedIds.size;
    theses.forEach((t) => {
      // Skip theses the user has archived
      if (userArchivedIds.has(t.id)) return;
      if (t.status === "pending_review") counts.pending_review++;
      const conv = t.conviction;
      if (conv === "HIGH" || conv === "BULLISH") counts.HIGH++;
      else if (conv === "MEDIUM") counts.MEDIUM++;
      else if (conv === "WATCH") counts.WATCH++;
    });
    return counts;
  }, [theses, userArchivedIds]);


  // Filter theses for display — uses per-user archived state
  const displayTheses = useMemo(() => {
    const isNotUserArchived = (t: ThesisItem) => !userArchivedIds.has(t.id);

    if (convictionFilter === "recommended") {
      const sectors = profile?.sectors ?? [];
      if (sectors.length === 0) {
        return theses.filter(isNotUserArchived);
      }
      return theses
        .filter((t) => isNotUserArchived(t) && sectorMatchesProfile(t.sector, sectors))
        .sort((a, b) => ((b.adversarial_score ?? -1) - (a.adversarial_score ?? -1)));
    }
    if (convictionFilter === "archived") return archivedTheses;
    if (convictionFilter === "pending_review") {
      return theses.filter((t) => isNotUserArchived(t) && t.status === "pending_review");
    }
    if (convictionFilter === "HIGH") {
      return theses.filter(
        (t) =>
          (t.conviction === "HIGH" || t.conviction === "BULLISH") &&
          isNotUserArchived(t)
      );
    }
    if (convictionFilter === "MEDIUM") {
      return theses.filter(
        (t) => t.conviction === "MEDIUM" && isNotUserArchived(t)
      );
    }
    if (convictionFilter === "WATCH") {
      return theses.filter(
        (t) => t.conviction === "WATCH" && isNotUserArchived(t)
      );
    }
    // "all" — everything except user-archived
    return theses.filter(isNotUserArchived);
  }, [theses, archivedTheses, convictionFilter, profile, userArchivedIds]);

  return (
    <AppShell pageTitle="Thesis Board" mood="neutral" moodHeadline="Markets steady" moodDetails={["VIX 14.2", "S&P +0.38%"]}>
      <div className="p-6">
        {loading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
            <Skeleton className="h-10 w-full rounded-xl" />
            <div className="grid grid-cols-[1fr_1.6fr] gap-3">
              <Skeleton className="h-96 rounded-xl" />
              <Skeleton className="h-96 rounded-xl" />
            </div>
          </div>
        ) : theses.length === 0 && !error ? (
          <div className="py-16">
            <EmptyState
              icon={<FileText size={32} />}
              title="No theses yet"
              description="Theses are generated automatically by the pipeline. Check back after the next pipeline run."
              action={
                <button
                  type="button"
                  onClick={handleRefresh}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg",
                    "bg-gold text-cream font-sans text-[12px] font-semibold",
                    "hover:bg-gold-dark transition-colors cursor-pointer",
                  )}
                >
                  <RefreshCw size={12} />
                  Refresh
                </button>
              }
            />
          </div>
        ) : (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: "Total signals", value: theses.filter((t) => !userArchivedIds.has(t.id)).length, color: "" },
                { label: "HIGH", value: convictionCounts.HIGH, color: "text-gold" },
                { label: "MEDIUM", value: convictionCounts.MEDIUM, color: "text-signal-warn" },
                { label: "WATCH", value: convictionCounts.WATCH, color: "text-text-muted" },
              ].map((stat) => (
                <div key={stat.label} className="bg-cream rounded-xl p-3 border border-border-base">
                  <div className={`font-display text-2xl font-semibold ${stat.color || "text-text-primary"}`}>{stat.value}</div>
                  <div className="font-sans text-[11px] text-text-muted mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* System Intelligence Panel */}
            <SystemIntelligencePanel
              digest={digest}
              patterns={patterns}
              sources={sources}
              patternsLoading={patternsLoading}
              sourcesLoading={sourcesLoading}
            />

            {/* Filter tabs + View toggle + Refresh */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-2">
                {(
                  [
                    { key: "recommended" as const, label: "Recommended", count: (() => {
                      const sectors = profile?.sectors ?? [];
                      if (sectors.length === 0) return theses.filter((t) => !userArchivedIds.has(t.id)).length;
                      return theses.filter((t) => !userArchivedIds.has(t.id) && sectorMatchesProfile(t.sector, sectors)).length;
                    })() },
                    { key: "HIGH" as const, label: "HIGH", count: convictionCounts.HIGH },
                    { key: "MEDIUM" as const, label: "MEDIUM", count: convictionCounts.MEDIUM },
                    { key: "WATCH" as const, label: "WATCH", count: convictionCounts.WATCH },
                    { key: "all" as const, label: "All Theses", count: theses.filter((t) => !userArchivedIds.has(t.id)).length },
                    { key: "archived" as const, label: "Archived", count: userArchivedIds.size },
                    { key: "pending_review" as const, label: "Pending Review", count: convictionCounts.pending_review },
                  ]
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      setConvictionFilter(tab.key);
                      if (tab.key === "archived" && !showArchived) setShowArchived(true);
                      if (tab.key !== "archived" && showArchived) setShowArchived(false);
                    }}
                    className={cn(
                      "font-sans text-[11px] px-3 py-1.5 rounded-full border transition-all cursor-pointer inline-flex items-center gap-1.5",
                      convictionFilter === tab.key
                        ? "bg-espresso text-cream border-espresso"
                        : "bg-transparent text-text-secondary border-border-base hover:border-border-hover",
                    )}
                  >
                    {tab.key === "archived" && <Archive size={10} />}
                    {tab.label}
                    <span className="font-data text-[9px] opacity-70">{tab.count}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {/* List/Board toggle */}
                <div className="flex border border-border-base rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    className={cn(
                      "p-1.5 transition-colors cursor-pointer",
                      viewMode === "list" ? "bg-gold text-cream" : "text-text-muted hover:text-text-secondary",
                    )}
                    aria-label="List view"
                  >
                    <LayoutList size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("board")}
                    className={cn(
                      "p-1.5 transition-colors cursor-pointer",
                      viewMode === "board" ? "bg-gold text-cream" : "text-text-muted hover:text-text-secondary",
                    )}
                    aria-label="Board view"
                  >
                    <LayoutGrid size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
                >
                  <RefreshCw size={11} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-3 bg-signal-dn/10 border border-signal-dn/20 rounded-xl p-3 flex items-center justify-between">
                <p className="font-sans text-[12px] text-signal-dn">{error}</p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="text-signal-dn hover:text-signal-dn/70 cursor-pointer p-0.5 flex-shrink-0 ml-3"
                >
                  <span className="text-[14px]">&times;</span>
                </button>
              </div>
            )}

            {/* Content area */}
            {viewMode === "board" ? (
              <KanbanBoard
                theses={displayTheses}
                onSelect={handleSelect}
                selectedId={selectedId}
                filter={convictionFilter}
                onQuickAction={handleQuickAction}
                onDrop={async (id, patch) => {
                  console.log("[onDrop] before PATCH", id, patch);
                  // Optimistic update
                  setTheses((prev) =>
                    prev.map((t) =>
                      t.id === id
                        ? {
                            ...t,
                            ...(patch.status ? { status: patch.status as ThesisStatus } : {}),
                            ...(patch.conviction ? { conviction: patch.conviction as ThesisItem["conviction"] } : {}),
                          }
                        : t
                    )
                  );
                  try {
                    const res = await fetch(`/api/theses/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(patch),
                    });
                    const data = await res.json();
                    console.log("[onDrop] PATCH response", res.status, data);
                    if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
                  } catch (err) {
                    console.error("[onDrop] PATCH error, reverting", err);
                    fetchTheses();
                  }
                }}
              />
            ) : (
              <div className="grid grid-cols-[1fr_1.6fr] gap-3" style={{ height: "calc(100vh - 320px)" }}>
                <div className="overflow-y-auto">
                  <ThesisList
                    theses={displayTheses}
                    selectedId={selectedId}
                    onSelect={handleSelect}
                    filter="all"
                    isArchiveView={convictionFilter === "archived"}
                    onRestore={convictionFilter === "archived" ? handleRestore : undefined}
                    isPendingReview={convictionFilter === "pending_review"}
                    onQuickAction={handleQuickAction}
                    matchedSectors={convictionFilter === "recommended" ? (profile?.sectors ?? undefined) : undefined}
                  />
                </div>
                <ThesisDetailPanel
                  thesis={
                    convictionFilter === "archived"
                      ? archivedTheses.find((t) => t.id === selectedId) ?? null
                      : theses.find((t) => t.id === selectedId) ?? null
                  }
                  articles={relatedArticles[selectedId ?? ""] ?? []}
                  activeSignalCount={theses.filter((t) => !userArchivedIds.has(t.id)).length}
                  onArchive={(id) => {
                    // Optimistically add to user thesis states
                    setUserThesisStates((prev) => {
                      const exists = prev.find((s) => s.thesis_id === id);
                      if (exists) {
                        return prev.map((s) => (s.thesis_id === id ? { ...s, status: "archived" as const } : s));
                      }
                      return [...prev, { id: crypto.randomUUID(), thesis_id: id, status: "archived" as const }];
                    });
                    const remaining = theses.filter((t) => t.id !== id);
                    setSelectedId(remaining[0]?.id ?? null);
                    if (convictionFilter === "archived") setArchivedRefreshKey((k) => k + 1);
                  }}
                  onRegenerate={() => fetchTheses()}
                />
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

export default function ThesisBoardPage() {
  return (
    <Suspense>
      <ThesisBoardContent />
    </Suspense>
  );
}
