"use client";

import { useState, useCallback, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell";
import { ThesisList } from "@/components/thesis/ThesisList";
import { ThesisDetailPanel } from "@/components/thesis/thesis-detail-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Sparkles, FileText, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@supabase/ssr";
import type { ThesisItem, ThesisStatus } from "@/components/thesis";

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
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type ConvictionFilter = "all" | "bullish" | "bearish" | "watch";

function convictionToSentiment(conviction: string): string {
  switch (conviction) {
    case "BULLISH": return "bullish";
    case "BEARISH": return "bearish";
    case "WATCH": return "watch";
    default: return "watch";
  }
}

function ThesisBoardContent() {
  const searchParams = useSearchParams();
  const [theses, setTheses] = useState<ThesisItem[]>([]);
  const [convictionFilter, setConvictionFilter] = useState<ConvictionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [relatedArticles, setRelatedArticles] = useState<Record<string, RelatedArticle[]>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [archivedTheses, setArchivedTheses] = useState<ThesisItem[]>([]);
  const [archivedRefreshKey, setArchivedRefreshKey] = useState(0);

  // Auto-select thesis from query param
  useEffect(() => {
    const thesisId = searchParams.get("thesis");
    if (thesisId) {
      setSelectedId(thesisId);
    }
  }, [searchParams]);

  const fetchTheses = useCallback(async () => {
    try {
      const { data, error: dbErr } = await getSupabase()
        .from("theses")
        .select("*")
        .neq("status", "archived")
        .order("generated_at", { ascending: false })
        .limit(50);

      if (dbErr) throw dbErr;

      if (data && data.length > 0) {
        const mapped: ThesisItem[] = data.map((t) => ({
          id: t.id,
          title: t.title,
          conviction: t.conviction || "WATCH",
          sector: t.sector || "General",
          summary: t.rationale?.slice(0, 200) || "",
          rationale: t.rationale,
          catalyst: t.catalyst,
          catalyst_note: t.catalyst_note,
          evidence_chain: t.evidence_chain,
          status: (t.status as ThesisStatus) || "new-signal",
          updatedAt: t.generated_at ? timeAgo(t.generated_at) : "recently",
          source: t.source,
          bear_case: t.bear_case ?? null,
          adversarial_score: t.adversarial_score ?? null,
          passed_adversarial: t.passed_adversarial ?? null,
        }));
        setTheses(mapped);
      }
    } catch (e) {
      console.error("Failed to fetch theses:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTheses();
  }, [fetchTheses]);

  const fetchArticlesForThesis = useCallback(async (thesis: ThesisItem) => {
    if (relatedArticles[thesis.id]) return;
    try {
      // Try supporting_articles first (article IDs stored at generation time)
      const { data: thesisRow } = await getSupabase()
        .from("theses")
        .select("supporting_articles")
        .eq("id", thesis.id)
        .single();

      const supportingIds: string[] = Array.isArray(thesisRow?.supporting_articles)
        ? thesisRow.supporting_articles
        : [];

      if (supportingIds.length > 0) {
        const { data } = await getSupabase()
          .from("articles")
          .select("id, title, source, ingested_at, published_at, summary, sentiment, sector")
          .in("id", supportingIds);
        if (data && data.length > 0) {
          setRelatedArticles((prev) => ({ ...prev, [thesis.id]: data }));
          return;
        }
      }

      // Fallback: sector-matched articles
      const { data } = await getSupabase()
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
    const thesis = theses.find((t) => t.id === id);
    if (thesis) fetchArticlesForThesis(thesis);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/theses", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `API error: ${res.status}`);
      }

      await fetchTheses();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate theses");
    } finally {
      setGenerating(false);
    }
  };

  // Fetch archived theses when tab is toggled
  useEffect(() => {
    if (!showArchived) return;
    const fetchArchived = async () => {
      try {
        const { data, error: archiveErr } = await getSupabase()
          .from("theses")
          .select("*")
          .eq("status", "archived")
          .order("generated_at", { ascending: false })
          .limit(50);
        if (archiveErr) console.error("fetchArchived error:", archiveErr);
        console.log("[Archived] fetched:", data?.length, data?.[0]?.title);
        if (data) {
          setArchivedTheses(data.map((t) => ({
            id: t.id,
            title: t.title,
            conviction: t.conviction || "WATCH",
            sector: t.sector || "General",
            summary: t.rationale?.slice(0, 200) || "",
            rationale: t.rationale,
            catalyst: t.catalyst,
            catalyst_note: t.catalyst_note,
            evidence_chain: t.evidence_chain,
            status: "archived" as ThesisStatus,
            updatedAt: t.generated_at ? timeAgo(t.generated_at) : "recently",
            source: t.source,
            bear_case: t.bear_case ?? null,
            adversarial_score: t.adversarial_score ?? null,
            passed_adversarial: t.passed_adversarial ?? null,
          })));
        }
      } catch (e) {
        console.error("Failed to fetch archived theses:", e);
      }
    };
    fetchArchived();
  }, [showArchived, archivedRefreshKey]);

  const handleRestore = async (id: string) => {
    try {
      await getSupabase().from("theses").update({ status: "new-signal" }).eq("id", id);
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
    const counts = { bullish: 0, bearish: 0, watch: 0 };
    theses.forEach((t) => {
      const s = convictionToSentiment(t.conviction) as keyof typeof counts;
      if (s in counts) counts[s]++;
    });
    return counts;
  }, [theses]);

  const strongSignalCount = useMemo(() => {
    // Strong signal: derived score >= 65
    return theses.filter((t) => {
      const base = t.conviction === "BULLISH" ? 80 : t.conviction === "BEARISH" ? 30 : 55;
      const evidenceBonus = Math.min((t.evidence_chain?.length ?? 0) * 5, 15);
      return (base + evidenceBonus) >= 65;
    }).length;
  }, [theses]);

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
        ) : theses.length === 0 ? (
          <div className="py-16">
            <EmptyState
              icon={<FileText size={32} />}
              title="No theses yet"
              description="Click 'Generate Theses' to create AI-powered investment theses from your latest news feed."
              action={
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg",
                    "bg-gold text-cream font-sans text-[12px] font-semibold",
                    "hover:bg-gold-dark transition-colors cursor-pointer",
                    "disabled:opacity-50",
                  )}
                >
                  <Sparkles size={12} />
                  Generate Theses
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
                <div key={stat.label} className="bg-parchment-mid rounded-xl p-3 border border-border-base">
                  <div className={`font-display text-2xl font-semibold ${stat.color || "text-text-primary"}`}>{stat.value}</div>
                  <div className="font-sans text-[11px] text-text-muted mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Filter tabs + Generate button */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-2">
                {(["all", "bullish", "bearish", "watch"] as const).map((f) => (
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
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors disabled:opacity-50 cursor-pointer"
              >
                {generating ? "Generating..." : "\u2726 Generate Theses"}
              </button>
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

            {/* Two-column layout */}
            <div className="grid grid-cols-[1fr_1.6fr] gap-3" style={{ height: "calc(100vh - 280px)" }}>
              <div className="overflow-y-auto">
                <ThesisList
                  theses={showArchived ? archivedTheses : theses}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  filter={showArchived ? "all" : convictionFilter}
                  isArchiveView={showArchived}
                  onRestore={showArchived ? handleRestore : undefined}
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
                onRegenerate={() => {
                  // Re-fetch theses so catalyst_note / rationale update in the panel.
                  // Do NOT clear relatedArticles — would flash blank evidence feed.
                  fetchTheses();
                }}
              />
            </div>
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
