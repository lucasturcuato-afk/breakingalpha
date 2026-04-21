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

// ── Helpers for mapping trend_clusters → SignalData ──

function mapSignalStrength(strength: number | null): "critical" | "high" | "medium" | "low" {
  if (!strength && strength !== 0) return "medium";
  if (strength >= 0.8) return "critical";
  if (strength >= 0.6) return "high";
  if (strength >= 0.4) return "medium";
  return "low";
}

/** Parse JSONB fields that Supabase may return as JSON strings */
function safeArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function sectorToVertical(sector: string): string[] {
  const s = sector.toLowerCase();
  if (s.includes("tech") || s.includes("ai") || s.includes("software") || s.includes("semi")) return ["Technology"];
  if (s.includes("health") || s.includes("biotech") || s.includes("pharma")) return ["Healthcare & Biotech"];
  if (s.includes("energy") || s.includes("oil") || s.includes("gas") || s.includes("nuclear")) return ["Energy & Oil/Gas"];
  if (s.includes("financ") || s.includes("bank") || s.includes("insurance") || s.includes("crypto")) return ["Financial Services"];
  if (s.includes("consumer") || s.includes("retail")) return ["Consumer & Retail"];
  if (s.includes("industrial") || s.includes("manufactur")) return ["Industrials & Manufacturing"];
  if (s.includes("defense") || s.includes("aerospace")) return ["Aerospace & Defense"];
  if (s.includes("real estate") || s.includes("reit")) return ["Real Estate"];
  if (s.includes("media") || s.includes("telecom")) return ["Media & Telecom"];
  if (s.includes("material") || s.includes("mining")) return ["Materials & Mining"];
  if (s.includes("agri")) return ["Agriculture"];
  return [];
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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
  const [allSignals, setAllSignals] = useState<SignalData[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsSignedOut(user === null);
    }).catch(() => setIsSignedOut(true));
  }, []);

  useEffect(() => {
    async function loadSignals() {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from("trend_clusters")
          .select("id, label, cluster_type, article_count, source_count, strength_score, top_companies, top_themes, top_sectors, created_at, cross_source_flag")
          .order("created_at", { ascending: false })
          .limit(100);

        if (error) {
          console.error("[trends] fetch error:", error.message);
          setSignalsLoading(false);
          return;
        }

        if (data && data.length > 0) {
          const mapped: SignalData[] = data.map((row) => {
            const companies = safeArray(row.top_companies).slice(0, 3);
            const themes = safeArray(row.top_themes).slice(0, 3);
            const rawSectors = safeArray(row.top_sectors);
            const verticals = [...new Set(rawSectors.flatMap(sectorToVertical))];

            const parts: string[] = [];
            if (companies.length) parts.push(`Key players: ${companies.join(", ")}.`);
            if (themes.length) parts.push(`Themes: ${themes.join(", ")}.`);
            parts.push(`${row.article_count ?? 0} articles from ${row.source_count ?? 0} sources.`);
            if (row.cluster_type === "emerging") parts.push("Emerging trend.");
            if (row.cross_source_flag) parts.push("Multi-source corroboration.");

            return {
              id: row.id,
              title: row.label || "Untitled Signal",
              anomaly: mapSignalStrength(row.strength_score),
              description: parts.join(" "),
              sparkData: [],
              timestamp: timeAgo(row.created_at),
              industry_verticals: verticals,
              activity_types: [],
            };
          });
          setAllSignals(mapped);
        }
      } catch (e) {
        console.error("[trends] load error:", e);
      } finally {
        setSignalsLoading(false);
      }
    }
    loadSignals();
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
        {signalsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-parchment-mid animate-pulse" />
            ))}
          </div>
        ) : allSignals.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={32} />}
            title="No trend clusters yet"
            description="Trend signals will appear after the pipeline runs and identifies recurring narratives."
          />
        ) : filtered.length === 0 ? (
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
