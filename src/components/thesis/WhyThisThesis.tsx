"use client";

import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ChevronDown } from "lucide-react";

import { redactRationale } from "@/lib/thesis-recommendation-guard";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

interface ThesisRow {
  supporting_article_ids: string[] | null;
  sector: string | null;
  generated_at: string | null;
  adversarial_score: number | null;
  passed_adversarial: boolean | null;
  bear_case: string | null;
}

interface ArticleRef {
  id: string;
  title: string;
  source: string | null;
}

interface ClusterRef {
  label: string;
  cluster_type: string | null;
  strength_score: number | null;
  article_count: number | null;
}

interface SourceCredRef {
  source: string | null;
  win_rate: number | null;
}

interface PatternRef {
  dominant_signal: string | null;
  win_rate: number | null;
  n_observed: number | null;
  horizon: string | null;
}

interface WhyData {
  articles: ArticleRef[];
  clusters: ClusterRef[];
  sourceReliability: { avgWinRate: number; sourceCount: number } | null;
  patterns: PatternRef[];
  adversarial: { score: number | null; passed: boolean | null; bearCase: string | null } | null;
  systemContext: string | null;
}

function truncateWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  if (words.length <= max) return text;
  return words.slice(0, max).join(" ") + "...";
}

export function WhyThisThesis({ thesisId }: { thesisId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WhyData | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchData = useCallback(async () => {
    if (loaded) return;
    const supabase = getSupabase();

    try {
      // 1. Fetch the thesis row
      const { data: thesisRow } = await supabase
        .from("theses")
        .select("supporting_article_ids, sector, generated_at, adversarial_score, passed_adversarial, bear_case")
        .eq("id", thesisId)
        .single();

      if (!thesisRow) {
        setLoaded(true);
        return;
      }

      const thesis = thesisRow as ThesisRow;
      const result: WhyData = {
        articles: [],
        clusters: [],
        sourceReliability: null,
        patterns: [],
        adversarial: null,
        systemContext: null,
      };

      // Run all legs in parallel
      const legs = await Promise.allSettled([
        // Leg 1: SOURCED FROM
        (async () => {
          try {
            const ids = thesis.supporting_article_ids;
            if (!ids || ids.length === 0) return;
            const { data: arts } = await supabase
              .from("articles")
              .select("id, title, source")
              .in("id", ids);
            if (arts) result.articles = arts as ArticleRef[];
          } catch { /* soft fail */ }
        })(),

        // Leg 2: CLUSTER SIGNAL
        (async () => {
          try {
            if (!thesis.generated_at) return;
            const genDate = new Date(thesis.generated_at);
            const dayBefore = new Date(genDate.getTime() - 86400000).toISOString();
            const dayAfter = new Date(genDate.getTime() + 86400000).toISOString();

            let query = supabase
              .from("trend_clusters")
              .select("label, cluster_type, strength_score, article_count")
              .gte("created_at", dayBefore)
              .lte("created_at", dayAfter)
              .limit(3);

            if (thesis.sector) {
              query = query.eq("top_sectors->>0", thesis.sector);
            }

            const { data: clusters } = await query;

            if (clusters && clusters.length > 0) {
              result.clusters = clusters as ClusterRef[];
            } else if (thesis.sector) {
              // Retry without sector filter
              const { data: fallback } = await supabase
                .from("trend_clusters")
                .select("label, cluster_type, strength_score, article_count")
                .gte("created_at", dayBefore)
                .lte("created_at", dayAfter)
                .limit(3);
              if (fallback) result.clusters = fallback as ClusterRef[];
            }
          } catch { /* soft fail */ }
        })(),

        // Leg 3: SOURCE RELIABILITY (depends on leg 1, but we fetch articles again if needed)
        (async () => {
          try {
            const ids = thesis.supporting_article_ids;
            if (!ids || ids.length === 0) return;
            const { data: arts } = await supabase
              .from("articles")
              .select("source")
              .in("id", ids);
            if (!arts || arts.length === 0) return;
            const uniqueSources = [...new Set(arts.map((a: { source: string | null }) => a.source).filter(Boolean))] as string[];
            if (uniqueSources.length === 0) return;
            const { data: creds } = await supabase
              .from("source_credibility")
              .select("source, win_rate")
              .in("source", uniqueSources);
            if (creds && creds.length > 0) {
              const rates = (creds as SourceCredRef[]).filter((c) => c.win_rate !== null).map((c) => c.win_rate!);
              if (rates.length > 0) {
                result.sourceReliability = {
                  avgWinRate: Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100),
                  sourceCount: rates.length,
                };
              }
            }
          } catch { /* soft fail */ }
        })(),

        // Leg 4: PATTERN MATCH
        (async () => {
          try {
            if (!thesis.sector) return;
            const { data: pats } = await supabase
              .from("pattern_library")
              .select("dominant_signal, win_rate, n_observed, horizon")
              .eq("sector", thesis.sector)
              .order("win_rate", { ascending: false })
              .limit(3);
            if (pats) result.patterns = pats as PatternRef[];
          } catch { /* soft fail */ }
        })(),

        // Leg 5: ADVERSARIAL CHECK
        (async () => {
          try {
            result.adversarial = {
              score: thesis.adversarial_score,
              passed: thesis.passed_adversarial,
              // Render-time neutralisation of stored prose (this component loads
              // bear_case directly, bypassing the page-level neutralizeThesis).
              bearCase: thesis.bear_case ? redactRationale(thesis.bear_case) : null,
            };
          } catch { /* soft fail */ }
        })(),

        // Leg 6: SYSTEM CONTEXT
        (async () => {
          try {
            if (!thesis.generated_at) return;
            const { data: digests } = await supabase
              .from("weekly_digests")
              .select("thesis_prompt_addendum, generated_at")
              .lte("generated_at", thesis.generated_at)
              .order("generated_at", { ascending: false })
              .limit(1);
            if (digests && digests.length > 0) {
              const addendum = (digests[0] as { thesis_prompt_addendum: string | null }).thesis_prompt_addendum;
              if (addendum) {
                result.systemContext = truncateWords(addendum, 50);
              }
            }
          } catch { /* soft fail */ }
        })(),
      ]);

      // Check if any legs had data — even if some failed, show what we got
      void legs;
      setData(result);
    } catch (e) {
      console.error("WhyThisThesis load error:", e);
    } finally {
      setLoaded(true);
    }
  }, [thesisId, loaded]);

  useEffect(() => {
    setData(null);
    setLoaded(false);
    setOpen(false);
  }, [thesisId]);

  const handleToggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !loaded) {
      fetchData();
    }
  };

  const hasContent = data && (
    data.articles.length > 0 ||
    data.clusters.length > 0 ||
    data.sourceReliability !== null ||
    data.patterns.length > 0 ||
    (data.adversarial && (data.adversarial.score !== null || data.adversarial.bearCase)) ||
    data.systemContext !== null
  );

  return (
    <div className="bg-parchment rounded-xl p-3">
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 cursor-pointer w-full"
      >
        <span className="font-sans text-[11px] text-text-secondary font-bold">
          Why this thesis
        </span>
        <ChevronDown
          size={12}
          className={`text-gold transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {!loaded && (
            <div className="font-sans text-[11px] text-text-muted">Loading...</div>
          )}

          {loaded && !hasContent && (
            <div className="font-sans text-[11px] text-text-muted italic">
              No provenance data available for this thesis.
            </div>
          )}

          {data && hasContent && (
            <>
              {/* SOURCED FROM */}
              {data.articles.length > 0 && (
                <div>
                  <div className="font-sans text-[10px] text-text-muted font-semibold mb-1">
                    Sourced from
                  </div>
                  <div className="space-y-0.5">
                    {data.articles.map((a) => (
                      <div key={a.id} className="font-sans text-[12px] text-text-secondary">
                        {a.title} &mdash; <span className="text-text-muted">{a.source || "Unknown"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CLUSTER SIGNAL */}
              {data.clusters.length > 0 && (
                <div>
                  <div className="font-sans text-[10px] text-text-muted font-semibold mb-1">
                    Cluster signal
                  </div>
                  <div className="space-y-0.5">
                    {data.clusters.map((c, i) => (
                      <div key={i} className="font-sans text-[12px] text-text-secondary">
                        {c.label} ({c.cluster_type || "general"}) &mdash; strength{" "}
                        <span className="font-display">{c.strength_score?.toFixed(2) ?? "--"}</span>,{" "}
                        <span className="font-display">{c.article_count ?? 0}</span> articles
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SOURCE RELIABILITY */}
              {data.sourceReliability && (
                <div>
                  <div className="font-sans text-[10px] text-text-muted font-semibold mb-1">
                    Source reliability
                  </div>
                  <div className="font-sans text-[12px] text-text-secondary">
                    Average source reliability:{" "}
                    <span className="font-display text-gold font-semibold">
                      {data.sourceReliability.avgWinRate}% win rate
                    </span>{" "}
                    across {data.sourceReliability.sourceCount} sources
                  </div>
                </div>
              )}

              {/* PATTERN MATCH */}
              {data.patterns.length > 0 && (
                <div>
                  <div className="font-sans text-[10px] text-text-muted font-semibold mb-1">
                    Pattern match
                  </div>
                  <div className="space-y-0.5">
                    {data.patterns.map((p, i) => (
                      <div key={i} className="font-sans text-[12px] text-text-secondary">
                        Sector pattern: <span className="font-semibold">{p.dominant_signal || "mixed"}</span> signals confirm{" "}
                        <span className="font-display text-gold">{p.win_rate !== null ? `${Math.round(p.win_rate * 100)}%` : "--"}</span> of the time
                        ({p.n_observed ?? 0} samples, {p.horizon || "any"})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ADVERSARIAL CHECK */}
              {data.adversarial && (data.adversarial.score !== null || data.adversarial.bearCase) && (
                <div>
                  <div className="font-sans text-[10px] text-text-muted font-semibold mb-1">
                    Adversarial check
                  </div>
                  <div className="font-sans text-[12px] text-text-secondary">
                    {data.adversarial.score !== null && (
                      <span>
                        Adversarial score:{" "}
                        <span className="font-display font-semibold">
                          {typeof data.adversarial.score === "number" ? data.adversarial.score.toFixed(2) : "--"}
                        </span>{" "}
                        ({data.adversarial.passed ? "passed" : "failed"})
                      </span>
                    )}
                    {data.adversarial.bearCase && (
                      <div className="mt-0.5 text-text-muted text-[11px]">
                        {data.adversarial.bearCase.length > 100
                          ? data.adversarial.bearCase.slice(0, 100) + "..."
                          : data.adversarial.bearCase}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SYSTEM CONTEXT */}
              {data.systemContext && (
                <div>
                  <div className="font-sans text-[10px] text-text-muted font-semibold mb-1">
                    System context
                  </div>
                  <div className="font-sans text-[12px] text-text-muted italic">
                    {data.systemContext}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
