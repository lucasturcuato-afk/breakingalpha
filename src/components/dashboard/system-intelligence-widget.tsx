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

  const stats: { label: string; value: string }[] = [
    {
      label: "Last run",
      value: relativeTime(data?.lastRun ?? null),
    },
    {
      label: "Avg quality",
      value: data?.avgQualityScore != null ? `${data.avgQualityScore} / 10` : "\u2014",
    },
    {
      label: "Top pattern",
      value: data?.topPattern
        ? `${data.topPattern.sector} ${data.topPattern.horizon} \u00B7 ${Math.round(data.topPattern.win_rate * 100)}% confirm`
        : "\u2014",
    },
    {
      label: "Top source",
      value: data?.topSource
        ? `${data.topSource.source} \u00B7 ${Math.round(data.topSource.win_rate * 100)}% win rate`
        : "\u2014",
    },
    {
      label: "Thesis track",
      value: data?.thesisOutcomes
        ? `${data.thesisOutcomes.confirmed}\u2713 ${data.thesisOutcomes.invalidated}\u2717 ${data.thesisOutcomes.pending} pending`
        : "\u2014",
    },
    {
      label: "RAG index",
      value: data?.embeddingCoverage
        ? `${data.embeddingCoverage.articles + data.embeddingCoverage.theses} docs`
        : "\u2014",
    },
  ];

  return (
    <div className="bg-cream border border-border-base rounded-xl px-4 py-2.5 flex items-center gap-3">
      <span
        className="font-sans text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
        style={{ color: "var(--text-muted)" }}
      >
        <span style={{ color: "#D4A843" }}>{"\u2726"} </span>
        SIGNALERA INTELLIGENCE
      </span>

      {stats.map((stat, i) => (
        <span key={stat.label} className="flex items-center gap-3">
          {i > 0 && (
            <span className="border-l border-border-base h-4" aria-hidden="true" />
          )}
          <span className="font-sans text-[11px] text-text-secondary whitespace-nowrap">
            <span className="text-text-muted">{stat.label}:</span>{" "}
            {stat.value}
          </span>
        </span>
      ))}

      <span className="border-l border-border-base h-4" aria-hidden="true" />
      <span className="flex items-center gap-1.5 font-sans text-[11px] text-text-secondary whitespace-nowrap">
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ backgroundColor: "#D4A843" }}
        />
        Learning active
      </span>
    </div>
  );
}
