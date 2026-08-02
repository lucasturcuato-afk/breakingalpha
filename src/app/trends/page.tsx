"use client";

import { useState, useMemo, useEffect } from "react";
import { AppShell } from "@/components/shell";
import { EmptyState } from "@/components/ui/empty-state";
import { neutralizeThesisTitle } from "@/lib/track-record-live-score";
import { TrendingUp, Lock, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@supabase/ssr";
import { useUserProfile } from "@/hooks/useUserProfile";
import { trackClientEvent } from "@/lib/track-event";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { MemoModal } from "@/components/memo/MemoModal";
import { useLiveMood } from "@/hooks/useLiveMood";
import type { AnomalyLevel } from "@/components/trends/anomaly-badge";

// ── Filter constants (Noah's original 3-row layout) ──

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

// Map filter labels → keywords that appear in top_themes / top_sectors
const ACTIVITY_TO_KEYWORDS: Record<string, string[]> = {
  "Mergers & Acquisitions": ["m&a", "merger", "acquisition", "takeover", "buyout"],
  "Private Equity": ["pe", "private equity", "buyout", "lbo"],
  "Venture Capital": ["vc", "venture", "seed", "series"],
  "IPO & Capital Markets": ["ipo", "capital markets", "listing", "offering", "spac", "public markets"],
  "Earnings & Results": ["earnings", "revenue", "profit", "quarterly", "results"],
  "Macro & Policy": ["macro", "policy", "fed", "rates", "inflation", "gdp"],
  "Geopolitics": ["geopolitics", "geopolitical", "sanctions", "trade war", "tariff"],
  "Regulation & Legal": ["regulation", "regulatory", "legal", "compliance", "sec", "antitrust"],
  "Fundraising": ["fundraising", "fund", "capital raise"],
  "Crypto & Digital Assets": ["crypto", "bitcoin", "blockchain", "digital asset", "defi", "fintech"],
  "Leadership & Operations": ["leadership", "ceo", "management", "operations", "restructuring"],
};

// Map filter labels → keywords for sector matching
const VERTICAL_TO_KEYWORDS: Record<string, string[]> = {
  "Technology": ["technology", "tech"],
  "Healthcare & Biotech": ["healthcare", "biotech", "pharma"],
  "Energy & Oil/Gas": ["energy", "oil/gas", "oil", "climate"],
  "Financial Services": ["financial services", "fintech"],
  "Consumer & Retail": ["consumer", "retail"],
  "Industrials & Manufacturing": ["industrials", "manufacturing"],
  "Aerospace & Defense": ["aerospace", "defense"],
  "Real Estate": ["real estate", "reits"],
  "Media & Telecom": ["media", "telecom"],
  "Materials & Mining": ["materials", "mining"],
  "Agriculture": ["agriculture", "agri"],
};

type AnomalyFilter = "all" | AnomalyLevel;

// ── Types ──

interface TrendSignal {
  id: string;
  label: string;
  headline: string | null;
  tagline: string | null;
  cluster_type: string;
  article_count: number;
  source_count: number;
  strength_score: number;
  novelty_score: number;
  cross_source_flag: boolean;
  underrepresented_flag: boolean;
  top_companies: string[];
  top_themes: string[];
  top_sectors: string[];
  representative_article_ids: string[];
  lookback_run_count: number;
  created_at: string;
}

interface SourceArticle {
  id: string;
  title: string;
  source: string;
  published_at: string;
  url: string | null;
  content: string | null;
  summary: string | null;
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

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function strengthToAnomaly(score: number): AnomalyLevel {
  if (score >= 0.8) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

function getDisplayTitle(s: TrendSignal): string {
  if (s.headline) return s.headline;
  // Better fallback: use themes + companies to make a readable title
  const themes = s.top_themes.filter(t => t.length > 1);
  const companies = s.top_companies.slice(0, 2).map(c =>
    c.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  );
  if (themes.length > 0 && companies.length > 0) {
    return `${themes[0].charAt(0).toUpperCase() + themes[0].slice(1)} Activity Around ${companies[0]}`;
  }
  if (themes.length > 0) return themes[0].charAt(0).toUpperCase() + themes[0].slice(1) + " Trend Detected";
  return s.label.replace(/:\s*/g, " \u2014 ");
}



// Normalize a string token: lowercase, trim, strip punctuation, collapse whitespace
function normToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

// Generate a set of identity signatures for a trend signal.
// A signal's "fingerprint" is: top 2 companies + top 2 themes + top sector.
// Two signals are duplicates if they share enough fingerprint tokens.
function signalFingerprint(s: TrendSignal): {
  companies: Set<string>;
  themes: Set<string>;
  sector: string;
} {
  const companies = new Set(
    s.top_companies.slice(0, 3).map(normToken).filter(Boolean)
  );
  const themes = new Set(
    s.top_themes.slice(0, 3).map(normToken).filter(Boolean)
  );
  const sector = normToken(s.top_sectors[0] || "");
  return { companies, themes, sector };
}

// Decide whether two signals are duplicates.
// Rule: same sector AND (≥1 shared company OR ≥1 shared theme).
// If a signal has no companies, fall back to: same sector + ≥1 shared theme.
// If neither has a sector, fall back to label match.
function areSignalsDuplicates(a: TrendSignal, b: TrendSignal): boolean {
  // PRIORITY RULE: identical normalized labels = always duplicate.
  // Run this FIRST so it catches the case where two signals have the same
  // headline but different supporting companies (e.g., "AI M&A Heats Up:
  // Tech Sector Reshaping" appearing twice with different cap-tables).
  const labelA = normToken(a.label);
  const labelB = normToken(b.label);
  if (labelA && labelB && labelA === labelB) return true;

  // Also: same headline (case-insensitive, stripped of "&" / commas) = duplicate.
  // Some labels differ only in punctuation rendering.
  const stripPunct = (s: string) =>
    s.toLowerCase().replace(/[&,.;:!?\-—–"']/g, "").replace(/\s+/g, " ").trim();
  if (stripPunct(a.label) === stripPunct(b.label)) return true;

  const fa = signalFingerprint(a);
  const fb = signalFingerprint(b);

  // Sector mismatch → different signals (e.g., AI in tech vs AI in biotech)
  if (fa.sector && fb.sector && fa.sector !== fb.sector) {
    const aShort = fa.sector.split(" ")[0];
    const bShort = fb.sector.split(" ")[0];
    if (aShort !== bShort) return false;
  }

  // Count overlap in companies
  let companyOverlap = 0;
  for (const c of fa.companies) {
    if (fb.companies.has(c)) companyOverlap++;
  }

  // Count overlap in themes
  let themeOverlap = 0;
  const totalThemes = Math.max(fa.themes.size, fb.themes.size, 1);
  for (const t of fa.themes) {
    if (fb.themes.has(t)) themeOverlap++;
  }
  const themeRatio = themeOverlap / totalThemes;

  // Rule 1: shared company AND shared theme = strong duplicate signal
  if (companyOverlap >= 1 && themeOverlap >= 1) return true;

  // Rule 2: 2+ shared companies (very same set of players) = duplicate
  if (companyOverlap >= 2) return true;

  // Rule 3: no companies on either side, but 2+ shared themes = thematic duplicate
  if (fa.companies.size === 0 && fb.companies.size === 0 && themeOverlap >= 2) {
    return true;
  }

  // Rule 4 (NEW): same sector AND high theme overlap (≥70%) = thematic duplicate.
  // Catches cases like "AI Investment & Regulatory Scrutiny Intensifies"
  // vs "AI Investment Surges Amidst Regulatory Scrutiny" — same sector,
  // same theme cluster, different framings of the same trend.
  if (fa.sector && fb.sector && themeRatio >= 0.7 && themeOverlap >= 2) {
    return true;
  }

  // Rule 5 (NEW): same sector AND first theme matches AND headline shares
  // ≥3 significant words = duplicate. Catches near-identical headlines that
  // wouldn't be caught by stripPunct above (e.g., word-order swaps).
  if (fa.sector && fb.sector) {
    const aFirstTheme = [...fa.themes][0];
    const bFirstTheme = [...fb.themes][0];
    if (aFirstTheme && bFirstTheme && aFirstTheme === bFirstTheme) {
      const aWords = new Set(
        normToken(a.label).split(" ").filter((w) => w.length >= 4)
      );
      const bWords = new Set(
        normToken(b.label).split(" ").filter((w) => w.length >= 4)
      );
      let wordOverlap = 0;
      for (const w of aWords) if (bWords.has(w)) wordOverlap++;
      if (wordOverlap >= 3) return true;
    }
  }

  return false;
}

// Pick the "winner" between two duplicate signals.
// Priority: higher strength_score → more sources → more recent.
function pickStrongerSignal(a: TrendSignal, b: TrendSignal): TrendSignal {
  if (a.strength_score !== b.strength_score) {
    return a.strength_score > b.strength_score ? a : b;
  }
  if (a.source_count !== b.source_count) {
    return a.source_count > b.source_count ? a : b;
  }
  return new Date(a.created_at) > new Date(b.created_at) ? a : b;
}

function deduplicateSignals(signals: TrendSignal[]): TrendSignal[] {
  // Sort by strength descending so winners get processed first
  const sorted = [...signals].sort((a, b) => b.strength_score - a.strength_score);
  const kept: TrendSignal[] = [];

  for (const candidate of sorted) {
    let merged = false;
    for (let i = 0; i < kept.length; i++) {
      if (areSignalsDuplicates(candidate, kept[i])) {
        // Found a duplicate — replace with whichever is stronger
        kept[i] = pickStrongerSignal(kept[i], candidate);
        merged = true;
        break;
      }
    }
    if (!merged) {
      kept.push(candidate);
    }
  }

  // Final sort by creation date, newest first (matches existing behavior)
  return kept.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

function capitalizeCompany(c: string): string {
  return c.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

const COMPANY_TO_TICKER: Record<string, string> = {
  "apple": "AAPL", "microsoft": "MSFT", "amazon": "AMZN", "google": "GOOGL",
  "alphabet": "GOOGL", "meta": "META", "facebook": "META", "nvidia": "NVDA",
  "tesla": "TSLA", "netflix": "NFLX", "anthropic": "ANTHROPIC", "openai": "OPENAI",
  "spacex": "SPACEX", "uber": "UBER", "salesforce": "CRM", "adobe": "ADBE",
  "intel": "INTC", "amd": "AMD", "qualcomm": "QCOM", "broadcom": "AVGO",
  "oracle": "ORCL", "ibm": "IBM", "cisco": "CSCO", "paypal": "PYPL",
  "shopify": "SHOP", "snap": "SNAP", "twitter": "X", "palantir": "PLTR",
  "coinbase": "COIN", "robinhood": "HOOD", "stripe": "STRIPE",
  "jpmorgan": "JPM", "goldman sachs": "GS", "morgan stanley": "MS",
  "bank of america": "BAC", "citigroup": "C", "wells fargo": "WFC",
  "boeing": "BA", "lockheed": "LMT", "raytheon": "RTX", "northrop": "NOC",
  "lockheed martin": "LMT", "general dynamics": "GD", "l3harris": "LHX",
  "exxon": "XOM", "chevron": "CVX", "conocophillips": "COP",
  "applied materials": "AMAT", "lam research": "LRCX", "kla": "KLAC",
  "halliburton": "HAL", "cursor": "CURSOR", "blue origin": "BLUE_ORIGIN",
};

function isCompanyWatched(companyName: string, watchlistTickers: string[]): boolean {
  const lower = companyName.toLowerCase().trim();
  const upperTickers = watchlistTickers.map(t => t.toUpperCase());

  if (upperTickers.includes(lower.toUpperCase())) return true;

  const mappedTicker = COMPANY_TO_TICKER[lower];
  if (mappedTicker && upperTickers.includes(mappedTicker)) return true;

  for (const ticker of upperTickers) {
    if (lower.includes(ticker.toLowerCase()) || ticker.toLowerCase().includes(lower)) return true;
  }

  const words = lower.split(/\s+/);
  for (const word of words) {
    if (word.length >= 3 && upperTickers.includes(word.toUpperCase())) return true;
    const wordMapped = COMPANY_TO_TICKER[word];
    if (wordMapped && upperTickers.includes(wordMapped)) return true;
  }

  return false;
}

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

const MAX_VISIBLE = 5;

// ── Component ──

export default function TrendsPage() {
  const { mood, moodHeadline, moodDetails } = useLiveMood();
  const { profile, refetch: refetchProfile } = useUserProfile();

  // ── State ──
  const [isSignedOut, setIsSignedOut] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [allSignals, setAllSignals] = useState<TrendSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVerticals, setSelectedVerticals] = useState<Set<string>>(new Set());
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set());
  const [anomalyFilter, setAnomalyFilter] = useState<AnomalyFilter>("all");
  const [totalArticleCount, setTotalArticleCount] = useState<number | null>(null);
  const [mySectorsActive, setMySectorsActive] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [articleCache, setArticleCache] = useState<Record<string, SourceArticle[]>>({});
  const [thesesForMatch, setThesesForMatch] = useState<RelatedThesis[]>([]);
  const [modalSignal, setModalSignal] = useState<TrendSignal | null>(null);
  const [memoSignal, setMemoSignal] = useState<TrendSignal | null>(null);
  const [addingTicker, setAddingTicker] = useState<string | null>(null);

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

  function isRelevantToProfile(s: TrendSignal): boolean {
    if (!profileSectors.length && !watchlistUpper.length) return true;
    return boostScore(s) > 0;
  }

  function hasWatchlistMatch(s: TrendSignal): boolean {
    if (!watchlistUpper.length) return false;
    const text = `${s.label} ${s.top_companies.join(" ")}`.toUpperCase();
    return watchlistUpper.some((t) => text.includes(t));
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
        const { data, error } = await supabase
          .from("trend_clusters")
          .select("id, label, headline, tagline, cluster_type, article_count, source_count, strength_score, novelty_score, cross_source_flag, underrepresented_flag, top_companies, top_themes, top_sectors, representative_article_ids, lookback_run_count, created_at")
          .gte("article_count", 3)
          .gte("source_count", 2)
          .order("created_at", { ascending: false })
          .limit(500);

        if (error) {
          console.error("[trends] fetch error:", error.message);
        } else if (data) {
          const mapped: TrendSignal[] = data.map((row) => ({
            id: row.id,
            label: row.label || "Untitled Signal",
            headline: row.headline ?? null,
            tagline: row.tagline ?? null,
            cluster_type: row.cluster_type || "",
            article_count: row.article_count ?? 0,
            source_count: row.source_count ?? 0,
            strength_score: row.strength_score ?? 0,
            novelty_score: row.novelty_score ?? 0,
            cross_source_flag: row.cross_source_flag ?? false,
            underrepresented_flag: row.underrepresented_flag ?? false,
            top_companies: safeArray(row.top_companies),
            top_themes: safeArray(row.top_themes),
            top_sectors: safeArray(row.top_sectors),
            representative_article_ids: safeArray(row.representative_article_ids),
            lookback_run_count: row.lookback_run_count ?? 0,
            created_at: row.created_at,
          }));
          setAllSignals(deduplicateSignals(mapped));
        }

        // Fetch real total article count from DB
        const { count } = await supabase
          .from("articles")
          .select("id", { count: "exact", head: true });
        if (count !== null) setTotalArticleCount(count);
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
    supabase.from("theses").select("id, title, sector")
      .order("generated_at", { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setThesesForMatch(data); });
  }, []);

  // ── Fetch articles when modal opens ──
  useEffect(() => {
    if (!modalSignal) return;
    if (articleCache[modalSignal.id]) return;
    const supabase = getSupabase();
    const ids = modalSignal.representative_article_ids.slice(0, 10);
    if (ids.length === 0) return;
    supabase.from("articles").select("id, title, source, published_at, url, content, summary").in("id", ids)
      .then(({ data }) => {
        if (data) setArticleCache((prev) => ({ ...prev, [modalSignal.id]: data }));
      });
  }, [modalSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Related thesis (sector + company overlap, then sector-only) ──
  function findRelatedThesis(signal: TrendSignal): RelatedThesis | null {
    const signalSectors = signal.top_sectors.map((s) => s.toLowerCase());
    const signalCompanies = signal.top_companies.map((c) => c.toLowerCase());

    const sectorAndCompany = thesesForMatch.find((t) => {
      const tSector = t.sector.toLowerCase();
      const tTitle = t.title.toLowerCase();
      const sectorMatch = signalSectors.some((ss) => tSector.includes(ss) || ss.includes(tSector));
      const companyMatch = signalCompanies.some((c) => tTitle.includes(c));
      return sectorMatch && companyMatch;
    });
    if (sectorAndCompany) return sectorAndCompany;

    return thesesForMatch.find((t) => {
      const tSector = t.sector.toLowerCase();
      return signalSectors.some((ss) => tSector.includes(ss) || ss.includes(tSector));
    }) ?? null;
  }

  // ── Derived stats ──
  const totalArticles = totalArticleCount ?? allSignals.reduce((sum, s) => sum + s.article_count, 0);
  const newTodayCount = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return allSignals.filter((s) => new Date(s.created_at) >= t).length;
  }, [allSignals]);
  const crossSourceCount = useMemo(() => allSignals.filter((s) => s.cross_source_flag).length, [allSignals]);
  const underreportedCount = useMemo(() => allSignals.filter((s) => s.underrepresented_flag).length, [allSignals]);
  const newInMySectors = useMemo(() => {
    if (profileSectors.length === 0) return 0;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return allSignals.filter((s) => {
      if (new Date(s.created_at) < t) return false;
      return s.top_sectors.some((ts) =>
        profileSectors.some((ps) => ts.toLowerCase().includes(ps) || ps.includes(ts.toLowerCase())),
      );
    }).length;
  }, [allSignals, profileSectors]);

  // ── Filtering ──
  const filtered = useMemo(() => {
    let result = allSignals;

    if (selectedVerticals.size > 0) {
      result = result.filter((s) => {
        const sectorText = s.top_sectors.map((t) => t.toLowerCase()).join(" ");
        return Array.from(selectedVerticals).some((v) => {
          const keywords = VERTICAL_TO_KEYWORDS[v] ?? [v.toLowerCase()];
          return keywords.some((kw) => sectorText.includes(kw));
        });
      });
    }

    if (selectedActivities.size > 0) {
      result = result.filter((s) => {
        const allText = [...s.top_themes, ...s.top_sectors].map((t) => t.toLowerCase()).join(" ");
        return Array.from(selectedActivities).some((a) => {
          const keywords = ACTIVITY_TO_KEYWORDS[a] ?? [a.toLowerCase()];
          return keywords.some((kw) => allText.includes(kw));
        });
      });
    }

    if (anomalyFilter !== "all") {
      result = result.filter((s) => strengthToAnomaly(s.strength_score) === anomalyFilter);
    }

    if (mySectorsActive && profileSectors.length > 0) {
      result = result.filter((s) =>
        s.top_sectors.some((ts) =>
          profileSectors.some((ps) => ts.toLowerCase().includes(ps) || ps.includes(ts.toLowerCase())),
        ),
      );
    }

    if (profileSectors.length || watchlistUpper.length) {
      result = [...result].sort((a, b) => boostScore(b) - boostScore(a));
    }

    return result;
  }, [allSignals, selectedVerticals, selectedActivities, anomalyFilter, mySectorsActive, profileSectors, watchlistUpper]); // eslint-disable-line react-hooks/exhaustive-deps

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
          "px-2.5 py-1 rounded-lg font-sans text-[10px] font-bold cursor-pointer transition-colors border whitespace-nowrap",
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

  // ── Watchlist add via ticker lookup ──
  async function handleAddToWatchlist(companyName: string) {
    try {
      setAddingTicker(companyName);
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let ticker = COMPANY_TO_TICKER[companyName.toLowerCase().trim()];

      if (!ticker) {
        try {
          const searchRes = await fetch(`/api/finnhub-search?q=${encodeURIComponent(companyName)}`);
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            const results = searchData.results ?? searchData.result ?? [];
            if (results.length > 0) {
              ticker = results[0].symbol || results[0].ticker;
            }
          }
        } catch {
          // Search failed, use company name as identifier
        }
      }

      const identifier = ticker || companyName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);

      const { data: existing } = await supabase
        .from("watchlist")
        .select("id")
        .eq("user_id", user.id)
        .eq("identifier", identifier)
        .maybeSingle();

      if (existing) return;

      await supabase.from("watchlist").insert({
        user_id: user.id,
        identifier: identifier,
        display_name: companyName,
        added_at: new Date().toISOString(),
      });

      trackClientEvent("watchlist_added", { ticker: identifier, source: "trends_modal", company: companyName });
      refetchProfile();
    } catch (err) {
      console.error("[trends] watchlist add failed:", err);
    } finally {
      setAddingTicker(null);
    }
  }

  // ── Card click → open modal ──
  function handleCardClick(signal: TrendSignal) {
    console.log("[trends] card clicked, signal:", signal.id, signal.headline || signal.label);
    setModalSignal(signal);
    trackClientEvent("pattern_clicked", {
      signal_id: signal.id,
      sector: signal.top_sectors[0] ?? null,
    });
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
            <span className="font-sans text-[9px] text-text-muted font-bold mr-1 flex-shrink-0">Sector</span>
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
          </div>

          {/* Row 2: Activity types */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="font-sans text-[9px] text-text-muted font-bold mr-1 flex-shrink-0">Activity</span>
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

          {/* Row 3: Severity + show filters + my sectors */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-sans text-[9px] text-text-muted font-bold mr-1">Severity</span>
            {(["all", "low", "medium", "high", "critical"] as AnomalyFilter[]).map((level) => (
              <Pill key={level} active={anomalyFilter === level} onClick={() => setAnomalyFilter(level)}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </Pill>
            ))}
            {profileSectors.length > 0 && (
              <>
                <span className="border-l border-border-base h-4 mx-1" />
                <Pill
                  active={mySectorsActive}
                  onClick={() => setMySectorsActive((prev) => !prev)}
                  variant="gold"
                >
                  My sectors {"\u2726"}
                </Pill>
              </>
            )}
            <span className="ml-auto font-sans text-[11px] text-text-muted">
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
            {/* Signal Radar Header */}
            <div className="mb-5">
              <p className="font-sans text-[9px] text-text-muted font-bold mb-1">
                Signal radar
              </p>
              <p className="font-sans text-[13px] text-text-secondary leading-relaxed">
                Signalera scanned{" "}
                <span className="font-sans font-semibold text-text-primary">{totalArticles.toLocaleString()}</span>{" "}
                articles and detected{" "}
                <span className="font-semibold text-signal-up">
                  {profileSectors.length > 0 && newInMySectors > 0
                    ? `${newInMySectors} new signals in your sectors`
                    : `${newTodayCount} new signals`}
                </span>{" "}
                today across{" "}
                <span className="font-sans font-semibold text-text-primary">{allSignals.length}</span>{" "}
                active clusters{" \u00B7 "}
                <span className="font-sans">{crossSourceCount}</span> cross-source verified
                {underreportedCount > 0 && (
                  <>{" \u00B7 "}<span className="font-semibold text-signal-ai">{underreportedCount} underreported</span></>
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
                        <span className="font-sans text-[11px] text-text-secondary">{group.signals.length} signals</span>
                      </div>

                      {/* Signal cards — inline layout */}
                      <div className="space-y-2">
                        {visibleSignals.map((s) => {
                          const title = getDisplayTitle(s);
                          const isRelevant = isRelevantToProfile(s);
                          const watchlistMention = hasWatchlistMatch(s);
                          const companies = s.top_companies.slice(0, 3);

                          return (
                            <div
                              key={s.id}
                              onClick={() => handleCardClick(s)}
                              className={cn(
                                "bg-white border border-border-base rounded-xl p-4 cursor-pointer",
                                "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                                "hover:-translate-y-0.5 hover:border-border-hover hover:shadow-[0_2px_8px_rgba(201,146,42,0.06)]",
                                profileSectors.length > 0 && !isRelevant && "opacity-90",
                              )}
                            >
                              {/* Watchlist badge */}
                              {watchlistMention && (
                                <div className="mb-2">
                                  <span className="inline-flex items-center gap-1 font-sans text-[9px] font-semibold text-gold bg-gold-muted border border-gold/20 rounded px-1.5 py-0.5">
                                    Watching
                                  </span>
                                </div>
                              )}

                              {/* Row 1: Badges left, timestamp right */}
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {s.cluster_type === "emerging" && (
                                    <span className="font-sans text-[9px] font-bold px-2 py-0.5 rounded bg-signal-up/10 text-signal-up border border-signal-up/20">
                                      {"\u2B06"} Emerging
                                    </span>
                                  )}
                                  {s.top_sectors.slice(0, 1).map((v) => (
                                    <span
                                      key={v}
                                      className="font-sans text-[9px] font-bold px-2 py-0.5 rounded bg-signal-ai/10 text-signal-ai border border-signal-ai/20"
                                    >
                                      {v}
                                    </span>
                                  ))}
                                  {s.cross_source_flag && s.source_count >= 3 && (
                                    <span className="font-sans text-[9px] font-bold text-signal-up">
                                      {"\u2713"} {s.source_count} sources
                                    </span>
                                  )}
                                </div>
                                <span className="font-sans text-[9px] text-text-faint">{timeAgo(s.created_at)}</span>
                              </div>

                              {/* Row 2: Headline left, Companies right */}
                              <div className="flex items-start justify-between gap-4">
                                <h4 className="font-display text-[14px] font-bold text-espresso leading-snug flex-1">
                                  {title}
                                </h4>
                                {companies.length > 0 && (
                                  <div className="flex flex-wrap gap-1 justify-end flex-shrink-0 max-w-[200px]">
                                    {companies.map((c, i) => {
                                      const name = capitalizeCompany(c);
                                      const isWatchlist = watchlistUpper.includes(c.toUpperCase());
                                      return (
                                        <span
                                          key={i}
                                          className={cn(
                                            "font-sans text-[9px] px-1.5 py-0.5 rounded",
                                            isWatchlist
                                              ? "bg-gold-muted text-gold-dark border border-gold/30 font-semibold"
                                              : "text-text-muted",
                                          )}
                                        >
                                          {name.toUpperCase()}{isWatchlist ? " \u2726" : ""}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
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
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-gold/30 bg-gold-muted">
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

      {/* ── Signal Detail Modal ── */}
      {modalSignal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/40"
          onClick={() => setModalSignal(null)}
        >
          <div
            className="bg-cream rounded-2xl border border-border-base shadow-lg max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="px-6 pt-6 pb-4 border-b border-border-base">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {modalSignal.cluster_type === "emerging" && (
                    <span className="font-sans text-[9px] font-bold px-2 py-0.5 rounded bg-signal-up/10 text-signal-up border border-signal-up/20">
                      {"\u2B06"} Emerging
                    </span>
                  )}
                  {modalSignal.cross_source_flag && (
                    <span className="font-sans text-[9px] font-bold px-2 py-0.5 rounded bg-signal-up/10 text-signal-up border border-signal-up/20">
                      {"\u2713"} {modalSignal.source_count} sources verified
                    </span>
                  )}
                  {modalSignal.underrepresented_flag && (
                    <span className="font-sans text-[9px] font-bold px-2 py-0.5 rounded bg-signal-ai/10 text-signal-ai border border-signal-ai/20">
                      {"\u25C7"} Underreported
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setModalSignal(null)}
                  className="text-text-muted hover:text-text-primary transition-colors cursor-pointer p-1"
                >
                  {"\u2715"}
                </button>
              </div>

              <h2 className="font-display text-[20px] font-bold text-espresso leading-snug">
                {getDisplayTitle(modalSignal)}
              </h2>
              {modalSignal.tagline && modalSignal.tagline.length > 0 && (
                <p className="font-sans text-[13px] text-text-secondary mt-2 leading-relaxed italic">
                  {modalSignal.tagline}
                </p>
              )}
            </div>

            {/* Modal body */}
            <div className="px-6 py-4 space-y-5">
              {/* Evidence stats */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-parchment rounded-lg p-3">
                  <p className="font-sans text-[9px] text-text-muted">Articles</p>
                  <p className="font-sans text-[18px] font-semibold text-espresso mt-1">{modalSignal.article_count}</p>
                </div>
                <div className="bg-parchment rounded-lg p-3">
                  <p className="font-sans text-[9px] text-text-muted">Sources</p>
                  <p className="font-sans text-[18px] font-semibold text-espresso mt-1">{modalSignal.source_count}</p>
                </div>
                <div className="bg-parchment rounded-lg p-3">
                  <p className="font-sans text-[9px] text-text-muted">First seen</p>
                  <p className="font-sans text-[14px] font-semibold text-espresso mt-1">{new Date(modalSignal.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                </div>
                <div className="bg-parchment rounded-lg p-3">
                  <p className="font-sans text-[9px] text-text-muted">Status</p>
                  <p className={cn("font-sans text-[14px] font-semibold mt-1", modalSignal.lookback_run_count <= 1 ? "text-signal-up" : "text-text-primary")}>
                    {modalSignal.lookback_run_count <= 1 ? "Emerging" : "Recurring"}
                  </p>
                </div>
              </div>

              {/* Companies */}
              {modalSignal.top_companies.length > 0 && (
                <div>
                  <p className="font-sans text-[9px] text-text-muted mb-2">Companies mentioned</p>
                  <div className="flex flex-wrap gap-1.5">
                    {modalSignal.top_companies.map((c, i) => {
                      const name = c.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
                      const isWatched = isCompanyWatched(c, profile?.watchlist_tickers ?? []);
                      const isAdding = addingTicker === c;
                      return (
                        <span
                          key={i}
                          className={cn(
                            "inline-flex items-center gap-1.5 font-sans text-[10px] px-2.5 py-1 rounded",
                            isWatched
                              ? "bg-gold-muted text-gold-dark border border-gold/30 font-semibold"
                              : "bg-parchment-mid text-text-primary border border-border-base",
                          )}
                        >
                          {name}
                          {isWatched ? (
                            <span className="text-gold text-[10px]">{"\u2726"}</span>
                          ) : (
                            <button
                              type="button"
                              disabled={isAdding}
                              onClick={(e) => { e.stopPropagation(); handleAddToWatchlist(c); }}
                              className={cn(
                                "text-[12px] font-bold ml-0.5 transition-colors cursor-pointer",
                                isAdding ? "text-text-faint" : "text-text-muted hover:text-gold",
                              )}
                              title={`Add ${name} to watchlist`}
                            >
                              {isAdding ? "..." : "+"}
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Themes */}
              {modalSignal.top_themes.length > 0 && (
                <div>
                  <p className="font-sans text-[9px] text-text-muted mb-2">Themes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {modalSignal.top_themes.map((t, i) => (
                      <span key={i} className="font-sans text-[10px] px-2 py-0.5 rounded bg-signal-ai/10 text-signal-ai">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Source articles — clickable links */}
              <div>
                <p className="font-sans text-[9px] text-text-muted mb-2">Source articles</p>
                {(articleCache[modalSignal.id] ?? []).length > 0 ? (
                  <div className="space-y-1">
                    {(articleCache[modalSignal.id] ?? []).map((a) => (
                      <a
                        key={a.id}
                        href={a.url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => { e.stopPropagation(); if (!a.url) e.preventDefault(); }}
                        className={cn(
                          "flex items-center gap-2 py-2.5 px-3 rounded-lg transition-colors",
                          a.url
                            ? "bg-parchment hover:bg-parchment-mid cursor-pointer"
                            : "bg-parchment cursor-default",
                        )}
                      >
                        <span className="font-sans text-[9px] text-text-muted w-20 flex-shrink-0 truncate">
                          {a.source || "Unknown"}
                        </span>
                        {(() => {
                          const hasFullText = a.content && a.content.length > 500;
                          const hasSummary = a.summary && a.summary.length > 0;
                          const contentType = hasFullText ? "Full text" : hasSummary ? "Summary" : "Headline only";
                          const badgeClass = hasFullText
                            ? "bg-signal-up/10 text-signal-up"
                            : hasSummary
                              ? "bg-signal-warn/10 text-signal-warn"
                              : "bg-parchment-mid text-text-muted";
                          return (
                            <span className={cn("font-sans text-[8px] px-1.5 py-0.5 rounded flex-shrink-0", badgeClass)}>
                              {contentType}
                            </span>
                          );
                        })()}
                        <span className={cn(
                          "font-sans text-[12px] truncate flex-1",
                          a.url ? "text-text-primary hover:text-gold transition-colors" : "text-text-primary",
                        )}>
                          {a.title}
                        </span>
                        <span className="font-sans text-[9px] text-text-faint flex-shrink-0">
                          {timeAgo(a.published_at)}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="font-sans text-[11px] text-text-muted italic">Loading articles...</p>
                )}
              </div>

              {/* Related thesis */}
              {(() => {
                const related = findRelatedThesis(modalSignal);
                if (!related) return null;
                return (
                  <div className="border-t border-border-base pt-4">
                    <a
                      href={`/radar/calls?thesis=${related.id}`}
                      className="inline-flex items-center gap-2 font-sans text-[12px] font-semibold text-gold hover:text-gold-dark transition-colors"
                    >
                      Related thesis: {neutralizeThesisTitle(related.title)} {"\u2192"}
                    </a>
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="border-t border-border-base pt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    trackClientEvent("memo_generated", {
                      signal_id: modalSignal.id,
                      sector: modalSignal.top_sectors[0] ?? null,
                    });
                    setMemoSignal(modalSignal);
                    setModalSignal(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gold text-cream font-sans text-[11px] font-semibold hover:bg-gold-dark transition-colors cursor-pointer"
                >
                  Generate Memo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {memoSignal && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoSignal(null)}
          title={memoSignal.headline || memoSignal.label}
          content={[
            memoSignal.headline || memoSignal.label,
            memoSignal.tagline || "",
            "",
            `Sector: ${memoSignal.top_sectors.join(", ")}`,
            `Companies: ${memoSignal.top_companies.join(", ")}`,
            `Themes: ${memoSignal.top_themes.join(", ")}`,
            `Evidence: ${memoSignal.article_count} articles from ${memoSignal.source_count} sources`,
            "",
            "Source articles:",
            ...(articleCache[memoSignal.id] ?? []).map((a) => `- ${a.title} (${a.source || "Unknown"})`),
          ].join("\n")}
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
