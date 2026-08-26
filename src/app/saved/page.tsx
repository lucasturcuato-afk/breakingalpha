"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { cn } from "@/lib/utils";
import { Bookmark, Briefcase, ArrowLeft, Download, X } from "lucide-react";
import { useSavedDeals, type EnrichedDeal } from "@/hooks/useSavedDeals";
import { normalizeSector } from "@/lib/deal-utils";
import { MobileSavedScreen } from "@/components/saved/mobile-saved-screen";

type SortKey = "saved_at" | "company" | "value";

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  rumored: { label: "RUMORED", color: "text-amber-600 bg-amber-50 border-amber-200" },
  announced: { label: "ANNOUNCED", color: "text-green-600 bg-green-50 border-green-200" },
  under_loi: { label: "UNDER LOI", color: "text-blue-600 bg-blue-50 border-blue-200" },
  closed: { label: "CLOSED", color: "text-text-muted bg-parchment-mid border-border-base" },
};

function getDealStage(deal: EnrichedDeal): string {
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

function exportCSV(deals: EnrichedDeal[]) {
  const headers = ["Company", "Acquirer", "Deal Type", "Stage", "Value", "Sector", "Source", "Saved At"];
  const rows = deals.map((d) => [
    d.company,
    d.acquirer ?? "",
    d.deal_type ?? "",
    getDealStage(d),
    d.value || d.valuation || "",
    d.sector ? normalizeSector(d.sector) : "",
    d.source_url ?? "",
    d.saved_at ? new Date(d.saved_at).toLocaleDateString() : "",
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
  const { enrichedSavedDeals, toggleSave, isLoading, error } = useSavedDeals();
  const [exported, setExported] = useState(false);

  // Local display list for fade-out animation — seeded once on load
  const [displayDeals, setDisplayDeals] = useState<EnrichedDeal[]>([]);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("saved_at");
  const seeded = useRef(false);

  // Seed display list once: wait until loading is done AND enriched data has arrived
  useEffect(() => {
    if (!isLoading && !seeded.current && enrichedSavedDeals.length > 0) {
      setDisplayDeals(enrichedSavedDeals);
      seeded.current = true;
    }
  }, [isLoading, enrichedSavedDeals]);

  const sorted = useMemo(() => {
    return [...displayDeals].sort((a, b) => {
      if (sortKey === "company") return a.company.localeCompare(b.company);
      if (sortKey === "value") return parseValue(b.value || b.valuation) - parseValue(a.value || a.valuation);
      // saved_at desc (default)
      return (b.saved_at ?? "").localeCompare(a.saved_at ?? "");
    });
  }, [displayDeals, sortKey]);

  async function handleUnsave(dealId: string) {
    setRemovingIds((s) => new Set([...s, dealId]));
    await toggleSave(dealId);
    setTimeout(() => {
      setRemovingIds((s) => { const n = new Set(s); n.delete(dealId); return n; });
      setDisplayDeals((prev) => prev.filter((d) => d.id !== dealId));
    }, 300);
  }

  const hasSaved = displayDeals.length > 0;

  function handleExport() {
    exportCSV(sorted);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }

  return (
    /* `mobileFullBleed` is the whole fix. The shell used to sit inside a
       `hidden md:block`, which took the MOBILE TAB BAR down with it: below md
       the entire shell was display:none, so the screen rendered with no
       navigation at all. The flag gates only the desk chrome, the mood bar,
       topbar and footer, and leaves the tab bar mounted. Gating stays in a
       CLASS on the two layout wrappers below; an inline display would beat a
       responsive class at every breakpoint. */
    <AppShell pageTitle="Saved Deals" mobileFullBleed>
      {/* Phone width. One state, two layouts: the mobile screen reads the same
          hook, the same sort key and the same list the desktop table does. */}
      <div className="md:hidden">
        <MobileSavedScreen
          deals={sorted}
          isLoading={isLoading}
          error={error}
          sortKey={sortKey}
          onSort={setSortKey}
          onUnsave={handleUnsave}
          onExport={handleExport}
          exported={exported}
          stageOf={getDealStage}
        />
      </div>

      <div className="hidden md:block">
      <div className="max-w-3xl mx-auto px-6 py-8 dark:bg-[#161616] min-h-full">
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
              <span className="font-sans text-[10px] uppercase tracking-widest text-gold font-bold">
                Saved Deals
              </span>
            </div>
            {/* On a failed read `sorted.length` is 0, and printing "0 saved
                deals" states a figure about the reader's own record that the app
                just failed to read. The mobile screen says "Count unavailable"
                for exactly this; this half said zero. */}
            <p className="font-sans text-[12px] text-text-muted">
              {error && !isLoading
                ? "Count unavailable"
                : `${sorted.length} saved deal${sorted.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          {hasSaved && (
            <button
              type="button"
              onClick={() => exportCSV(sorted)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-base bg-white dark:bg-[#1e1e1e] dark:border-white/[0.14] text-[11px] font-medium text-text-muted hover:text-text-primary hover:border-gold-border transition-colors"
            >
              <Download size={12} />
              Export CSV
            </button>
          )}
        </div>

        {/* Sort controls — shown whenever there are saved deals */}
        {hasSaved && (
          <div className="flex items-center gap-1 mb-4">
            <span className="font-sans text-[10px] uppercase tracking-widest text-text-muted mr-1">Sort:</span>
            {(["saved_at", "company", "value"] as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className={cn(
                  "px-2.5 py-1 rounded-lg font-sans text-[10px] font-bold uppercase cursor-pointer transition-colors border",
                  sortKey === key
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-border-base bg-white dark:bg-[#1e1e1e] text-text-muted hover:text-text-primary",
                )}
              >
                {key === "saved_at" ? "Date Saved" : key === "company" ? "Company" : "Value"}
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-parchment-mid rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Failed read. The desktop twin of a state the mobile screen already
            had, in the same file.

            `error` was destructured here and handed to MobileSavedScreen, and
            this half ignored it, so a request that died rendered "No saved deals
            yet" over a Go to Deal Flow button. That is the same trust failure
            the mobile error state exists to prevent, on the wider surface. The
            copy is the mobile screen's, written the way it is for the same
            reason: it reports the failed request and explicitly declines to
            describe what is behind it. */}
        {!isLoading && error && (
          <div className="text-center py-16" role="alert">
            <p className="font-display text-[16px] font-semibold text-text-primary mb-1">
              Your saved deals did not load
            </p>
            <p className="font-sans text-[13px] text-text-muted max-w-[46ch] mx-auto">
              The request did not complete, so there is nothing to show here. This is not a reading
              of what you have saved. Open the screen again in a moment.
            </p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && !hasSaved && (
          <div className="text-center py-16">
            <Bookmark size={32} className="text-border-base mx-auto mb-3" />
            <p className="font-display text-[16px] font-semibold text-text-primary mb-1">No saved deals yet</p>
            <p className="font-sans text-[13px] text-text-muted mb-4">
              Bookmark deals from the Deal Flow tracker to save them here.
            </p>
            <Link
              href="/deal-flow"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gold text-cream font-sans text-[11px] font-bold uppercase hover:bg-gold-dark transition-colors"
            >
              <Briefcase size={12} />
              Go to Deal Flow
            </Link>
          </div>
        )}

        {/* Deal list */}
        {!isLoading && sorted.length > 0 && (
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
                    "bg-white dark:bg-[#1e1e1e] border border-border-base dark:border-white/[0.14] rounded-xl px-5 py-4",
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
                          <span className="font-display text-[10px] text-text-muted">
                            ← {deal.acquirer}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md font-sans text-[10px] font-bold uppercase border",
                          stageConf.color,
                        )}>
                          {stageConf.label}
                        </span>
                        {deal.deal_type && (
                          <span className="font-sans text-[10px] text-text-muted">
                            {deal.deal_type}
                          </span>
                        )}
                        {deal.sector && (
                          <span className="font-sans text-[10px] text-text-faint">
                            {deal.sector}
                          </span>
                        )}
                      </div>
                      {deal.saved_at && (
                        <p className="font-sans text-[10px] text-text-muted mt-1.5">
                          Saved {new Date(deal.saved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
                      className="inline-flex items-center gap-1 mt-2 font-sans text-[10px] text-gold hover:opacity-80 transition-opacity"
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
      </div>
    </AppShell>
  );
}
