"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { cn } from "@/lib/utils";
import { Bookmark, Briefcase, ArrowLeft, Download, X } from "lucide-react";
import { useSavedDeals } from "@/hooks/useSavedDeals";
import { createBrowserClient } from "@supabase/ssr";
import { useEffect } from "react";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

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
  source?: string | null;
  source_url?: string | null;
  updated_at?: string;
  ingested_at?: string;
}

type SortKey = "saved_at" | "company" | "value";

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  rumored: { label: "RUMORED", color: "text-amber-600 bg-amber-50 border-amber-200" },
  announced: { label: "ANNOUNCED", color: "text-green-600 bg-green-50 border-green-200" },
  under_loi: { label: "UNDER LOI", color: "text-blue-600 bg-blue-50 border-blue-200" },
  closed: { label: "CLOSED", color: "text-text-muted bg-parchment-mid border-border-base" },
};

function getDealStage(deal: Deal): string {
  return deal.stage || deal.status || "rumored";
}

function parseValue(val: string | null | undefined): number {
  if (!val) return 0;
  const clean = val.replace(/[$,\s]/g, "").toLowerCase();
  const m = clean.match(/^([\d.]+)([tmbk]n?)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const s = m[2] ?? "";
  if (s.startsWith("t")) return n * 1e12;
  if (s.startsWith("b")) return n * 1e9;
  if (s.startsWith("m")) return n * 1e6;
  if (s.startsWith("k")) return n * 1e3;
  return n;
}

function exportCSV(deals: Deal[]) {
  const headers = ["Company", "Acquirer", "Deal Type", "Stage", "Value", "Sector", "Source"];
  const rows = deals.map((d) => [
    d.company,
    d.acquirer ?? "",
    d.deal_type ?? "",
    getDealStage(d),
    d.value || d.valuation || "",
    d.sector ?? "",
    d.source ?? "",
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `saved-deals-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SavedDealsPage() {
  const { savedDeals, toggleSave, isLoading } = useSavedDeals();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("saved_at");
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  // Fetch full deal objects for saved IDs
  useEffect(() => {
    async function load() {
      if (isLoading) return;
      if (savedDeals.length === 0) {
        setDealsLoading(false);
        return;
      }
      const ids = savedDeals.map((s) => s.deal_id);
      const { data } = await getSupabase()
        .from("deal_flow")
        .select("*")
        .in("id", ids);
      setDeals(data ?? []);
      setDealsLoading(false);
    }
    load();
  }, [isLoading, savedDeals]);

  const savedAt = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of savedDeals) m[s.deal_id] = s.saved_at;
    return m;
  }, [savedDeals]);

  const sorted = useMemo(() => {
    return [...deals].sort((a, b) => {
      if (sortKey === "company") return a.company.localeCompare(b.company);
      if (sortKey === "value") return parseValue(b.value || b.valuation) - parseValue(a.value || a.valuation);
      // saved_at desc
      const ta = savedAt[a.id] ?? "";
      const tb = savedAt[b.id] ?? "";
      return tb.localeCompare(ta);
    });
  }, [deals, sortKey, savedAt]);

  async function handleUnsave(dealId: string) {
    setRemovingIds((s) => new Set([...s, dealId]));
    await toggleSave(dealId);
    // Fade-out: brief delay then cleanup
    setTimeout(() => {
      setRemovingIds((s) => {
        const next = new Set(s);
        next.delete(dealId);
        return next;
      });
      setDeals((prev) => prev.filter((d) => d.id !== dealId));
    }, 300);
  }

  const loading = isLoading || dealsLoading;

  return (
    <AppShell pageTitle="Saved Deals">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link
              href="/deal-flow"
              className="inline-flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors mb-3"
            >
              <ArrowLeft size={12} />
              Back to Deal Flow
            </Link>
            <div className="flex items-center gap-2 mb-1">
              <Bookmark size={14} className="text-gold" fill="currentColor" />
              <span className="font-data text-[10px] uppercase tracking-widest text-gold font-bold">
                Saved Deals
              </span>
            </div>
            <p className="font-sans text-[12px] text-text-muted">
              {sorted.length} saved deal{sorted.length !== 1 ? "s" : ""}
            </p>
          </div>
          {sorted.length > 0 && (
            <button
              type="button"
              onClick={() => exportCSV(sorted)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-base bg-white text-[11px] font-medium text-text-muted hover:text-text-primary hover:border-gold-border transition-colors"
            >
              <Download size={12} />
              Export CSV
            </button>
          )}
        </div>

        {/* Sort controls */}
        {sorted.length > 1 && (
          <div className="flex items-center gap-1 mb-4">
            <span className="font-data text-[10px] uppercase tracking-widest text-text-muted mr-1">Sort:</span>
            {(["saved_at", "company", "value"] as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className={cn(
                  "px-2.5 py-1 rounded-lg font-data text-[10px] font-bold uppercase cursor-pointer transition-colors border",
                  sortKey === key
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-border-base bg-white text-text-muted hover:text-text-primary",
                )}
              >
                {key === "saved_at" ? "Date Saved" : key === "company" ? "Company" : "Value"}
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-parchment-mid rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && sorted.length === 0 && (
          <div className="text-center py-16">
            <Bookmark size={32} className="text-border-base mx-auto mb-3" />
            <p className="font-display text-[16px] font-semibold text-text-primary mb-1">No saved deals yet</p>
            <p className="font-sans text-[13px] text-text-muted mb-4">
              Bookmark deals from the Deal Flow tracker to save them here.
            </p>
            <Link
              href="/deal-flow"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gold text-cream font-data text-[11px] font-bold uppercase hover:bg-gold-dark transition-colors"
            >
              <Briefcase size={12} />
              Go to Deal Flow
            </Link>
          </div>
        )}

        {/* Deal list */}
        {!loading && sorted.length > 0 && (
          <div className="space-y-2">
            {sorted.map((deal) => {
              const stage = getDealStage(deal);
              const stageConf = STAGE_CONFIG[stage] || STAGE_CONFIG.rumored;
              const displayValue = deal.value || deal.valuation;
              const isRemoving = removingIds.has(deal.id);

              return (
                <div
                  key={deal.id}
                  className={cn(
                    "bg-white border border-border-base rounded-xl px-5 py-4",
                    "transition-all duration-300 ease-out",
                    isRemoving && "opacity-0 scale-y-95 pointer-events-none",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-display text-[15px] font-bold text-espresso">
                          {deal.company}
                        </span>
                        {deal.acquirer && (
                          <span className="font-data text-[10px] text-text-muted">
                            ← {deal.acquirer}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md font-data text-[10px] font-bold uppercase border",
                          stageConf.color,
                        )}>
                          {stageConf.label}
                        </span>
                        {deal.deal_type && (
                          <span className="font-data text-[10px] text-text-muted">
                            {deal.deal_type}
                          </span>
                        )}
                        {deal.sector && (
                          <span className="font-data text-[10px] text-text-faint">
                            {deal.sector}
                          </span>
                        )}
                      </div>
                      {savedAt[deal.id] && (
                        <p className="font-data text-[10px] text-text-muted mt-1.5">
                          Saved {new Date(savedAt[deal.id]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-start gap-2 flex-shrink-0">
                      {displayValue && (
                        <span className="font-data text-[13px] font-semibold text-gold">
                          {displayValue}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleUnsave(deal.id)}
                        className="text-text-muted hover:text-red-400 transition-colors p-0.5"
                        aria-label="Remove from saved deals"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {deal.source_url && (
                    <a
                      href={deal.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 font-data text-[10px] text-gold hover:opacity-80 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      View source →
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
