"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { SignalCard } from "@/components/trends/signal-card";
import { EmptyState } from "@/components/ui/empty-state";
import { TrendingUp, Sparkles, Plus, ExternalLink, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { MemoModal } from "@/components/memo/MemoModal";
import { createBrowserClient } from "@supabase/ssr";
import { useUserProfile } from "@/hooks/useUserProfile";
import { trackClientEvent } from "@/lib/track-event";
import { SignInModal } from "@/components/auth/sign-in-modal";
import type { SignalData } from "@/components/trends";
import { useLiveMood } from "@/hooks/useLiveMood";

const INDUSTRY_VERTICALS = [
  "Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
  "Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
  "Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture",
] as const;

const ACTIVITY_TYPES = [
  "Mergers & Acquisitions", "Private Equity", "Venture Capital", "IPO & Capital Markets",
  "Earnings & Results", "Macro & Policy", "Geopolitics", "Regulation & Legal",
  "Fundraising", "Crypto & Digital Assets", "Leadership & Operations",
] as const;

const allSignals: SignalData[] = [
  {
    id: "s1", title: "AI Chip Export Controls Expanding", anomaly: "critical",
    description: "Commerce Dept expanding restrictions to custom NVIDIA variants. Impact could reach $8B+ in China revenue by FY2026.",
    sparkData: [40, 42, 45, 52, 58, 72, 85, 90, 88, 95], timestamp: "12m ago",
    industry_verticals: ["Technology"],
    activity_types: ["Regulation & Legal", "Mergers & Acquisitions"],
  },
  {
    id: "s2", title: "Semiconductor M&A Freeze Deepening", anomaly: "high",
    description: "Antitrust reviews now averaging 18 months for chip deals. Intel-Tower and Synopsys-Ansys still pending.",
    sparkData: [20, 22, 18, 15, 12, 10, 8, 6, 5, 4], timestamp: "2h ago",
    industry_verticals: ["Technology"],
    activity_types: ["Mergers & Acquisitions"],
  },
  {
    id: "s3", title: "Cloud Capex Guidance Surging", anomaly: "high",
    description: "Combined hyperscaler capex for 2024 now $180B+, up 35% YoY. AI infrastructure spend driving reacceleration.",
    sparkData: [100, 108, 115, 125, 138, 145, 155, 162, 170, 180], timestamp: "5h ago",
    industry_verticals: ["Technology"],
    activity_types: ["Earnings & Results"],
  },
  {
    id: "s4", title: "Down Round Frequency Rising in Series B-C", anomaly: "medium",
    description: "22% of Series B-C rounds in Q1 were down rounds, up from 8% in 2021. Seed stage recovering faster.",
    sparkData: [5, 7, 10, 12, 15, 17, 19, 20, 21, 22], timestamp: "1d ago",
    industry_verticals: ["Technology", "Financial Services"],
    activity_types: ["Venture Capital", "Fundraising"],
  },
  {
    id: "s5", title: "AI Startup Valuations Decoupling from SaaS", anomaly: "medium",
    description: "AI companies raising at 40-80x revenue while traditional SaaS compressed to 8-12x. Bifurcation deepening.",
    sparkData: [15, 18, 22, 28, 35, 42, 50, 58, 65, 72], timestamp: "1d ago",
    industry_verticals: ["Technology"],
    activity_types: ["Venture Capital", "IPO & Capital Markets"],
  },
  {
    id: "s6", title: "VIX Term Structure Flattening", anomaly: "medium",
    description: "Contango compression suggests rising near-term uncertainty. 1M-3M spread at lowest since Oct 2023.",
    sparkData: [8, 7.5, 7, 6.2, 5.5, 4.8, 4.2, 3.5, 3, 2.5], timestamp: "3h ago",
    industry_verticals: ["Financial Services"],
    activity_types: ["Macro & Policy"],
  },
  {
    id: "s7", title: "Market Breadth Deteriorating", anomaly: "high",
    description: "Advance-decline line diverging from index highs. Only 38% of S&P above 50-day MA despite index near ATH.",
    sparkData: [72, 68, 62, 55, 50, 45, 42, 40, 38, 38], timestamp: "6h ago",
    industry_verticals: ["Financial Services"],
    activity_types: ["Macro & Policy"],
  },
  {
    id: "s8", title: "GLP-1 Drug Competition Heating Up", anomaly: "medium",
    description: "Amgen and Pfizer GLP-1 candidates entering Phase 3. TAM estimates rising from $50B to $100B+ by 2030.",
    sparkData: [30, 35, 42, 50, 58, 65, 72, 80, 90, 100], timestamp: "1d ago",
    industry_verticals: ["Healthcare & Biotech"],
    activity_types: ["Earnings & Results", "Mergers & Acquisitions"],
  },
  {
    id: "s9", title: "Nuclear SMR Permitting Accelerating", anomaly: "low",
    description: "NRC reviewing 4 SMR designs simultaneously. AI data center PPAs creating demand certainty for developers.",
    sparkData: [1, 1, 1, 2, 2, 2, 3, 3, 4, 4], timestamp: "2d ago",
    industry_verticals: ["Energy & Oil/Gas"],
    activity_types: ["Regulation & Legal"],
  },
  {
    id: "s10", title: "Japan Rate Normalization Accelerating", anomaly: "high",
    description: "Spring wage negotiations delivering 5.2% increases. BOJ widely expected to raise rates in July. Yen carry unwind risk elevated.",
    sparkData: [0, 0, 0, 0, 0.1, 0.1, 0.25, 0.25, 0.5, 0.75], timestamp: "6h ago",
    industry_verticals: ["Financial Services"],
    activity_types: ["Macro & Policy", "Geopolitics"],
  },
  {
    id: "s11", title: "PE Take-Private Activity Surging", anomaly: "low",
    description: "12 software take-privates announced in Q1, most since 2019. Average premium 35-45% to undisturbed price.",
    sparkData: [3, 4, 5, 6, 8, 8, 10, 11, 11, 12], timestamp: "2d ago",
    industry_verticals: ["Financial Services", "Technology"],
    activity_types: ["Private Equity", "Mergers & Acquisitions"],
  },
  {
    id: "s12", title: "Bitcoin ETF Flow Reversal Pattern", anomaly: "medium",
    description: "Inflows resumed after 3-day pause. Pattern consistent with institutional rebalancing rather than conviction buying.",
    sparkData: [500, 450, 380, 200, -50, -100, 80, 250, 350, 420], timestamp: "1h ago",
    industry_verticals: ["Financial Services"],
    activity_types: ["Crypto & Digital Assets"],
  },
];

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export default function TrendsPage() {
  const { mood, moodHeadline, moodDetails } = useLiveMood();
  const router = useRouter();
  const { profile } = useUserProfile();
  const [selectedVerticals, setSelectedVerticals] = useState<string[]>([]);
  const [verticalMatchMode, setVerticalMatchMode] = useState<"any" | "all">("any");
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [activityMatchMode, setActivityMatchMode] = useState<"any" | "all">("any");
  const [anomalyFilter, setAnomalyFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memoSignal, setMemoSignal] = useState<SignalData | null>(null);
  const [addingThesis, setAddingThesis] = useState(false);
  const [isSignedOut, setIsSignedOut] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsSignedOut(user === null);
    }).catch(() => setIsSignedOut(true));
  }, []);

  // Personalization helpers — soft-fail when profile is null.
  const profileSectors = useMemo(
    () => (profile?.sectors ?? []).map((s) => s.toLowerCase()),
    [profile?.sectors],
  );
  const watchlistUpper = useMemo(
    () => (profile?.watchlist_tickers ?? []).map((t) => t.toUpperCase()),
    [profile?.watchlist_tickers],
  );

  function personalBoost(s: SignalData): number {
    let score = 0;
    // Sector alignment — direct profile picks
    if (profileSectors.length) {
      if (
        s.industry_verticals.some((v) =>
          profileSectors.some((ps) => v.toLowerCase().includes(ps) || ps.includes(v.toLowerCase())),
        )
      ) {
        score += 2;
      }
    }
    // Watchlist ticker mention in description/title
    if (watchlistUpper.length) {
      const text = `${s.title} ${s.description}`.toUpperCase();
      if (watchlistUpper.some((t) => text.includes(t))) score += 3;
    }
    return score;
  }

  const filtered = useMemo(() => {
    const filtered = allSignals.filter((s) => {
      if (anomalyFilter !== "all" && s.anomaly !== anomalyFilter) return false;
      if (selectedVerticals.length > 0) {
        const match = verticalMatchMode === "all"
          ? selectedVerticals.every((v) => s.industry_verticals.includes(v))
          : s.industry_verticals.some((v) => selectedVerticals.includes(v));
        if (!match) return false;
      }
      if (selectedActivities.length > 0) {
        const match = activityMatchMode === "all"
          ? selectedActivities.every((a) => s.activity_types.includes(a))
          : s.activity_types.some((a) => selectedActivities.includes(a));
        if (!match) return false;
      }
      return true;
    });
    // Stable boost sort — profile-relevant signals rise to the top when the
    // user has set sectors/watchlist. When the profile is empty this is a
    // no-op (all signals get boost=0, original order preserved).
    if (!profileSectors.length && !watchlistUpper.length) return filtered;
    return [...filtered].sort((a, b) => personalBoost(b) - personalBoost(a));
  }, [anomalyFilter, selectedVerticals, verticalMatchMode, selectedActivities, activityMatchMode, profileSectors, watchlistUpper]); // eslint-disable-line react-hooks/exhaustive-deps

  const gatedIds = useMemo(
    () => isSignedOut ? new Set(filtered.slice(0, 3).map((s) => s.id)) : null,
    [isSignedOut, filtered],
  );

  const grouped = useMemo(() => {
    const verticals = new Map<string, SignalData[]>();
    const activities = new Map<string, SignalData[]>();
    for (const s of filtered) {
      for (const v of s.industry_verticals) {
        const arr = verticals.get(v) || [];
        arr.push(s);
        verticals.set(v, arr);
      }
      for (const a of s.activity_types) {
        const arr = activities.get(a) || [];
        arr.push(s);
        activities.set(a, arr);
      }
    }
    const sortByCount = (map: Map<string, SignalData[]>) =>
      Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
    return {
      verticals: sortByCount(verticals),
      activities: sortByCount(activities),
    };
  }, [filtered]);

  return (
    <AppShell pageTitle="Trends" mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
      {/* Preview nudge banner */}
      {isSignedOut && (
        <div className="px-6 py-3 border-b border-gold/20 flex items-center justify-between" style={{ backgroundColor: "var(--gold-muted)" }}>
          <p className="font-sans text-[12px] text-text-secondary">
            Previewing trend signals — sign in to unlock all {filtered.length} signals and filters.
          </p>
          <button
            type="button"
            onClick={() => setShowSignIn(true)}
            className="flex-shrink-0 ml-4 font-sans text-[12px] font-semibold cursor-pointer"
            style={{ color: "var(--espresso)" }}
          >
            Sign in free →
          </button>
        </div>
      )}

      {/* Filter bar */}
      {isSignedOut ? (
        <div className="sticky top-0 z-10 bg-parchment border-b border-border-base px-6 py-3">
          <p className="font-sans text-[12px] text-text-muted flex items-center gap-1.5">
            <Lock size={12} />
            Filters available after sign in
          </p>
        </div>
      ) : (
        <div className="sticky top-0 z-10 bg-parchment border-b border-border-base px-6 py-3 space-y-3">
          {/* Row 1: Industry Vertical pills */}
          <div>
            <p className="font-data text-[9px] uppercase tracking-widest text-gold mb-1.5">
              Industry Vertical
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {INDUSTRY_VERTICALS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() =>
                    setSelectedVerticals((prev) =>
                      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                    )
                  }
                  className={cn(
                    "px-3 py-1 rounded-lg font-data text-[10px] font-bold uppercase cursor-pointer transition-colors border",
                    selectedVerticals.includes(v)
                      ? "border-gold bg-gold-muted text-gold"
                      : "border-border-base bg-white text-text-muted hover:text-text-primary",
                  )}
                >
                  {v}
                </button>
              ))}
              {selectedVerticals.length >= 2 && (
                <div className="flex items-center gap-1 ml-1">
                  {(["any", "all"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setVerticalMatchMode(mode)}
                      className={cn(
                        "px-2.5 py-0.5 rounded font-data text-[9px] font-bold uppercase cursor-pointer transition-colors border",
                        verticalMatchMode === mode
                          ? "border-gold bg-gold-muted text-gold"
                          : "border-border-base bg-white text-text-muted hover:text-text-primary",
                      )}
                    >
                      Match {mode}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Activity Type pills */}
          <div>
            <p className="font-data text-[9px] uppercase tracking-widest text-gold mb-1.5">
              Activity Type
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {ACTIVITY_TYPES.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() =>
                    setSelectedActivities((prev) =>
                      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a],
                    )
                  }
                  className={cn(
                    "px-3 py-1 rounded-lg font-data text-[10px] font-bold uppercase cursor-pointer transition-colors border",
                    selectedActivities.includes(a)
                      ? "border-gold bg-gold-muted text-gold"
                      : "border-border-base bg-white text-text-muted hover:text-text-primary",
                  )}
                >
                  {a}
                </button>
              ))}
              {selectedActivities.length >= 2 && (
                <div className="flex items-center gap-1 ml-1">
                  {(["any", "all"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setActivityMatchMode(mode)}
                      className={cn(
                        "px-2.5 py-0.5 rounded font-data text-[9px] font-bold uppercase cursor-pointer transition-colors border",
                        activityMatchMode === mode
                          ? "border-gold bg-gold-muted text-gold"
                          : "border-border-base bg-white text-text-muted hover:text-text-primary",
                      )}
                    >
                      Match {mode}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Row 3: Severity + count */}
          <div className="flex items-center gap-1.5">
            {["all", "critical", "high", "medium", "low"].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setAnomalyFilter(level)}
                className={cn(
                  "px-3 py-1 rounded-lg font-data text-[10px] font-bold uppercase cursor-pointer transition-colors border",
                  anomalyFilter === level
                    ? "border-gold bg-gold-muted text-gold"
                    : "border-border-base bg-white text-text-muted hover:text-text-primary",
                )}
              >
                {level === "all" ? "All" : level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
            <span className="ml-auto font-sans text-[11px] text-text-muted">
              {filtered.length} signals
            </span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-6 py-5">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={32} />}
            title="No signals match your filters"
            description="Try broadening your filters."
          />
        ) : (
          <div className="space-y-8">
            {/* BY INDUSTRY cluster */}
            <div>
              <h2 className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-4">
                BY INDUSTRY
              </h2>
              <div className="space-y-6">
                {grouped.verticals.map(([vertical, signals]) => {
                  const visibleSignals = gatedIds ? signals.filter((s) => gatedIds.has(s.id)) : signals;
                  if (visibleSignals.length === 0) return null;
                  return (
                  <div key={vertical}>
                    <h3 className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                      {vertical}
                      <span className="ml-2 font-data text-[10px] text-text-faint">{visibleSignals.length}</span>
                    </h3>
                    <div className="grid grid-cols-2 gap-2.5">
                      {visibleSignals.map((signal) => {
                        const boost = personalBoost(signal);
                        const isRelevant = boost > 0;
                        const hasWatchlistMention = watchlistUpper.length > 0 &&
                          watchlistUpper.some((t) => `${signal.title} ${signal.description}`.toUpperCase().includes(t));
                        return (
                        <div
                          key={signal.id}
                          onClick={() => {
                            const nextId = expandedId === signal.id ? null : signal.id;
                            setExpandedId(nextId);
                            if (nextId !== null) {
                              trackClientEvent("pattern_clicked", {
                                signal_id: signal.id,
                                sector: signal.industry_verticals?.[0] ?? null,
                              });
                            }
                          }}
                          className={cn(
                            "cursor-pointer transition-opacity",
                            profileSectors.length > 0 && !isRelevant && "opacity-60",
                          )}
                        >
                          {hasWatchlistMention && (
                            <span className="inline-flex items-center gap-1 font-sans text-[9px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5 mb-1">
                              Watchlist mention
                            </span>
                          )}
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
                                  onClick={(e) => { e.stopPropagation(); if (isSignedOut) { setShowSignIn(true); return; } setMemoSignal(signal); }}
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
                                    if (isSignedOut) { setShowSignIn(true); return; }
                                    setAddingThesis(true);
                                    try {
                                      await getSupabase().from("theses").insert({
                                        title: signal.title,
                                        conviction: signal.anomaly === "critical" || signal.anomaly === "high" ? "BEARISH" : "WATCH",
                                        sector: signal.industry_verticals[0] ?? "General",
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
                        );
                      })}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            {/* BY ACTIVITY cluster */}
            <div>
              <h2 className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-4">
                BY ACTIVITY
              </h2>
              <div className="space-y-6">
                {grouped.activities.map(([activity, signals]) => {
                  const visibleSignals = gatedIds ? signals.filter((s) => gatedIds.has(s.id)) : signals;
                  if (visibleSignals.length === 0) return null;
                  return (
                  <div key={activity}>
                    <h3 className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                      {activity}
                      <span className="ml-2 font-data text-[10px] text-text-faint">{visibleSignals.length}</span>
                    </h3>
                    <div className="grid grid-cols-2 gap-2.5">
                      {visibleSignals.map((signal) => {
                        const boost = personalBoost(signal);
                        const isRelevant = boost > 0;
                        const hasWatchlistMention = watchlistUpper.length > 0 &&
                          watchlistUpper.some((t) => `${signal.title} ${signal.description}`.toUpperCase().includes(t));
                        return (
                        <div
                          key={signal.id}
                          onClick={() => {
                            const nextId = expandedId === signal.id ? null : signal.id;
                            setExpandedId(nextId);
                            if (nextId !== null) {
                              trackClientEvent("pattern_clicked", {
                                signal_id: signal.id,
                                sector: signal.industry_verticals?.[0] ?? null,
                              });
                            }
                          }}
                          className={cn(
                            "cursor-pointer transition-opacity",
                            profileSectors.length > 0 && !isRelevant && "opacity-60",
                          )}
                        >
                          {hasWatchlistMention && (
                            <span className="inline-flex items-center gap-1 font-sans text-[9px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5 mb-1">
                              Watchlist mention
                            </span>
                          )}
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
                                  onClick={(e) => { e.stopPropagation(); if (isSignedOut) { setShowSignIn(true); return; } setMemoSignal(signal); }}
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
                                    if (isSignedOut) { setShowSignIn(true); return; }
                                    setAddingThesis(true);
                                    try {
                                      await getSupabase().from("theses").insert({
                                        title: signal.title,
                                        conviction: signal.anomaly === "critical" || signal.anomaly === "high" ? "BEARISH" : "WATCH",
                                        sector: signal.industry_verticals[0] ?? "General",
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
                        );
                      })}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            {/* Gate row — signed-out users see first 3 signals then this */}
            {isSignedOut && (
              <div className="relative mt-2">
                <div
                  className="pointer-events-none absolute -top-16 left-0 right-0 h-16"
                  style={{ background: "linear-gradient(to bottom, transparent, var(--parchment))" }}
                />
                <div
                  className="flex items-center justify-between px-4 py-3 rounded-xl border"
                  style={{ borderColor: "rgba(201,146,42,0.3)", backgroundColor: "var(--gold-muted)" }}
                >
                  <div className="flex items-center gap-2">
                    <Lock size={14} style={{ color: "var(--gold)" }} />
                    <span className="font-sans text-[13px] font-semibold text-espresso">
                      Sign in to see all {filtered.length} signals
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSignIn(true)}
                    className="font-sans text-[12px] font-semibold cursor-pointer"
                    style={{ color: "var(--gold)" }}
                  >
                    Sign in →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {memoSignal && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoSignal(null)}
          title={memoSignal.title}
          content={`${memoSignal.title}\n\nIndustry: ${memoSignal.industry_verticals.join(", ")}\nSeverity: ${memoSignal.anomaly}\n\n${memoSignal.description}`}
          type="brief"
        />
      )}
      <SignInModal
        isOpen={showSignIn}
        onClose={() => setShowSignIn(false)}
        headline="Sign in to unlock signals"
        message="Create a free account to see all signals, generate memos, and track theses."
      />
    </AppShell>
  );
}
