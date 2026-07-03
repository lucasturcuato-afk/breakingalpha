"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { AppShell } from "@/components/shell";
import { useUserProfile } from "@/hooks/useUserProfile";
import { redactRationale } from "@/lib/thesis-recommendation-guard";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  Search,
  Plus,
  ChevronDown,
  ChevronUp,
  Sparkles,
  X,
  Check,
  Star,
  Bookmark,
} from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import { withCompanyLine } from "@/lib/memo-company-line";
import { DealFlowSidebar } from "@/components/deal-flow/DealFlowSidebar";
import { useSavedDeals } from "@/hooks/useSavedDeals";
import { createBrowserClient } from "@supabase/ssr";
import { dealRelevanceScore, dealIsWatchlistMatch, getDealTypeStyle } from "@/lib/deal-utils";
import { useLiveMood } from "@/hooks/useLiveMood";

function fireEvent(event_type: string, payload: Record<string, unknown> = {}) {
  fetch("/api/user-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, payload }),
  }).catch(() => {});
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/* ── Types ── */

interface Deal {
  id: string;
  company: string;
  acquirer?: string | null;
  deal_type?: string | null;
  stage?: string | null;
  status?: string | null;
  value?: string | null;
  valuation?: string | null;
  sector?: string | null;
  notes?: string | null;
  summary?: string | null;
  thesis?: string | null;
  source?: string | null;
  source_url?: string | null;
  auto_extracted?: boolean;
  updated_at?: string;
  ingested_at?: string;
}

type StageFilter = "ALL" | "rumored" | "announced" | "under_loi" | "closed";

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  rumored: { label: "Rumored", color: "text-signal-warn bg-signal-warn/10 border-signal-warn/30" },
  announced: { label: "Announced", color: "text-signal-up bg-signal-up/10 border-signal-up/30" },
  under_loi: { label: "Under LOI", color: "text-blue-600 bg-blue-50 border-blue-200" },
  closed: { label: "Closed", color: "text-text-muted bg-parchment-mid border-border-base" },
};



function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getDealStage(deal: Deal): string {
  return deal.stage || deal.status || "rumored";
}

const DEAL_TYPES = ["M&A", "IPO", "Secondary", "Debt Raise", "Other"];
const STATUSES = ["rumored", "announced", "under_loi", "closed"];
const SECTORS = [
  "Technology M&A", "Fintech & Crypto", "Healthcare & Biotech",
  "Energy & Climate", "Private Equity", "Venture Capital",
  "Consumer & Retail", "Real Estate & REITs", "Geopolitics & Macro",
];

const ACTIVITY_TYPES = [
  "Mergers & Acquisitions",
  "Private Equity",
  "Venture Capital",
  "IPO & Capital Markets",
  "Earnings & Results",
  "Macro & Policy",
  "Geopolitics",
  "Regulation & Legal",
  "Fundraising",
  "Crypto & Digital Assets",
  "Leadership & Operations",
] as const;

const ACTIVITY_TYPE_KEYWORDS: Record<string, string[]> = {
  "Mergers & Acquisitions": ["m&a", "merger", "acquisition"],
  "Private Equity": ["private equity", "buyout"],
  "Venture Capital": ["venture capital"],
  "IPO & Capital Markets": ["ipo", "capital market"],
  "Earnings & Results": ["earnings", "results", "quarterly"],
  "Macro & Policy": ["macro", "policy"],
  "Geopolitics": ["geopolit"],
  "Regulation & Legal": ["regulat", "legal", "compliance"],
  "Fundraising": ["fundrais", "funding", "debt raise"],
  "Crypto & Digital Assets": ["crypto", "digital asset", "fintech & crypto", "blockchain"],
  "Leadership & Operations": ["leadership", "operations", "management"],
};

const INDUSTRY_VERTICALS = [
  "Technology",
  "Healthcare & Biotech",
  "Energy & Oil/Gas",
  "Financial Services",
  "Consumer & Retail",
  "Industrials & Manufacturing",
  "Aerospace & Defense",
  "Real Estate",
  "Media & Telecom",
  "Materials & Mining",
  "Agriculture",
] as const;

