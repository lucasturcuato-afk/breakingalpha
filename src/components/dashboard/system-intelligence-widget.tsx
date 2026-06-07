"use client";

import { useState, useEffect, useCallback } from "react";
import { InfoTooltip } from "@/components/ui/info-tooltip";

interface IntelligenceData {
  lastRun: string | null;
  avgQualityScore: number | null;
  topPattern: { sector: string; horizon: string; win_rate: number } | null;
  topSource: { source: string; win_rate: number } | null;
  thesisOutcomes: { confirmed: number; invalidated: number; inconclusive: number; pending: number } | null;
  embeddingCoverage: { articles: number; theses: number } | null;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "\u2014";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function SystemIntelligenceWidget() {
  const [data, setData] = useState<IntelligenceData | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/system-intelligence");
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const pendingCount = data?.thesisOutcomes?.pending ?? 0;
  const embeddingTotal = (data?.embeddingCoverage?.articles ?? 0) + (data?.embeddingCoverage?.theses ?? 0);

  return (
    <div className="border border-border-base rounded-lg px-3 py-1.5 flex items-center gap-2.5">
      <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted whitespace-nowrap">
        <span className="text-gold">{"\u2726"} </span>
        Signalera Intelligence
      </span>
      <InfoTooltip content="Meta-analysis of Signalera's prediction accuracy, pattern recognition, and source reliability." side="bottom" iconSize={10} />

      <span className="border-l border-border-base h-3" aria-hidden="true" />
      <span className="font-sans text-[10px] text-text-secondary whitespace-nowrap">
        <span className="text-text-muted">Last run:</span>{" "}
        {relativeTime(data?.lastRun ?? null)}
      </span>

      <span className="border-l border-border-base h-3" aria-hidden="true" />
      <span className="font-sans text-[10px] text-text-secondary whitespace-nowrap">
        {pendingCount} theses pending
      </span>

      {embeddingTotal > 0 && (
        <>
          <span className="border-l border-border-base h-3" aria-hidden="true" />
          <span className="font-data text-[10px] text-text-secondary whitespace-nowrap">
            {embeddingTotal} embeddings
          </span>
        </>
      )}

      {data?.avgQualityScore != null && (
        <>
          <span className="border-l border-border-base h-3" aria-hidden="true" />
          <span className="font-data text-[10px] text-text-secondary whitespace-nowrap">
            Quality{" "}
            <span className={data.avgQualityScore >= 7 ? "text-signal-up font-semibold" : data.avgQualityScore >= 4 ? "text-gold font-semibold" : "text-signal-dn font-semibold"}>
              {data.avgQualityScore.toFixed(1)}
            </span>
          </span>
        </>
      )}

      <span className="border-l border-border-base h-3" aria-hidden="true" />
      <span className="flex items-center gap-1 font-sans text-[10px] text-text-secondary whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
        Learning active
      </span>
    </div>
  );
}
