"use client";

import { useState, useCallback, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell";
import { ThesisList } from "@/components/thesis/ThesisList";
import { ThesisDetailPanel } from "@/components/thesis/thesis-detail-panel";
import { KanbanBoard } from "@/components/thesis/kanban-board";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText, Archive, RefreshCw, ChevronDown, ChevronUp, LayoutList, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThesisItem, ThesisStatus, WeeklyDigest, PatternRow, SourceCredibilityRow } from "@/components/thesis";

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type ConvictionFilter = "all" | "bullish" | "bearish" | "watch" | "pending_review";

function convictionToSentiment(conviction: string): string {
  switch (conviction) {
    case "BULLISH": return "bullish";
    case "BEARISH": return "bearish";
    case "WATCH": return "watch";
    default: return "watch";
  }
}

// Map API row to ThesisItem
function mapThesisRow(t: Record<string, unknown>): ThesisItem {
  return {
    id: String(t.id || ""),
    title: String(t.title || ""),
    conviction: (t.conviction as ThesisItem["conviction"]) || "WATCH",
    sector: String(t.sector || "General"),
    summary: String(t.rationale || "").slice(0, 200) || "",
    rationale: t.rationale as string | undefined,
    catalyst: t.catalyst as string | undefined,
    catalyst_note: t.catalyst_note as string | undefined,
    evidence_chain: t.evidence_chain as ThesisItem["evidence_chain"],
    status: (t.status as ThesisStatus) || "new-signal",
    updatedAt: t.generated_at ? timeAgo(String(t.generated_at)) : "recently",
    source: t.source as string | undefined,
    bear_case: (t.bear_case as string) ?? null,
    adversarial_score: (t.adversarial_score as number) ?? null,
    passed_adversarial: (t.passed_adversarial as boolean) ?? null,
    outcome: (t.outcome as ThesisItem["outcome"]) ?? null,
    outcome_notes: (t.outcome_notes as string) ?? null,
    signal_breakdown: (t.signal_breakdown as Record<string, unknown>) ?? null,
    supporting_article_ids: (t.supporting_articles as string[]) ?? null,
    ticker: (t.ticker as string) ?? null,
    horizon: (t.horizon as string) ?? null,
    check_after: (t.check_after as string) ?? null,
    notes: (t.notes as string) ?? null,
    generated_at: (t.generated_at as string) ?? null,
  };
}

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 animate-in fade-in-0 slide-in-from-top-2">
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
                {sources.map((s) => (
                  <div key={s.id} className="flex items-center justify-between">
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
  const [viewMode, setViewMode] = useState<"list" | "board">("list");

  // Auto-select thesis from query param
  useEffect(() => {
    const thesisId = searchParams.get("thesis");
    if (thesisId) setSelectedId(thesisId);
  }, [searchParams]);

  // Fetch theses from new GET endpoint
  const fetchTheses = useCallback(async () => {
    try {
      const res = await fetch("/api/theses");
      const data = await res.json();
      if (data.theses && Array.isArray(data.theses)) {
        const mapped: ThesisItem[] = data.theses
          .filter((t: Record<string, unknown>) => t.status !== "archived")
          .map(mapThesisRow);
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
    fetchIntelligence();
  }, [fetchTheses, fetchIntelligence]);

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

  // Fetch archived theses
  useEffect(() => {
    if (!showArchived) return;
    const fetchArchived = async () => {
      try {
        const { createBrowserClient } = await import("@supabase/ssr");
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const { data, error: archiveErr } = await supabase
          .from("theses")
          .select("*")
          .eq("status", "archived")
          .order("generated_at", { ascending: false })
          .limit(50);
        if (archiveErr) console.error("fetchArchived error:", archiveErr);
        if (data) {
          setArchivedTheses(data.map((t) => mapThesisRow(t as unknown as Record<string, unknown>)));
        }
      } catch (e) {
        console.error("Failed to fetch archived theses:", e);
      }
    };
    fetchArchived();
  }, [showArchived, archivedRefreshKey]);

  const handleRestore = async (id: string) => {
    try {
      await fetch(`/api/theses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "new-signal" }),
      });
      const restored = archivedTheses.find((t) => t.id === id);
      setArchivedTheses((prev) => prev.filter((t) => t.id !== id));
      if (restored) {
        setTheses((prev) => [{ ...restored, status: "new-signal" as ThesisStatus }, ...prev]);
      }
    } catch (e) {
      console.error("Failed to restore thesis:", e);
    }
  };

  const sentimentCounts = useMemo(() => {
    const counts = { bullish: 0, bearish: 0, watch: 0, pending_review: 0 };
    theses.forEach((t) => {
      if (t.status === "pending_review") counts.pending_review++;
      const s = convictionToSentiment(t.conviction) as keyof typeof counts;
      if (s in counts) counts[s]++;
    });
    return counts;
  }, [theses]);

  const strongSignalCount = useMemo(() => {
    return theses.filter((t) => {
      const base = t.conviction === "BULLISH" ? 80 : t.conviction === "BEARISH" ? 30 : 55;
      const evidenceBonus = Math.min((Array.isArray(t.evidence_chain) ? t.evidence_chain.length : 0) * 5, 15);
      return (base + evidenceBonus) >= 65;
    }).length;
  }, [theses]);

  // Filter theses for display
  const displayTheses = useMemo(() => {
    const source = showArchived ? archivedTheses : theses;
    if (showArchived) return source;
    if (convictionFilter === "pending_review") {
      return source.filter((t) => t.status === "pending_review");
    }
    if (convictionFilter !== "all") {
      return source.filter((t) => convictionToSentiment(t.conviction) === convictionFilter);
    }
    return source;
  }, [theses, archivedTheses, showArchived, convictionFilter]);

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
              {(showArchived
                ? [
                    { label: "Archived", value: archivedTheses.length, color: "" },
                    { label: "Bullish", value: archivedTheses.filter((t) => t.conviction === "BULLISH").length, color: "text-signal-up" },
                    { label: "Bearish", value: archivedTheses.filter((t) => t.conviction === "BEARISH").length, color: "text-signal-dn" },
                    { label: "Watch", value: archivedTheses.filter((t) => t.conviction === "WATCH").length, color: "text-signal-warn" },
                  ]
                : [
                    { label: "Total signals", value: theses.length, color: "" },
                    { label: "Strong signals", value: strongSignalCount, color: "text-gold" },
                    { label: "Bullish", value: sentimentCounts.bullish, color: "text-signal-up" },
                    { label: "Bearish", value: sentimentCounts.bearish, color: "text-signal-dn" },
                  ]
              ).map((stat) => (
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
                {(["all", "bullish", "bearish", "watch", "pending_review"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setConvictionFilter(f)}
                    className={cn(
                      "font-sans text-[11px] px-3 py-1.5 rounded-full border transition-all cursor-pointer",
                      convictionFilter === f
                        ? "bg-espresso text-cream border-espresso"
                        : "bg-transparent text-text-secondary border-border-base hover:border-border-hover",
                    )}
                  >
                    {f === "all"
                      ? `All ${theses.length}`
                      : f === "pending_review"
                        ? `Pending ${sentimentCounts.pending_review}`
                        : `${f.charAt(0).toUpperCase() + f.slice(1)} ${sentimentCounts[f as keyof typeof sentimentCounts] ?? 0}`}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setShowArchived(!showArchived); setConvictionFilter("all"); }}
                  className={cn(
                    "font-sans text-[11px] px-3 py-1.5 rounded-full border transition-all cursor-pointer inline-flex items-center gap-1.5",
                    showArchived
                      ? "bg-espresso/40 text-text-primary border-espresso/40"
                      : "bg-transparent text-text-secondary border-border-base hover:border-border-hover",
                  )}
                >
                  <Archive size={10} />
                  {showArchived ? "Archived \u00d7" : `Archived${archivedTheses.length > 0 ? ` ${archivedTheses.length}` : ""}`}
                </button>
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
              />
            ) : (
              <div className="grid grid-cols-[1fr_1.6fr] gap-3" style={{ height: "calc(100vh - 320px)" }}>
                <div className="overflow-y-auto">
                  <ThesisList
                    theses={displayTheses}
                    selectedId={selectedId}
                    onSelect={handleSelect}
                    filter={showArchived ? "all" : convictionFilter}
                    isArchiveView={showArchived}
                    onRestore={showArchived ? handleRestore : undefined}
                    isPendingReview={convictionFilter === "pending_review"}
                    onQuickAction={handleQuickAction}
                  />
                </div>
                <ThesisDetailPanel
                  thesis={
                    showArchived
                      ? archivedTheses.find((t) => t.id === selectedId) ?? null
                      : theses.find((t) => t.id === selectedId) ?? null
                  }
                  articles={relatedArticles[selectedId ?? ""] ?? []}
                  onArchive={(id) => {
                    setTheses((prev) => prev.filter((t) => t.id !== id));
                    const remaining = theses.filter((t) => t.id !== id);
                    setSelectedId(remaining[0]?.id ?? null);
                    if (showArchived) setArchivedRefreshKey((k) => k + 1);
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
