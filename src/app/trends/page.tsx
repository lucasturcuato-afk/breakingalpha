"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { AppShell } from "@/components/shell";
import { EmptyState } from "@/components/ui/empty-state";
import { TrendingUp, Lock, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@supabase/ssr";
import { useUserProfile } from "@/hooks/useUserProfile";
import { trackClientEvent } from "@/lib/track-event";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { useLiveMood } from "@/hooks/useLiveMood";

// ── Filter constants (Noah's original 3-row layout) ──

const INDUSTRY_VERTICALS = [
  "Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
  "Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
  "Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture",
];

const ACTIVITY_TYPES = [
  "Mergers & Acquisitions", "Private Equity", "Venture Capital", "IPO & Capital Markets",
  "Earnings & Results", "Macro & Policy", "Geopolitics", "Regulation & Legal",
  "Fundraising", "Crypto & Digital Assets", "Leadership & Operations",
];

type AnomalyFilter = "all" | "low" | "medium" | "high" | "critical";

// ── Types ──

interface TrendSignal {
  id: string;
  label: string;
  cluster_type: string;
  article_count: number;
  source_count: number;
  strength_score: number;
  confidence_score: number;
  novelty_score: number;
  cross_source_flag: boolean;
  underrepresented_flag: boolean;
  top_companies: string[];
  top_themes: string[];
  top_sectors: string[];
  representative_article_ids: string[];
  matched_prior_cluster_keys: string[];
  lookback_run_count: number;
  created_at: string;
}

interface SourceArticle {
  id: string;
  title: string;
  source: string;
  published_at: string;
}

interface RelatedThesis {
  id: string;
  title: string;
  sector: string;
}

// ── Helpers ──

function safeArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
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

function strengthBorder(score: number): string {
  if (score >= 0.8) return "border-l-signal-dn";
  if (score >= 0.6) return "border-l-signal-warn";
  return "border-l-border-base";
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function strengthToAnomaly(score: number): AnomalyFilter {
  if (score >= 0.8) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

function buildSignalTitle(s: TrendSignal): { headline: string; subline: string } {
  const theme = s.top_themes[0];
  const companies = s.top_companies.slice(0, 3);
  const headline = theme
    ? `${theme}${companies.length ? ` \u2014 ${companies.join(", ")}` : ""}`
    : s.label;
  const subline = `${s.article_count} articles from ${s.source_count} sources`;
  return { headline, subline };
}

function buildOverview(s: TrendSignal): string {
  const parts: string[] = [];
  if (s.top_themes.length > 0) parts.push(`Key themes: ${s.top_themes.slice(0, 3).join(", ")}.`);
  if (s.top_companies.length > 0) parts.push(`Companies: ${s.top_companies.slice(0, 4).join(", ")}.`);
  if (s.top_sectors.length > 0) parts.push(`Sectors: ${s.top_sectors.slice(0, 2).join(", ")}.`);
  if (s.cross_source_flag) parts.push(`Verified across ${s.source_count} independent sources.`);
  if (s.matched_prior_cluster_keys.length > 0) parts.push(`Recurring signal — seen ${s.matched_prior_cluster_keys.length + 1} times.`);
  return parts.join(" ");
}

function generateSparkData(s: TrendSignal): number[] {
  const points: number[] = [];
  const runs = Math.max(s.lookback_run_count, 1);
  const priorMatches = s.matched_prior_cluster_keys.length;
  // Simulate a trendline: start low, build up based on recurrence
  for (let i = 0; i < Math.min(runs, 8); i++) {
    const base = i < (runs - priorMatches) ? 0.1 + Math.random() * 0.15 : 0.3 + Math.random() * 0.3;
    points.push(base);
  }
  // Current strength as final point
  points.push(s.strength_score);
  return points;
}

type ShowFilter = "all" | "emerging" | "cross-source" | "underreported" | "my-sectors";

interface TimelineGroup {
  label: string;
  dateLabel: string;
  signals: TrendSignal[];
}

function groupByDate(signals: TrendSignal[]): TimelineGroup[] {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);

  const today: TrendSignal[] = [];
  const yesterday: TrendSignal[] = [];
  const thisWeek: TrendSignal[] = [];
  const older: TrendSignal[] = [];

  for (const s of signals) {
    const d = new Date(s.created_at);
    if (d >= todayStart) today.push(s);
    else if (d >= yesterdayStart) yesterday.push(s);
    else if (d >= weekStart) thisWeek.push(s);
    else older.push(s);
  }

  const groups: TimelineGroup[] = [];
  if (today.length) groups.push({ label: "Today", dateLabel: todayStart.toLocaleDateString("en-US", { month: "long", day: "numeric" }), signals: today });
  if (yesterday.length) groups.push({ label: "Yesterday", dateLabel: yesterdayStart.toLocaleDateString("en-US", { month: "long", day: "numeric" }), signals: yesterday });
  if (thisWeek.length) groups.push({ label: "Earlier this week", dateLabel: `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}\u2013${yesterdayStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, signals: thisWeek });
  if (older.length) groups.push({ label: "Older", dateLabel: "", signals: older });
  return groups;
}

function cardTier(s: TrendSignal): "expanded" | "mid" | "compact" {
  if (s.strength_score >= 0.7 && s.article_count >= 6) return "expanded";
  if (s.strength_score >= 0.4 || s.article_count >= 4) return "mid";
  return "compact";
}

const MAX_VISIBLE = 5;

// ── Component ──

export default function TrendsPage() {
  const { mood, moodHeadline, moodDetails } = useLiveMood();
  const { profile } = useUserProfile();

  // ── State ──
  const [isSignedOut, setIsSignedOut] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [allSignals, setAllSignals] = useState<TrendSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalArticles, setTotalArticles] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedVerticals, setSelectedVerticals] = useState<Set<string>>(new Set());
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set());
  const [anomalyFilter, setAnomalyFilter] = useState<AnomalyFilter>("all");
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [articleCache, setArticleCache] = useState<Record<string, SourceArticle[]>>({});
  const [theses, setTheses] = useState<RelatedThesis[]>([]);

  // ── Personalization ──
  const profileSectors = useMemo(
    () => (profile?.sectors ?? []).map((s) => s.toLowerCase()),
    [profile?.sectors],
  );
  const watchlistUpper = useMemo(
    () => (profile?.watchlist_tickers ?? []).map((t) => t.toUpperCase()),
    [profile?.watchlist_tickers],
  );

  function boostScore(s: TrendSignal): number {
    let score = 0;
    if (profileSectors.length) {
      if (s.top_sectors.some((ts) => profileSectors.some((ps) => ts.toLowerCase().includes(ps) || ps.includes(ts.toLowerCase())))) {
        score += 2;
      }
    }
    if (watchlistUpper.length) {
      const text = `${s.label} ${s.top_companies.join(" ")}`.toUpperCase();
      if (watchlistUpper.some((t) => text.includes(t))) score += 3;
    }
    return score;
  }

  // ── Auth check ──
  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsSignedOut(user === null);
    }).catch(() => setIsSignedOut(true));
  }, []);

  // ── Load signals ──
  useEffect(() => {
    async function load() {
      try {
        const supabase = getSupabase();
        const [signalResult, countResult] = await Promise.all([
          supabase
            .from("trend_clusters")
            .select("id, label, cluster_type, article_count, source_count, strength_score, confidence_score, novelty_score, cross_source_flag, underrepresented_flag, top_companies, top_themes, top_sectors, representative_article_ids, matched_prior_cluster_keys, lookback_run_count, created_at")
            .order("created_at", { ascending: false })
            .limit(200),
          supabase
            .from("articles")
            .select("id", { count: "exact", head: true }),
        ]);

        if (signalResult.error) {
          console.error("[trends] fetch error:", signalResult.error.message);
        } else if (signalResult.data) {
          const mapped: TrendSignal[] = signalResult.data.map((row) => ({
            id: row.id,
            label: row.label || "Untitled Signal",
            cluster_type: row.cluster_type || "",
            article_count: row.article_count ?? 0,
            source_count: row.source_count ?? 0,
            strength_score: row.strength_score ?? 0,
            confidence_score: row.confidence_score ?? 0,
            novelty_score: row.novelty_score ?? 0,
            cross_source_flag: row.cross_source_flag ?? false,
            underrepresented_flag: row.underrepresented_flag ?? false,
            top_companies: safeArray(row.top_companies),
            top_themes: safeArray(row.top_themes),
            top_sectors: safeArray(row.top_sectors),
            representative_article_ids: safeArray(row.representative_article_ids),
            matched_prior_cluster_keys: safeArray(row.matched_prior_cluster_keys),
            lookback_run_count: row.lookback_run_count ?? 0,
            created_at: row.created_at,
          }));
          setAllSignals(mapped);
        }
        setTotalArticles(countResult.count ?? 0);
      } catch (e) {
        console.error("[trends] load error:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Load theses for matching ──
  useEffect(() => {
    const supabase = getSupabase();
    supabase.from("theses").select("id, title, sector").order("generated_at", { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setTheses(data); });
  }, []);

  // ── Article fetching for expanded cards ──
  const fetchArticlesForSignal = useCallback(async (signalId: string, articleIds: string[]) => {
    if (articleCache[signalId] || articleIds.length === 0) return;
    const supabase = getSupabase();
    const { data } = await supabase
      .from("articles")
      .select("id, title, source, published_at")
      .in("id", articleIds.slice(0, 5));
    if (data) setArticleCache((prev) => ({ ...prev, [signalId]: data }));
  }, [articleCache]);

  // ── Related thesis (sector + company overlap, then sector-only) ──
  function findRelatedThesis(signal: TrendSignal): RelatedThesis | null {
    const signalSectors = signal.top_sectors.map((s) => s.toLowerCase());
    const signalCompanies = signal.top_companies.map((c) => c.toLowerCase());

    // Try sector + company overlap first
    const sectorAndCompany = theses.find((t) => {
      const tSector = t.sector.toLowerCase();
      const tTitle = t.title.toLowerCase();
      const sectorMatch = signalSectors.some((ss) => tSector.includes(ss) || ss.includes(tSector));
      const companyMatch = signalCompanies.some((c) => tTitle.includes(c));
      return sectorMatch && companyMatch;
    });
    if (sectorAndCompany) return sectorAndCompany;

    // Fallback: sector-only
    return theses.find((t) => {
      const tSector = t.sector.toLowerCase();
      return signalSectors.some((ss) => tSector.includes(ss) || ss.includes(tSector));
    }) ?? null;
  }

  // ── Derived stats ──
  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const newTodayCount = useMemo(() => allSignals.filter((s) => new Date(s.created_at) >= todayStart).length, [allSignals, todayStart]);
  const crossSourceCount = useMemo(() => allSignals.filter((s) => s.cross_source_flag).length, [allSignals]);
  const underreportedCount = useMemo(() => allSignals.filter((s) => s.underrepresented_flag).length, [allSignals]);

  // ── Filtering ──
  const filtered = useMemo(() => {
    let result = allSignals;

    // Row 1: industry verticals — fuzzy match against top_sectors
    if (selectedVerticals.size > 0) {
      result = result.filter((s) =>
        s.top_sectors.some((ts) => {
          const tsLower = ts.toLowerCase();
          return Array.from(selectedVerticals).some((v) => {
            const vLower = v.toLowerCase();
            return tsLower.includes(vLower) || vLower.includes(tsLower);
          });
        }),
      );
    }

    // Row 2: activity types — fuzzy match against top_themes
    if (selectedActivities.size > 0) {
      result = result.filter((s) =>
        s.top_themes.some((tt) => {
          const ttLower = tt.toLowerCase();
          return Array.from(selectedActivities).some((a) => {
            const aLower = a.toLowerCase();
            return ttLower.includes(aLower) || aLower.includes(ttLower);
          });
        }),
      );
    }

    // Row 3: anomaly / severity filter
    if (anomalyFilter !== "all") {
      result = result.filter((s) => strengthToAnomaly(s.strength_score) === anomalyFilter);
    }

    if (showFilter === "emerging") result = result.filter((s) => s.cluster_type === "emerging");
    if (showFilter === "cross-source") result = result.filter((s) => s.cross_source_flag);
    if (showFilter === "underreported") result = result.filter((s) => s.underrepresented_flag);
    if (showFilter === "my-sectors") {
      result = result.filter((s) => s.top_sectors.some((ts) => profileSectors.some((ps) => ts.toLowerCase().includes(ps) || ps.includes(ts.toLowerCase()))));
    }

    if (profileSectors.length || watchlistUpper.length) {
      result = [...result].sort((a, b) => boostScore(b) - boostScore(a));
    }

    return result;
  }, [allSignals, selectedVerticals, selectedActivities, anomalyFilter, showFilter, profileSectors, watchlistUpper]); // eslint-disable-line react-hooks/exhaustive-deps

  const gatedIds = useMemo(
    () => isSignedOut ? new Set(filtered.slice(0, 3).map((s) => s.id)) : null,
    [isSignedOut, filtered],
  );

  const timelineGroups = useMemo(() => {
    const visibleSignals = gatedIds ? filtered.filter((s) => gatedIds.has(s.id)) : filtered;
    return groupByDate(visibleSignals);
  }, [filtered, gatedIds]);

  // ── Pill helper ──
  function Pill({ active, onClick, children, variant }: { active: boolean; onClick: () => void; children: React.ReactNode; variant?: "gold" }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "px-2.5 py-1 rounded-lg font-data text-[10px] font-bold uppercase cursor-pointer transition-colors border whitespace-nowrap",
          active
            ? variant === "gold"
              ? "bg-gold-muted border-gold/30 text-gold"
              : "border-gold bg-gold-muted text-gold"
            : "border-border-base bg-white text-text-muted hover:text-text-primary",
        )}
      >
        {children}
      </button>
    );
  }

  // ── Signal hover / click handlers ──
  function handleSignalHover(signal: TrendSignal) {
    setHoveredId(signal.id);
    fetchArticlesForSignal(signal.id, signal.representative_article_ids);
  }

  function handleSignalClick(signal: TrendSignal) {
    const nextId = expandedId === signal.id ? null : signal.id;
    setExpandedId(nextId);
    if (nextId !== null) {
      trackClientEvent("pattern_clicked", {
        signal_id: signal.id,
        sector: signal.top_sectors[0] ?? null,
      });
      fetchArticlesForSignal(signal.id, signal.representative_article_ids);
    }
  }

  // ── Watchlist check ──
  function isWatchlistTicker(company: string): boolean {
    return watchlistUpper.length > 0 && watchlistUpper.some((t) => company.toUpperCase().includes(t));
  }

  // ── Sparkline ──
  function MiniSparkline({ data, color }: { data: number[]; color: string }) {
    if (data.length < 2) return null;
    const w = 80;
    const h = 24;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    });
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-6 flex-shrink-0">
        <path d={`M ${points.join(" L ")}`} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // ── Render functions ──

  function renderBadgeRow(s: TrendSignal) {
    const priorCount = s.matched_prior_cluster_keys.length;
    return (
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
        {s.cluster_type === "emerging" ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-signal-up/30 bg-signal-up/10 font-data text-[9px] font-bold text-signal-up uppercase">
            <span className="text-[8px]">{"\u2B06"}</span> emerging
          </span>
        ) : priorCount > 0 ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-base bg-parchment-mid font-data text-[9px] font-bold text-text-muted uppercase">
            {"\u21BB"} recurring {"\u00B7"} seen {priorCount + 1}{"\u00D7"}
          </span>
        ) : null}
        {s.cross_source_flag && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-signal-up/20 bg-signal-up/5 font-data text-[9px] font-bold text-signal-up uppercase">
            {"\u2713"} {s.source_count} independent sources
          </span>
        )}
        {s.underrepresented_flag && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-data text-[9px] font-bold uppercase" style={{ borderColor: "var(--signal-ai)", color: "var(--signal-ai)", backgroundColor: "rgba(124,58,237,0.06)" }}>
            underreported
          </span>
        )}
        <span className="ml-auto font-data text-[9px] text-text-faint">{timeAgo(s.created_at)}</span>
      </div>
    );
  }

  function renderCompanies(s: TrendSignal) {
    if (s.top_companies.length === 0) return null;
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="font-data text-[8px] uppercase tracking-widest text-text-faint mr-0.5">COS:</span>
        {s.top_companies.slice(0, 5).map((c) => (
          <span
            key={c}
            className={cn(
              "font-data text-[10px] uppercase",
              isWatchlistTicker(c)
                ? "bg-gold-muted border border-gold/30 text-gold font-semibold rounded px-1 py-0.5"
                : "text-text-secondary",
            )}
          >
            {c}{isWatchlistTicker(c) ? " \u2726" : ""}
          </span>
        ))}
      </div>
    );
  }

  function renderThemes(s: TrendSignal) {
    if (s.top_themes.length === 0) return null;
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="font-data text-[8px] uppercase tracking-widest text-text-faint mr-0.5">THEMES:</span>
        {s.top_themes.slice(0, 4).map((t) => (
          <span key={t} className="font-data text-[10px] text-text-secondary">{t}</span>
        ))}
      </div>
    );
  }

  function renderSourceArticles(s: TrendSignal) {
    const articles = articleCache[s.id];
    if (!articles || articles.length === 0) return null;
    return (
      <div className="mt-3 pt-2.5 border-t border-border-base">
        <p className="font-data text-[8px] uppercase tracking-widest text-text-faint mb-2">Source articles</p>
        <div className="space-y-1">
          {articles.map((a) => (
            <div key={a.id} className="flex items-center gap-2 font-sans text-[11px]">
              <span className="font-semibold text-text-muted w-20 truncate flex-shrink-0">{a.source}</span>
              <span className="text-text-secondary truncate flex-1">{a.title}</span>
              <span className="font-data text-[9px] text-text-faint flex-shrink-0">{timeAgo(a.published_at)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderExpandedCard(s: TrendSignal) {
    const thesis = findRelatedThesis(s);
    const { headline, subline } = buildSignalTitle(s);
    const sparkData = generateSparkData(s);
    const sparkColor = s.strength_score >= 0.6 ? "var(--signal-dn)" : s.strength_score >= 0.4 ? "var(--signal-warn)" : "var(--gold)";
    const isHovered = hoveredId === s.id;
    const isOpen = expandedId === s.id;
    return (
      <div
        className={cn("border-l-[3px] bg-white border border-border-base rounded-xl p-4 cursor-pointer transition-all hover:border-border-hover", strengthBorder(s.strength_score))}
        onClick={() => handleSignalClick(s)}
        onMouseEnter={() => handleSignalHover(s)}
        onMouseLeave={() => setHoveredId(null)}
      >
        {renderBadgeRow(s)}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h4 className="font-display text-[15px] font-semibold text-espresso leading-snug">{headline}</h4>
            <p className="font-data text-[10px] text-text-muted mt-0.5">{subline}</p>
          </div>
          {sparkData.length > 1 && <MiniSparkline data={sparkData} color={sparkColor} />}
        </div>

        {/* Hover preview */}
        {isHovered && !isOpen && (
          <p className="font-sans text-[11px] text-text-secondary leading-snug mt-2 line-clamp-2">
            {buildOverview(s)}
          </p>
        )}

        <div className="flex items-center gap-4 mt-2 mb-1">
          {renderCompanies(s)}
          {renderThemes(s)}
        </div>

        <div className={cn("overflow-hidden transition-all duration-200", isOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0")}>
          {/* Overview text */}
          <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1 mb-2">
            {buildOverview(s)}
          </p>
          {renderSourceArticles(s)}
          <div className="flex items-center gap-3 mt-3">
            <a
              href={`/live-feed?q=${encodeURIComponent(s.label)}`}
              onClick={(e) => e.stopPropagation()}
              className="font-sans text-[11px] font-semibold text-text-secondary hover:text-text-primary transition-colors"
            >
              View all {s.article_count} articles {"\u2192"}
            </a>
            {thesis && (
              <a
                href={`/thesis-board?thesis=${thesis.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-sans text-[11px] font-semibold text-gold hover:underline"
              >
                Related thesis: {thesis.title} {"\u2192"}
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderMidCard(s: TrendSignal) {
    const thesis = findRelatedThesis(s);
    const { headline, subline } = buildSignalTitle(s);
    const sparkData = generateSparkData(s);
    const sparkColor = s.strength_score >= 0.6 ? "var(--signal-dn)" : s.strength_score >= 0.4 ? "var(--signal-warn)" : "var(--gold)";
    const isHovered = hoveredId === s.id;
    const isOpen = expandedId === s.id;
    return (
      <div
        className={cn("border-l-[3px] bg-white border border-border-base rounded-xl p-3.5 cursor-pointer transition-all hover:border-border-hover", strengthBorder(s.strength_score))}
        onClick={() => handleSignalClick(s)}
        onMouseEnter={() => handleSignalHover(s)}
        onMouseLeave={() => setHoveredId(null)}
      >
        {renderBadgeRow(s)}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h4 className="font-display text-[14px] font-semibold text-espresso leading-snug">{headline}</h4>
            <p className="font-data text-[10px] text-text-muted mt-0.5">{subline}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {sparkData.length > 1 && <MiniSparkline data={sparkData} color={sparkColor} />}
            {s.top_companies.slice(0, 2).map((c) => (
              <span
                key={c}
                className={cn(
                  "font-data text-[9px] uppercase",
                  isWatchlistTicker(c) ? "text-gold font-semibold" : "text-text-faint",
                )}
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Hover preview */}
        {isHovered && !isOpen && (
          <p className="font-sans text-[11px] text-text-secondary leading-snug mt-1.5 line-clamp-2">
            {buildOverview(s)}
          </p>
        )}

        <div className={cn("overflow-hidden transition-all duration-200", isOpen ? "max-h-[400px] opacity-100 mt-2.5" : "max-h-0 opacity-0")}>
          <p className="font-sans text-[11px] text-text-secondary leading-snug mb-2">
            {buildOverview(s)}
          </p>
          {renderSourceArticles(s)}
          <div className="flex items-center gap-3 pt-2 border-t border-border-base mt-2">
            <a
              href={`/live-feed?q=${encodeURIComponent(s.label)}`}
              onClick={(e) => e.stopPropagation()}
              className="font-sans text-[11px] font-semibold text-text-secondary hover:text-text-primary transition-colors"
            >
              View {s.article_count} source articles {"\u2192"}
            </a>
            {thesis && (
              <a
                href={`/thesis-board?thesis=${thesis.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-sans text-[11px] font-semibold text-gold hover:underline"
              >
                Related thesis {"\u2192"}
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderCompactRow(s: TrendSignal) {
    return (
      <div
        className="border-l-[3px] border-l-border-base bg-white border border-border-base rounded-lg px-3 py-2 cursor-pointer transition-all hover:border-border-hover flex items-center gap-3"
        onClick={() => handleSignalClick(s)}
      >
        {s.cluster_type === "emerging" && (
          <span className="font-data text-[8px] font-bold uppercase text-signal-up bg-signal-up/10 border border-signal-up/20 rounded px-1 py-0.5 flex-shrink-0">new</span>
        )}
        <span className="font-sans text-[12px] text-text-primary truncate flex-1">{s.label}</span>
        <span className="font-data text-[9px] text-text-faint flex-shrink-0 whitespace-nowrap">
          {s.article_count} art {"\u00B7"} {s.source_count} src
        </span>
      </div>
    );
  }

  function renderSignal(s: TrendSignal) {
    const tier = cardTier(s);
    if (tier === "expanded") return renderExpandedCard(s);
    if (tier === "mid") return renderMidCard(s);
    return renderCompactRow(s);
  }

  return (
    <AppShell pageTitle="Trends" mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
      {/* Preview nudge banner */}
      {isSignedOut && (
        <div className="px-6 py-3 border-b border-gold/20 flex items-center justify-between bg-gold-muted">
          <p className="font-sans text-[12px] text-text-secondary">
            Previewing trend signals — sign in to unlock all {filtered.length} signals and filters.
          </p>
          <button
            type="button"
            onClick={() => setShowSignIn(true)}
            className="flex-shrink-0 ml-4 font-sans text-[12px] font-semibold text-espresso cursor-pointer"
          >
            Sign in free {"\u2192"}
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
        <div className="sticky top-0 z-10 bg-parchment border-b border-border-base px-6 py-3 space-y-2">
          {/* Row 1: Industry verticals */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="font-data text-[9px] uppercase tracking-widest text-gold font-bold mr-1 flex-shrink-0">SECTOR</span>
            {INDUSTRY_VERTICALS.map((v) => (
              <Pill
                key={v}
                active={selectedVerticals.has(v)}
                onClick={() => setSelectedVerticals((prev) => {
                  const next = new Set(prev);
                  next.has(v) ? next.delete(v) : next.add(v);
                  return next;
                })}
              >
                {v}
              </Pill>
            ))}
            {profileSectors.length > 0 && (
              <Pill
                active={showFilter === "my-sectors"}
                onClick={() => setShowFilter(showFilter === "my-sectors" ? "all" : "my-sectors")}
                variant="gold"
              >
                My sectors {"\u2726"}
              </Pill>
            )}
          </div>

          {/* Row 2: Activity types */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="font-data text-[9px] uppercase tracking-widest text-gold font-bold mr-1 flex-shrink-0">ACTIVITY</span>
            {ACTIVITY_TYPES.map((a) => (
              <Pill
                key={a}
                active={selectedActivities.has(a)}
                onClick={() => setSelectedActivities((prev) => {
                  const next = new Set(prev);
                  next.has(a) ? next.delete(a) : next.add(a);
                  return next;
                })}
              >
                {a}
              </Pill>
            ))}
          </div>

          {/* Row 3: Severity + show filters */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-data text-[9px] uppercase tracking-widest text-gold font-bold mr-1">SEVERITY</span>
            {(["all", "low", "medium", "high", "critical"] as AnomalyFilter[]).map((level) => (
              <Pill key={level} active={anomalyFilter === level} onClick={() => setAnomalyFilter(level)}>
                {level}
              </Pill>
            ))}
            <span className="border-l border-border-base h-4 mx-1" />
            {([
              ["all", "All"],
              ["emerging", "Emerging"],
              ["cross-source", "Cross-source"],
              ["underreported", "Underreported"],
            ] as [ShowFilter, string][]).map(([key, label]) => (
              <Pill key={key} active={showFilter === key} onClick={() => setShowFilter(showFilter === key ? "all" : key)}>
                {label}
              </Pill>
            ))}
            <span className="ml-auto font-data text-[11px] text-text-muted">
              {filtered.length} signals
            </span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-6 py-5">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-parchment-mid animate-pulse" />
            ))}
          </div>
        ) : allSignals.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={32} />}
            title="No trend clusters yet"
            description="Trend signals will appear after the pipeline runs and identifies recurring narratives."
          />
        ) : (
          <>
            {/* Header */}
            <div className="mb-5">
              <p className="font-data text-[9px] uppercase tracking-widest text-gold font-bold mb-1">
                Signal Radar
              </p>
              <p className="font-sans text-[13px] text-text-secondary leading-relaxed">
                Signalera scanned <span className="font-data font-semibold text-text-primary">{totalArticles.toLocaleString()}</span> articles
                and detected <span className="font-semibold text-signal-up">{newTodayCount} new signals</span> today
                across <span className="font-data font-semibold text-text-primary">{allSignals.length}</span> active clusters
                {" \u00B7 "}<span className="font-data">{crossSourceCount}</span> cross-source verified
                {underreportedCount > 0 && (
                  <>{" \u00B7 "}<span className="font-semibold" style={{ color: "var(--signal-ai)" }}>{underreportedCount} underreported</span></>
                )}
              </p>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={<TrendingUp size={32} />}
                title="No signals match your filters"
                description="Try broadening your filters."
              />
            ) : (
              <div className="space-y-6">
                {timelineGroups.map((group) => {
                  const isExpanded = expandedGroups.has(group.label);
                  const visibleSignals = group.signals.length > MAX_VISIBLE && !isExpanded
                    ? group.signals.slice(0, MAX_VISIBLE)
                    : group.signals;
                  const remaining = group.signals.length - MAX_VISIBLE;

                  return (
                    <div key={group.label}>
                      {/* Group header */}
                      <div className="flex items-center gap-2.5 mb-3">
                        <p className="font-sans text-[13px] font-semibold text-text-primary">{group.label}</p>
                        {group.dateLabel && <span className="font-sans text-[11px] text-text-secondary">{group.dateLabel}</span>}
                        <div className="flex-1 h-px bg-border-base" />
                        <span className="font-sans text-[11px] text-text-secondary font-data">{group.signals.length} signals</span>
                      </div>

                      {/* Signal cards */}
                      <div className="space-y-2">
                        {visibleSignals.map((s) => (
                          <div key={s.id}>
                            {renderSignal(s)}
                          </div>
                        ))}
                      </div>

                      {/* Show more */}
                      {remaining > 0 && !isExpanded && (
                        <button
                          type="button"
                          onClick={() => setExpandedGroups((prev) => new Set([...prev, group.label]))}
                          className="mt-2 flex items-center gap-1 font-sans text-[11px] font-semibold text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
                        >
                          <ChevronDown size={12} />
                          Show {remaining} more {"\u2192"}
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Gate row — signed-out users see first 3 signals then this */}
                {isSignedOut && (
                  <div className="relative mt-2">
                    <div
                      className="pointer-events-none absolute -top-16 left-0 right-0 h-16"
                      style={{ background: "linear-gradient(to bottom, transparent, var(--parchment))" }}
                    />
                    <div
                      className="flex items-center justify-between px-4 py-3 rounded-xl border border-gold/30 bg-gold-muted"
                    >
                      <div className="flex items-center gap-2">
                        <Lock size={14} className="text-gold" />
                        <span className="font-sans text-[13px] font-semibold text-espresso">
                          Sign in to see all {filtered.length} signals
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowSignIn(true)}
                        className="font-sans text-[12px] font-semibold text-gold cursor-pointer"
                      >
                        Sign in {"\u2192"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <SignInModal
        isOpen={showSignIn}
        onClose={() => setShowSignIn(false)}
        headline="Sign in to unlock signals"
        message="Create a free account to see all signals, generate memos, and track theses."
      />
    </AppShell>
  );
}