const INDUSTRY_VERTICAL_KEYWORDS: Record<string, string[]> = {
  "Technology": ["technology", "tech", "software", "saas", "semiconductor"],
  "Healthcare & Biotech": ["healthcare", "biotech", "pharma", "medical", "health"],
  "Energy & Oil/Gas": ["energy", "oil", "gas", "renewabl", "climate"],
  "Financial Services": ["financial", "finance", "fintech", "banking", "insurance"],
  "Consumer & Retail": ["consumer", "retail", "e-commerce", "ecommerce"],
  "Industrials & Manufacturing": ["industrial", "manufacturing"],
  "Aerospace & Defense": ["aerospace", "defense", "defence", "military"],
  "Real Estate": ["real estate", "reit", "property"],
  "Media & Telecom": ["media", "telecom", "entertainment"],
  "Materials & Mining": ["materials", "mining", "metals", "commodit"],
  "Agriculture": ["agricultur", "agri", "farm"],
};

/* ── Page ── */

export default function DealFlowPage() {
  return (
    <Suspense>
      <DealFlowContent />
    </Suspense>
  );
}

function DealFlowContent() {
  const { mood, moodHeadline, moodDetails } = useLiveMood();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStage, setFilterStage] = useState<StageFilter>("ALL");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set());

  // Memo generation
  const [memoDeal, setMemoDeal] = useState<Deal | null>(null);
  const [memoError, setMemoError] = useState("");

  // Filter state
  const [selectedActivityTypes, setSelectedActivityTypes] = useState<string[]>([]);
  const [activityMatchMode, setActivityMatchMode] = useState<"any" | "all">("any");
  const [selectedVerticals, setSelectedVerticals] = useState<string[]>([]);
  const [verticalMatchMode, setVerticalMatchMode] = useState<"any" | "all">("any");
  const [showAllTypes, setShowAllTypes] = useState(false);

  // Saved deals
  const { enrichedSavedDeals, isSaved, toggleSave } = useSavedDeals({ deals });

  // Profile-based sector pre-filter
  const { profile } = useUserProfile();
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(false);
  const [profileApplied, setProfileApplied] = useState(false);

  // Add deal form
  const [formData, setFormData] = useState({
    company: "",
    acquirer: "",
    deal_type: "",
    status: "announced",
    value: "",
    sector: "",
    notes: "",
    source: "",
  });

  /* ── Fetch deals ── */
  const fetchDeals = useCallback(async () => {
    try {
      const { data, error } = await getSupabase()
        .from("deal_flow")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) {
        console.error("Deal flow query error:", error.message);
        return;
      }
      if (data) setDeals(data);
    } catch (e) {
      console.error("Failed to fetch deals:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  // Profile fetch + sector pre-filter
  useEffect(() => {
    // Check localStorage for dismissed state
    try {
      if (localStorage.getItem("signalera_deal_filter_dismissed") === "true") {
        setProfileBannerDismissed(true);
      }
    } catch { /* no-op */ }

  }, []);

  // Pre-select sectors once profile loads (only once)
  useEffect(() => {
    if (profileApplied || !profile?.onboarding_completed || profileBannerDismissed) return;
    const sectors = profile.sectors ?? [];
    if (sectors.length === 0) return;

    // Map profile sectors to INDUSTRY_VERTICALS using keyword matching
    const matchedVerticals = INDUSTRY_VERTICALS.filter((v) => {
      const keywords = INDUSTRY_VERTICAL_KEYWORDS[v] ?? [];
      return sectors.some((ps) => {
        const pl = ps.toLowerCase();
        return keywords.some((kw) => pl.includes(kw) || kw.includes(pl));
      });
    });

    if (matchedVerticals.length > 0) {
      setSelectedVerticals(matchedVerticals as string[]);
    }
    setProfileApplied(true);
  }, [profile, profileApplied, profileBannerDismissed]);

  const handleDismissProfileFilter = () => {
    setProfileBannerDismissed(true);
    setSelectedVerticals([]);
    setVerticalMatchMode("any");
    try {
      localStorage.setItem("signalera_deal_filter_dismissed", "true");
    } catch { /* no-op */ }
  };


  /* ── Add to watchlist ── */
  const handleAddToWatchlist = async (company: string) => {
    if (addedSet.has(company)) return;
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: company, type: "company" }),
      });
      setAddedSet((prev) => new Set([...prev, company]));
    } catch (e) {
      console.error("Failed to add to watchlist:", e);
    }
  };

  /* ── Open memo modal ── */
  const openMemo = (deal: Deal, e: React.MouseEvent) => {
    e.stopPropagation();
    setMemoDeal(deal);
    fireEvent("memo_generated", { company: deal.company, sector: deal.sector ?? undefined });
  };

  /* ── Add deal ── */
  const handleAddDeal = async () => {
    if (!formData.company.trim()) return;

    const newDeal: Deal = {
      id: Date.now().toString(),
      company: formData.company,
      acquirer: formData.acquirer || null,
      deal_type: formData.deal_type || null,
      stage: formData.status || "announced",
      status: formData.status || "announced",
      value: formData.value || null,
      sector: formData.sector || null,
      notes: formData.notes || null,
      source: formData.source || "manual",
      updated_at: new Date().toISOString(),
      ingested_at: new Date().toISOString(),
    };

    setDeals([newDeal, ...deals]);
    setShowForm(false);
    setFormData({ company: "", acquirer: "", deal_type: "", status: "announced", value: "", sector: "", notes: "", source: "" });

    const { error } = await getSupabase().from("deal_flow").insert([{
      company: newDeal.company,
      acquirer: newDeal.acquirer,
      deal_type: newDeal.deal_type,
      status: newDeal.status,
      value: newDeal.value,
      sector: newDeal.sector,
      notes: newDeal.notes,
      source: "manual",
      ingested_at: new Date().toISOString(),
    }]);
    if (error) console.error("Deal insert failed:", error);
  };


  /* ── Computed ── */
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    deals.forEach((d) => {
      const stage = getDealStage(d);
      counts[stage] = (counts[stage] || 0) + 1;
    });
    return counts;
  }, [deals]);

  const activeDeals = useMemo(
    () => deals.filter((d) => !["closed", "dead"].includes(getDealStage(d))).length,
    [deals],
  );

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      // Minimum quality: hide deals with no acquirer AND no valuation/value
      const hasAcquirer = !!(d.acquirer && d.acquirer.trim());
      const hasValue = !!(d.valuation && d.valuation.trim()) || !!(d.value && d.value.trim());
      if (!hasAcquirer && !hasValue) return false;

      // Default hide deal_type "Other" unless showAllTypes is on
      if (!showAllTypes) {
        const dt = (d.deal_type || "").toLowerCase();
        if (dt === "other") return false;
      }

      const stage = getDealStage(d);
      const stageMatch = filterStage === "ALL" || stage === filterStage;
      const q = search.toLowerCase();
      const searchMatch = !q || d.company?.toLowerCase().includes(q) || d.acquirer?.toLowerCase().includes(q);
      let activityMatch = true;
      if (selectedActivityTypes.length > 0) {
        const fields = [d.deal_type, d.sector].filter(Boolean).join(" ").toLowerCase();
        const check = (type: string) =>
          ACTIVITY_TYPE_KEYWORDS[type]?.some((kw) => fields.includes(kw)) ?? false;
        activityMatch = activityMatchMode === "all"
          ? selectedActivityTypes.every(check)
          : selectedActivityTypes.some(check);
      }
      let verticalMatch = true;
      if (selectedVerticals.length > 0) {
        const sector = (d.sector || "").toLowerCase();
        const check = (v: string) =>
          INDUSTRY_VERTICAL_KEYWORDS[v]?.some((kw) => sector.includes(kw)) ?? false;
        verticalMatch = verticalMatchMode === "all"
          ? selectedVerticals.every(check)
          : selectedVerticals.some(check);
      }
      return stageMatch && searchMatch && activityMatch && verticalMatch;
    });
  }, [deals, filterStage, search, selectedActivityTypes, activityMatchMode, selectedVerticals, verticalMatchMode, showAllTypes]);

  return (
    <AppShell pageTitle="Deal Flow" mood={mood} moodHeadline={moodHeadline} moodDetails={moodDetails}>
      <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Briefcase size={14} className="text-text-muted" />
              <span className="font-sans text-[10px] text-text-muted font-bold">
                Deal flow tracker
              </span>
            </div>
            <p className="font-sans text-[12px] text-text-muted">
              AI-extracted deal pipeline · auto-updated from news ingestion
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowForm((f) => !f)}
            className="flex-shrink-0"
          >
            <Plus size={12} />
            Add Deal
          </Button>
        </div>

        {/* Add Deal Form */}
        {showForm && (
          <div className="bg-white border border-border-base rounded-xl p-5 mt-4 mb-4">
            <p className="font-sans text-[9px] text-text-muted font-bold mb-3">
              New deal
            </p>
            <div className="grid grid-cols-2 gap-2.5 mb-2.5">
              <Input
                placeholder="Company *"
                value={formData.company}
                onChange={(e) => setFormData((f) => ({ ...f, company: e.target.value }))}
                className="font-data"
              />
              <Input
                placeholder="Acquirer"
                value={formData.acquirer}
                onChange={(e) => setFormData((f) => ({ ...f, acquirer: e.target.value }))}
                className="font-data"
              />
              <select
                value={formData.deal_type}
                onChange={(e) => setFormData((f) => ({ ...f, deal_type: e.target.value }))}
                className="font-data text-[12px] bg-parchment-mid border border-border-base rounded-lg px-3 py-2 text-text-secondary cursor-pointer"
              >
                <option value="">Deal Type</option>
                {DEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                value={formData.status}
                onChange={(e) => setFormData((f) => ({ ...f, status: e.target.value }))}
                className="font-data text-[12px] bg-parchment-mid border border-border-base rounded-lg px-3 py-2 text-text-secondary cursor-pointer"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STAGE_CONFIG[s]?.label || s}</option>
                ))}
              </select>
              <Input
                placeholder="Deal Value (e.g. $2.5B)"
                value={formData.value}
                onChange={(e) => setFormData((f) => ({ ...f, value: e.target.value }))}
                className="font-data"
              />
              <select
                value={formData.sector}
                onChange={(e) => setFormData((f) => ({ ...f, sector: e.target.value }))}
                className="font-data text-[12px] bg-parchment-mid border border-border-base rounded-lg px-3 py-2 text-text-secondary cursor-pointer"
              >
                <option value="">Sector</option>
                {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Input
              placeholder="Notes"
              value={formData.notes}
              onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
              className="font-data mb-2.5"
            />
            <Input
              placeholder="Source"
              value={formData.source}
              onChange={(e) => setFormData((f) => ({ ...f, source: e.target.value }))}
              className="font-data mb-3"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddDeal}
                className={cn(
                  "px-4 py-2 rounded-lg font-data text-[11px] font-bold uppercase cursor-pointer",
                  "bg-gold text-cream hover:bg-gold-dark transition-colors",
                )}
              >
                Save Deal
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg font-data text-[11px] font-bold uppercase cursor-pointer border border-border-base text-text-muted hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Stats row */}
        {deals.length > 0 && (
          <div className="grid grid-cols-4 gap-2.5 mt-5 mb-5">
            {[
              { label: "Deals Tracked", value: deals.length },
              { label: "Active", value: activeDeals },
              { label: "Closed", value: stageCounts["closed"] || 0 },
              { label: "With Valuation", value: deals.filter((d) => d.valuation || d.value).length },
            ].map((stat) => (
              <div key={stat.label} className="bg-white border border-border-base rounded-xl p-3.5">
                <div className="font-display text-[24px] font-bold text-espresso mb-0.5">
                  {stat.value}
                </div>
                <div className="font-sans text-[9px] text-text-muted">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Profile sector pre-filter banner */}
        {profileApplied && !profileBannerDismissed && selectedVerticals.length > 0 && (
          <div className="flex items-center justify-between bg-amber-50 dark:bg-overlay border border-amber-200 dark:border-border-default rounded-xl px-4 py-2.5 mb-4">
            <span className="font-sans text-[12px] text-amber-800 dark:text-gold">
              Showing deals in your tracked sectors.{" "}
              <button
                type="button"
                onClick={handleDismissProfileFilter}
                className="font-semibold text-gold hover:text-gold-dark cursor-pointer transition-colors"
              >
                View all →
              </button>
            </span>
            <button
              type="button"
              onClick={handleDismissProfileFilter}
              className="text-amber-600 hover:text-amber-800 cursor-pointer p-0.5"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Search */}
        {deals.length > 0 && (
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, acquirer..."
              className="pl-9 font-data"
            />
          </div>
        )}

        {/* Filter tabs */}
        {deals.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-4">
            <button
              type="button"
              onClick={() => setFilterStage("ALL")}
              className={cn(
                "px-3 py-1 rounded-lg font-sans text-[10px] font-bold cursor-pointer transition-colors border",
                filterStage === "ALL"
                  ? "border-gold bg-gold-muted text-gold"
                  : "border-border-base bg-white dark:bg-elevated text-text-muted hover:text-text-primary",
              )}
            >
              All ({deals.length})
            </button>
            {STATUSES.map((key) => {
              const count = stageCounts[key] || 0;
              const isActive = filterStage === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterStage(key as StageFilter)}
                  className={cn(
                    "px-3 py-1 rounded-lg font-sans text-[10px] font-bold cursor-pointer transition-colors border",
                    isActive
                      ? "border-gold bg-gold-muted text-gold"
                      : "border-border-base bg-white text-text-muted hover:text-text-primary",
                  )}
                >
                  {STAGE_CONFIG[key]?.label || key} ({count})
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowAllTypes((v) => !v)}
              className={cn(
                "px-3 py-1 rounded-lg font-sans text-[10px] font-bold cursor-pointer transition-colors border",
                showAllTypes
                  ? "border-gold bg-gold-muted text-gold"
                  : "border-border-base bg-white dark:bg-elevated text-text-muted hover:text-text-primary",
              )}
            >
              {showAllTypes ? "All types" : "Show all types"}
            </button>
          </div>
        )}

        {/* Activity Type + Sector Filters */}
        {deals.length > 0 && (
          <div className="mb-4 space-y-3">
            {/* Row 1: Activity Type */}
            <div>
              <p className="font-sans text-[9px] text-text-muted mb-1.5">Activity type</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {ACTIVITY_TYPES.map((type) => {
                  const isActive = selectedActivityTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() =>
                        setSelectedActivityTypes((prev) =>
                          prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
                        )
                      }
                      className={cn(
                        "px-3 py-1 rounded-lg font-sans text-[10px] font-bold cursor-pointer transition-colors border",
                        isActive
                          ? getDealTypeStyle(type)
                          : "border-border-base bg-white text-text-muted hover:text-text-primary",
                      )}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
              {selectedActivityTypes.length >= 2 && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="font-sans text-[9px] text-text-faint">Match:</span>
                  {(["any", "all"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setActivityMatchMode(mode)}
                      className={cn(
                        "px-2.5 py-0.5 rounded font-sans text-[9px] font-bold cursor-pointer transition-colors border",
                        activityMatchMode === mode
                          ? "border-gold bg-gold-muted text-gold"
                          : "border-border-base bg-white text-text-muted hover:text-text-primary",
                      )}
                    >
                      {mode === "any" ? "Match Any" : "Match All"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Row 2: Sector (Industry Verticals) */}
            <div>
              <p className="font-sans text-[9px] text-text-muted mb-1.5">Sector</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {INDUSTRY_VERTICALS.map((v) => {
                  const isActive = selectedVerticals.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        const isActivating = !selectedVerticals.includes(v);
                        setSelectedVerticals((prev) =>
                          prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                        );
                        if (isActivating) fireEvent("sector_filter_applied", { sector: v });
                      }}
                      className={cn(
                        "px-3 py-1 rounded-lg font-sans text-[10px] font-bold cursor-pointer transition-colors border",
                        isActive
                          ? "border-gold bg-gold-muted text-gold"
                          : "border-border-base bg-white text-text-muted hover:text-text-primary",
                      )}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
              {selectedVerticals.length >= 2 && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="font-sans text-[9px] text-text-faint">Match:</span>
                  {(["any", "all"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setVerticalMatchMode(mode)}
                      className={cn(
                        "px-2.5 py-0.5 rounded font-sans text-[9px] font-bold cursor-pointer transition-colors border",
                        verticalMatchMode === mode
                          ? "border-gold bg-gold-muted text-gold"
                          : "border-border-base bg-white text-text-muted hover:text-text-primary",
                      )}
                    >
                      {mode === "any" ? "Match Any" : "Match All"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Clear all */}
            {(selectedActivityTypes.length > 0 || selectedVerticals.length > 0) && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedActivityTypes([]);
                    setActivityMatchMode("any");
                    setSelectedVerticals([]);
                    setVerticalMatchMode("any");
                  }}
                  className="font-sans text-[10px] text-text-muted hover:text-text-primary cursor-pointer transition-colors"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* Memo error */}
        {memoError && (
          <div className="flex items-center justify-between bg-signal-dn/10 border border-signal-dn/20 rounded-xl p-3 mb-4">
            <span className="font-sans text-[11px] text-signal-dn">{memoError}</span>
            <button
              type="button"
              onClick={() => setMemoError("")}
              className="text-signal-dn cursor-pointer p-0.5"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && deals.length === 0 && (
          <EmptyState
            icon={<Briefcase size={32} />}
            title="Deal pipeline populating"
            description="AI is extracting deals from ingested articles. Check back shortly."
          />
        )}

        {/* Deal count */}
        {!loading && filtered.length > 0 && (
          <div className="mb-3">
            <p className="font-sans text-[10px] text-text-faint">
              {filtered.length} {filtered.length === 1 ? "deal" : "deals"}
              {filterStage !== "ALL" && ` · ${STAGE_CONFIG[filterStage]?.label}`}
            </p>
            <p className="font-sans text-[11px] text-text-faint mt-0.5">
              Showing confirmed deals with named parties and deal value. Add a deal manually with + Add Deal.
            </p>
          </div>
        )}

        {/* Deal list */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((deal) => {
              const stage = getDealStage(deal);
              const stageConf = STAGE_CONFIG[stage] || STAGE_CONFIG.rumored;
              const isExp = expanded === deal.id;
              const isAdded = addedSet.has(deal.company);
              const displayValue = deal.value || deal.valuation;
              const isHighRelevance = dealRelevanceScore(deal, profile) === "high";
              const showGoldBorder = isHighRelevance && isSaved(deal.id);

              return (
                <div
                  key={deal.id}
                  onClick={() => {
                    if (!isExp) fireEvent("thesis_viewed", { company: deal.company, sector: deal.sector ?? undefined });
                    setExpanded(isExp ? null : deal.id);
                  }}
                  className={cn(
                    "bg-white dark:bg-elevated border border-border-base rounded-xl py-4 cursor-pointer",
                    "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
                    "hover:border-gold-border dark:hover:bg-overlay hover:shadow-[0_2px_12px_rgba(201,146,42,0.06)]",
                    showGoldBorder ? "border-l-2 border-gold pl-[14px] pr-5 -ml-[1px]" : "px-5",
                  )}
                >
                  {/* Top row: company + status */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                      {isHighRelevance && (
                        <span className="w-[6px] h-[6px] rounded-full bg-gold flex-shrink-0" />
                      )}
                      <span className="font-display text-[16px] font-bold text-espresso">
                        {deal.company}
                      </span>
                      {deal.acquirer && (
                        <span className="font-display text-[10px] text-text-muted">
                          ← {deal.acquirer}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleAddToWatchlist(deal.company); }}
                        className={cn(
                          "font-sans text-[11px] cursor-pointer flex-shrink-0",
                          isAdded ? "text-signal-up" : "text-gold hover:text-gold-dark",
                        )}
                        aria-label={isAdded ? "Remove from watchlist" : "Add to watchlist"}
                      >
                        {isAdded ? <Check size={12} /> : <Star size={12} />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleSave(deal.id); }}
                        className={cn(
                          "cursor-pointer flex-shrink-0 transition-colors p-1.5 -m-1.5 rounded",
                          isSaved(deal.id)
                            ? "text-gold"
                            : "text-text-muted hover:text-gold",
                        )}
                        aria-label={isSaved(deal.id) ? "Remove from saved deals" : "Save deal"}
                        aria-pressed={isSaved(deal.id)}
                      >
                        <Bookmark size={12} fill={isSaved(deal.id) ? "currentColor" : "none"} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {displayValue && (
                        <span className="font-display text-[12px] font-semibold text-gold">
                          {displayValue}
                        </span>
                      )}
                      <span className={cn(
                        "px-2 py-0.5 rounded-md font-sans text-[10px] font-bold border",
                        stageConf.color,
                      )}>
                        {stageConf.label}
                      </span>
                    </div>
                  </div>

                  {/* Badges row */}
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {deal.deal_type && (
                      <span className={cn(
                        "font-sans text-[10px] font-bold px-2 py-0.5 rounded-md border",
                        getDealTypeStyle(deal.deal_type),
                      )}>
                        {deal.deal_type}
                      </span>
                    )}
                    {deal.sector && (
                      <span
                        className={cn(
                          "font-sans text-[10px] font-bold px-2 py-0.5 rounded-md border",
                          isHighRelevance
                            ? "text-gold bg-gold/10 border-gold/20"
                            : "bg-white/[0.06] text-[#9a9a94] border border-white/[0.10] dark:bg-white/[0.06] dark:text-[#9a9a94] dark:border-white/[0.10]",
                        )}
                      >
                        {deal.sector.split(" ")[0]}
                      </span>
                    )}
                    {deal.updated_at && (
                      <span className="font-sans text-[10px] text-text-faint">
                        {timeAgo(deal.updated_at)}
                      </span>
                    )}
                    {deal.auto_extracted && (
                      <span className="font-sans text-[9px] text-gold/40">🤖 AI</span>
                    )}
                  </div>

                  {/* Expanded section */}
                  {isExp && (
                    <div className="mt-3 pt-3 border-t border-border-subtle">
                      {deal.thesis && (
                        <div className="bg-gold-muted border border-gold-border rounded-lg p-3 mb-3">
                          <p className="font-sans text-[9px] text-text-muted font-bold mb-1">
                            Signal
                          </p>
                          <p className="font-sans text-[12px] text-text-secondary leading-relaxed italic">
                            {redactRationale(deal.thesis)}
                          </p>
                        </div>
                      )}
                      {(deal.notes || deal.summary) && (
                        <p className="font-sans text-[12px] text-text-secondary leading-relaxed mb-2">
                          {deal.notes || deal.summary}
                        </p>
                      )}
                      {deal.source && (
                        <p className="font-sans text-[10px] text-text-faint mb-2">
                          Source: {deal.source}
                        </p>
                      )}
                      {deal.source_url && (
                        <a
                          href={deal.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-sans text-[11px] text-gold hover:text-gold-dark"
                        >
                          Read Source →
                        </a>
                      )}
                    </div>
                  )}

                  {/* Footer row */}
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-sans text-[10px] text-text-faint flex items-center gap-1">
                      {isExp ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      {isExp ? "collapse" : "expand"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => openMemo(deal, e)}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
                        "bg-gold text-cream font-sans text-[10px] font-bold",
                        "hover:bg-gold-dark transition-colors cursor-pointer",
                      )}
                    >
                      <Sparkles size={10} />
                      Generate memo
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && deals.length > 0 && filtered.length === 0 && (
          <EmptyState
            icon={<Search size={32} />}
            title="No deals match"
            description="Try a different search term or filter"
          />
        )}
      </div>
      <DealFlowSidebar deals={deals} userProfile={profile} enrichedSavedDeals={enrichedSavedDeals} toggleSave={toggleSave} />
      </div>

      {/* Memo Modal */}
      {memoDeal && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoDeal(null)}
          title={memoDeal.company}
          content={withCompanyLine(
            [
              `TARGET: ${memoDeal.company}`,
              `ACQUIRER: ${memoDeal.acquirer || "Undisclosed"}`,
              `TYPE: ${memoDeal.deal_type || "Undisclosed"}`,
              `VALUE: ${memoDeal.value || memoDeal.valuation || "Undisclosed"}`,
              `STATUS: ${memoDeal.stage || memoDeal.status || "Undisclosed"}`,
              `SECTOR: ${memoDeal.sector || "Undisclosed"}`,
              memoDeal.notes ? `NOTES: ${memoDeal.notes}` : null,
              memoDeal.summary ? `CONTEXT: ${memoDeal.summary}` : null,
            ].filter(Boolean).join("\n"),
            memoDeal.company,
          )}
          type="deal"
        />
      )}
    </AppShell>
  );
}
