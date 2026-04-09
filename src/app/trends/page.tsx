"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { SignalCard } from "@/components/trends/signal-card";
import { EmptyState } from "@/components/ui/empty-state";
import { TrendingUp, Sparkles, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { MemoModal } from "@/components/memo/MemoModal";
import { createBrowserClient } from "@supabase/ssr";
import type { SignalData } from "@/components/trends";

const allSignals: SignalData[] = [
  // Technology M&A
  {
    id: "s1", title: "AI Chip Export Controls Expanding", sector: "Technology M&A", anomaly: "critical",
    description: "Commerce Dept expanding restrictions to custom NVIDIA variants. Impact could reach $8B+ in China revenue by FY2026.",
    sparkData: [40, 42, 45, 52, 58, 72, 85, 90, 88, 95], timestamp: "12m ago", type: "Regulatory",
  },
  {
    id: "s2", title: "Semiconductor M&A Freeze Deepening", sector: "Technology M&A", anomaly: "high",
    description: "Antitrust reviews now averaging 18 months for chip deals. Intel-Tower and Synopsys-Ansys still pending.",
    sparkData: [20, 22, 18, 15, 12, 10, 8, 6, 5, 4], timestamp: "2h ago", type: "M&A",
  },
  {
    id: "s3", title: "Cloud Capex Guidance Surging", sector: "Technology M&A", anomaly: "high",
    description: "Combined hyperscaler capex for 2024 now $180B+, up 35% YoY. AI infrastructure spend driving reacceleration.",
    sparkData: [100, 108, 115, 125, 138, 145, 155, 162, 170, 180], timestamp: "5h ago", type: "Earnings",
  },
  // Venture Capital
  {
    id: "s4", title: "Down Round Frequency Rising in Series B-C", sector: "Venture Capital", anomaly: "medium",
    description: "22% of Series B-C rounds in Q1 were down rounds, up from 8% in 2021. Seed stage recovering faster.",
    sparkData: [5, 7, 10, 12, 15, 17, 19, 20, 21, 22], timestamp: "1d ago", type: "Funding",
  },
  {
    id: "s5", title: "AI Startup Valuations Decoupling from SaaS", sector: "Venture Capital", anomaly: "medium",
    description: "AI companies raising at 40-80x revenue while traditional SaaS compressed to 8-12x. Bifurcation deepening.",
    sparkData: [15, 18, 22, 28, 35, 42, 50, 58, 65, 72], timestamp: "1d ago", type: "Valuation",
  },
  // Public Markets
  {
    id: "s6", title: "VIX Term Structure Flattening", sector: "Public Markets", anomaly: "medium",
    description: "Contango compression suggests rising near-term uncertainty. 1M-3M spread at lowest since Oct 2023.",
    sparkData: [8, 7.5, 7, 6.2, 5.5, 4.8, 4.2, 3.5, 3, 2.5], timestamp: "3h ago", type: "Volatility",
  },
  {
    id: "s7", title: "Market Breadth Deteriorating", sector: "Public Markets", anomaly: "high",
    description: "Advance-decline line diverging from index highs. Only 38% of S&P above 50-day MA despite index near ATH.",
    sparkData: [72, 68, 62, 55, 50, 45, 42, 40, 38, 38], timestamp: "6h ago", type: "Technical",
  },
  // Healthcare & Biotech
  {
    id: "s8", title: "GLP-1 Drug Competition Heating Up", sector: "Healthcare & Biotech", anomaly: "medium",
    description: "Amgen and Pfizer GLP-1 candidates entering Phase 3. TAM estimates rising from $50B to $100B+ by 2030.",
    sparkData: [30, 35, 42, 50, 58, 65, 72, 80, 90, 100], timestamp: "1d ago", type: "Pipeline",
  },
  // Energy & Climate
  {
    id: "s9", title: "Nuclear SMR Permitting Accelerating", sector: "Energy & Climate", anomaly: "low",
    description: "NRC reviewing 4 SMR designs simultaneously. AI data center PPAs creating demand certainty for developers.",
    sparkData: [1, 1, 1, 2, 2, 2, 3, 3, 4, 4], timestamp: "2d ago", type: "Regulatory",
  },
  // Geopolitics & Macro
  {
    id: "s10", title: "Japan Rate Normalization Accelerating", sector: "Geopolitics & Macro", anomaly: "high",
    description: "Spring wage negotiations delivering 5.2% increases. BOJ widely expected to raise rates in July. Yen carry unwind risk elevated.",
    sparkData: [0, 0, 0, 0, 0.1, 0.1, 0.25, 0.25, 0.5, 0.75], timestamp: "6h ago", type: "Rates",
  },
  // Private Equity
  {
    id: "s11", title: "PE Take-Private Activity Surging", sector: "Private Equity", anomaly: "low",
    description: "12 software take-privates announced in Q1, most since 2019. Average premium 35-45% to undisturbed price.",
    sparkData: [3, 4, 5, 6, 8, 8, 10, 11, 11, 12], timestamp: "2d ago", type: "M&A",
  },
  // Fintech & Crypto
  {
    id: "s12", title: "Bitcoin ETF Flow Reversal Pattern", sector: "Fintech & Crypto", anomaly: "medium",
    description: "Inflows resumed after 3-day pause. Pattern consistent with institutional rebalancing rather than conviction buying.",
    sparkData: [500, 450, 380, 200, -50, -100, 80, 250, 350, 420], timestamp: "1h ago", type: "Flows",
  },
];

const sectors = [...new Set(allSignals.map((s) => s.sector))];

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export default function TrendsPage() {
  const router = useRouter();
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [anomalyFilter, setAnomalyFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memoSignal, setMemoSignal] = useState<SignalData | null>(null);
  const [addingThesis, setAddingThesis] = useState(false);

  const filtered = useMemo(() => {
    return allSignals.filter((s) => {
      if (sectorFilter !== "all" && s.sector !== sectorFilter) return false;
      if (anomalyFilter !== "all" && s.anomaly !== anomalyFilter) return false;
      return true;
    });
  }, [sectorFilter, anomalyFilter]);

  // Group by sector
  const grouped = useMemo(() => {
    const map = new Map<string, SignalData[]>();
    for (const s of filtered) {
      const existing = map.get(s.sector) || [];
      existing.push(s);
      map.set(s.sector, existing);
    }
    return map;
  }, [filtered]);

  return (
    <AppShell pageTitle="Trends" mood="neutral" moodHeadline="Markets steady" moodDetails={["VIX 14.2", "S&P +0.38%"]}>
      {/* Filter bar */}
      <div className="sticky top-0 z-10 bg-parchment border-b border-border-base px-6 py-2.5 flex items-center gap-4">
        {/* Sector filter */}
        <div className="flex items-center gap-1.5">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint">
            Sector
          </span>
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className={cn(
              "h-7 px-2 rounded-md border border-border-base bg-parchment-mid",
              "font-sans text-[11px] text-text-primary",
              "hover:border-border-hover focus:outline-none focus:border-gold",
              "cursor-pointer",
            )}
          >
            <option value="all">All Sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Anomaly filter */}
        <div className="flex items-center gap-1.5">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint">
            Severity
          </span>
          <div className="flex gap-1">
            {["all", "critical", "high", "medium", "low"].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setAnomalyFilter(level)}
                className={cn(
                  "px-2.5 py-1 rounded-md font-sans text-[11px] font-medium transition-all duration-[var(--duration-base)]",
                  "cursor-pointer",
                  anomalyFilter === level
                    ? "bg-espresso text-cream"
                    : "text-text-muted hover:bg-parchment-mid hover:text-text-primary",
                )}
              >
                {level === "all" ? "All" : level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <span className="ml-auto font-sans text-[11px] text-text-muted">
          {filtered.length} signals
        </span>
      </div>

      {/* Content */}
      <div className="px-6 py-5">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={32} />}
            title="No signals match your filters"
            description="Try broadening your sector or severity filters."
          />
        ) : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([sector, signals]) => (
              <div key={sector}>
                <h2 className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                  {sector}
                  <span className="ml-2 font-data text-[10px] text-text-faint">
                    {signals.length}
                  </span>
                </h2>
                <div className="grid grid-cols-2 gap-2.5">
                  {signals.map((signal) => (
                    <div
                      key={signal.id}
                      onClick={() => setExpandedId(expandedId === signal.id ? null : signal.id)}
                      className="cursor-pointer"
                    >
                      <SignalCard signal={signal} />
                      <div
                        className={cn(
                          "overflow-hidden transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                          expandedId === signal.id ? "max-h-60 opacity-100" : "max-h-0 opacity-0",
                        )}
                      >
                        <div className="bg-white border border-t-0 border-border-base rounded-b-xl px-4 pb-3 -mt-1">
                          <p className="font-sans text-[11px] text-text-secondary leading-relaxed mb-3">
                            {signal.description}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setMemoSignal(signal); }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
                            >
                              <Sparkles size={11} />
                              Generate Memo
                            </button>
                            <button
                              type="button"
                              disabled={addingThesis}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setAddingThesis(true);
                                try {
                                  await getSupabase().from("theses").insert({
                                    title: signal.title,
                                    conviction: signal.anomaly === "critical" || signal.anomaly === "high" ? "BEARISH" : "WATCH",
                                    sector: signal.sector || "General",
                                    rationale: signal.description,
                                    source: "Trends",
                                    status: "new-signal",
                                    generated_at: new Date().toISOString(),
                                  });
                                  router.push("/thesis-board");
                                } catch (err) {
                                  console.error("Failed to add thesis:", err);
                                } finally {
                                  setAddingThesis(false);
                                }
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
                            >
                              <Plus size={11} />
                              Add to Thesis
                            </button>
                            <a
                              href={`/live-feed?q=${encodeURIComponent(signal.title)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-parchment-mid border border-border-base font-sans text-[11px] font-medium text-text-secondary hover:border-border-hover transition-colors"
                            >
                              <ExternalLink size={11} />
                              View related articles
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {memoSignal && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoSignal(null)}
          title={memoSignal.title}
          content={`${memoSignal.title}\n\nSector: ${memoSignal.sector}\nSeverity: ${memoSignal.anomaly}\n\n${memoSignal.description}`}
          type="brief"
        />
      )}
    </AppShell>
  );
}
