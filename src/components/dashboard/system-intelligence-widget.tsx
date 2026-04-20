"use client";

import { useState, useEffect, useCallback } from "react";

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

  return (
    <div className="border border-border-base rounded-lg px-3 py-1.5 flex items-center gap-2.5">
      <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted whitespace-nowrap">
        <span className="text-gold">{"\u2726"} </span>
        Signalera Intelligence
      </span>

      <span className="border-l border-border-base h-3" aria-hidden="true" />
      <span className="font-sans text-[10px] text-text-secondary whitespace-nowrap">
        <span className="text-text-muted">Last run:</span>{" "}
        {relativeTime(data?.lastRun ?? null)}
      </span>

      <span className="border-l border-border-base h-3" aria-hidden="true" />
      <span className="font-sans text-[10px] text-text-secondary whitespace-nowrap">
        {pendingCount} theses pending
      </span>

      <span className="border-l border-border-base h-3" aria-hidden="true" />
      <span className="flex items-center gap-1 font-sans text-[10px] text-text-secondary whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
        Learning active
      </span>
    </div>
  );
}
