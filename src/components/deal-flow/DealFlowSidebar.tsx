"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bookmark, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedDeal } from "@/hooks/useSavedDeals";

interface Deal {
  id: string;
  company: string;
  deal_type?: string | null;
  stage?: string | null;
  status?: string | null;
  value?: string | null;
  valuation?: string | null;
  sector?: string | null;
  updated_at?: string;
  ingested_at?: string;
}

interface UserProfile {
  sectors?: string[] | null;
  watchlist_tickers?: string[] | null;
  role?: string | null;
}

interface DealFlowSidebarProps {
  deals: Deal[];
  userProfile?: UserProfile | null;
  savedDeals?: SavedDeal[];
  toggleSave?: (dealId: string) => Promise<void>;
}

// ── Value parsing / formatting ────────────────────────────────────────────────

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

function formatValue(val: string | null | undefined): string {
  const num = parseValue(val);
  if (num === 0) return val || "—";
  if (num >= 1e12) return `$${(num / 1e12).toFixed(1).replace(/\.0$/, "")}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1).replace(/\.0$/, "")}bn`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}mn`;
  return `$${num.toLocaleString()}`;
}

// ── Stage helpers ─────────────────────────────────────────────────────────────

function getDealStage(deal: Deal): string {
  return deal.stage || deal.status || "rumored";
}

const STATUS_COLORS: Record<string, string> = {
  rumored: "text-amber-500",
  announced: "text-green-600 dark:text-green-400",
  under_loi: "text-blue-500",
  closed: "text-text-muted",
};

// ── Sector normalization ──────────────────────────────────────────────────────

const SECTOR_EXPLICIT: [string, string][] = [
  ["venture capital & startup funding", "Venture Capital"],
  ["private equity & buyouts", "Private Equity"],
  ["technology m&a & investment banking", "Technology"],
  ["healthcare & biotech", "Healthcare & Biotech"],
  ["energy & oil/gas", "Energy & Oil/Gas"],
  ["financial services", "Financial Services"],
  ["consumer & retail", "Consumer & Retail"],
  ["industrials & manufacturing", "Industrials & Manufacturing"],
  ["aerospace & defense", "Aerospace & Defense"],
  ["real estate", "Real Estate"],
  ["media & telecom", "Media & Telecom"],
  ["materials & mining", "Materials & Mining"],
  ["agriculture", "Agriculture"],
  ["technology", "Technology"],
  ["venture capital", "Venture Capital"],
  ["private equity", "Private Equity"],
];

function normalizeSector(sector: string): string {
  const lower = sector.toLowerCase();
  for (const [pattern, label] of SECTOR_EXPLICIT) {
    if (lower.includes(pattern)) return label;
  }
  return sector.length > 24 ? sector.slice(0, 24).trimEnd() + "…" : sector;
}

// ── Company name normalization for dedup ─────────────────────────────────────

function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(
      /\b(inc|corp|pbc|ltd|group|llc|plc|co|company|holdings|international|technologies|technology|solutions|services|capital|partners|ventures|management|global|systems|networks)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

// ── Sector matching against user profile preferences ─────────────────────────

function sectorMatchesUserPref(normalizedSector: string, userSectors: string[]): boolean {
  const ns = normalizedSector.toLowerCase();
  return userSectors.some((pref) => {
    const ps = pref.toLowerCase();
    return ns.includes(ps) || ps.includes(ns);
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOT_OPACITIES = [1.0, 0.72, 0.52, 0.38, 0.28];

// ── Component ─────────────────────────────────────────────────────────────────

export function DealFlowSidebar({ deals, userProfile, savedDeals = [], toggleSave }: DealFlowSidebarProps) {
  const userSectors = useMemo(
    () => userProfile?.sectors?.filter(Boolean) ?? [],
    [userProfile],
  );
  const hasUserSectors = userSectors.length > 0;

  const {
    thisWeek,
    delta,
    inSectorCount,
    topTypes,
    maxTypeCount,
    trackedSectors,
    otherSectors,
    largestDeals,
  } = useMemo(() => {
    const now = Date.now();
    const WEEK = 7 * 24 * 60 * 60 * 1000;

    const thisWeek = deals.filter((d) => {
      const ts = d.updated_at || d.ingested_at;
      return ts ? now - new Date(ts).getTime() < WEEK : false;
    }).length;

    const lastWeek = deals.filter((d) => {
      const ts = d.updated_at || d.ingested_at;
      if (!ts) return false;
      const age = now - new Date(ts).getTime();
      return age >= WEEK && age < 2 * WEEK;
    }).length;

    const delta = thisWeek - lastWeek;

    // In-sector count: deals whose normalized sector matches any user sector
    const inSectorCount = hasUserSectors
      ? deals.filter((d) => {
          if (!d.sector) return false;
          return sectorMatchesUserPref(normalizeSector(d.sector), userSectors);
        }).length
      : 0;

    // By deal type
    const typeCounts: Record<string, number> = {};
    for (const d of deals) {
      if (d.deal_type) typeCounts[d.deal_type] = (typeCounts[d.deal_type] || 0) + 1;
    }
    const topTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const maxTypeCount = topTypes[0]?.[1] || 1;

    // By sector — normalize verbose strings to canonical short labels
    const sectorCounts: Record<string, number> = {};
    for (const d of deals) {
      if (d.sector) {
        const key = normalizeSector(d.sector);
        sectorCounts[key] = (sectorCounts[key] || 0) + 1;
      }
    }
    const allSectors = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]);

    // Split into tracked (matches user prefs) and other active
    const trackedSectors = allSectors
      .filter(([s]) => hasUserSectors && sectorMatchesUserPref(s, userSectors))
      .slice(0, 5);
    const otherSectors = allSectors
      .filter(([s]) => !hasUserSectors || !sectorMatchesUserPref(s, userSectors))
      .slice(0, hasUserSectors ? 3 : 5);

    // Largest deals — sort by value, dedup by normalized name, slice top 3
    const shortestName: Record<string, string> = {};
    for (const d of deals) {
      const key = normalizeCompany(d.company);
      if (!shortestName[key] || d.company.length < shortestName[key].length) {
        shortestName[key] = d.company;
      }
    }

    const sortedByValue = [...deals]
      .filter((d) => d.value || d.valuation)
      .sort((a, b) => parseValue(b.value || b.valuation) - parseValue(a.value || a.valuation));

    const seenKeys = new Set<string>();
    const largestDeals = sortedByValue
      .filter((d) => {
        const key = normalizeCompany(d.company);
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      .slice(0, 3)
      .map((d) => ({
        ...d,
        displayCompany: shortestName[normalizeCompany(d.company)] ?? d.company,
      }));

    return {
      thisWeek,
      delta,
      inSectorCount,
      topTypes,
      maxTypeCount,
      trackedSectors,
      otherSectors,
      largestDeals,
    };
  }, [deals, hasUserSectors, userSectors]);

  // Build a map from deal id → company name for saved section display
  const dealById = useMemo(() => {
    const m: Record<string, Deal> = {};
    for (const d of deals) m[d.id] = d;
    return m;
  }, [deals]);

  const savedWithMeta = useMemo(
    () =>
      savedDeals
        .map((s) => ({ ...s, deal: dealById[s.deal_id] }))
        .filter((s) => s.deal != null) as Array<SavedDeal & { deal: Deal }>,
    [savedDeals, dealById],
  );

  return (
    <aside className="w-[268px] shrink-0 border-l border-border-base overflow-y-auto [scrollbar-gutter:stable] bg-cream">
      {/* Section 0 — Saved deals (only shown when there are saves) */}
      {savedWithMeta.length > 0 && (
        <div className="px-5 py-4 border-b border-border-base">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Saved Deals
            </p>
            <Link
              href="/saved"
              className="text-[10px] font-medium text-gold hover:opacity-80 transition-opacity"
            >
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {savedWithMeta.slice(0, 4).map(({ deal_id, deal }) => (
              <div key={deal_id} className="flex items-center gap-2">
                <Bookmark size={10} className="text-gold shrink-0" fill="currentColor" />
                <span className="text-[11px] text-text-primary flex-1 truncate">
                  {deal.company}
                </span>
                {toggleSave && (
                  <button
                    type="button"
                    onClick={() => toggleSave(deal_id)}
                    className="text-text-muted hover:text-red-400 transition-colors shrink-0"
                    aria-label="Remove saved deal"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
            {savedWithMeta.length > 4 && (
              <p className="text-[10px] text-text-muted">
                +{savedWithMeta.length - 4} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Section 1 — Pipeline velocity */}
      <div className="px-5 py-4 border-b border-border-base">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
          Pipeline Velocity
        </p>
        <div className="flex items-end gap-3">
          <div>
            <span className="text-[26px] font-medium text-text-primary leading-none">
              {thisWeek}
            </span>
            <p className="text-[11px] text-text-muted mt-0.5">deals this week</p>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-1 text-[11px] font-medium mb-1",
              delta > 0
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : delta < 0
                  ? "bg-red-500/10 text-red-500 dark:text-red-400"
                  : "bg-border-base text-text-muted",
            )}
          >
            {delta > 0 ? `+${delta}` : delta === 0 ? "—" : String(delta)} vs last wk
          </span>
        </div>
        {hasUserSectors && inSectorCount > 0 && (
          <p className="text-[11px] text-gold mt-2 font-medium">
            {inSectorCount} in your sectors
          </p>
        )}
      </div>

      {/* Section 2 — Your Sectors */}
      <div className="px-5 py-4 border-b border-border-base">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
          Your Sectors
        </p>
        {!hasUserSectors ? (
          <div className="rounded-md border border-border-base bg-parchment-mid px-3 py-2.5">
            <p className="text-[11px] font-medium text-text-primary mb-0.5">
              No sectors tracked
            </p>
            <p className="text-[10px] text-text-muted leading-snug">
              Add sector focus in your profile to see personalized deal tracking here.
            </p>
            <Link
              href="/settings/profile"
              className="block mt-1.5 text-[11px] font-medium text-gold hover:opacity-80 transition-opacity"
            >
              Complete your profile →
            </Link>
          </div>
        ) : (
          <div className="space-y-2.5">
            {trackedSectors.length === 0 ? (
              <p className="text-[11px] text-text-muted">No deals in your sectors yet</p>
            ) : (
              trackedSectors.map(([sector, count], i) => (
                <div key={sector} className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-gold shrink-0"
                    style={{ opacity: DOT_OPACITIES[i] ?? 0.28 }}
                  />
                  <span className="text-[11px] text-text-primary flex-1 truncate">
                    {sector}
                  </span>
                  <span className="rounded-full bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold shrink-0 leading-none">
                    {count}
                  </span>
                </div>
              ))
            )}
            {otherSectors.length > 0 && (
              <>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted pt-0.5">
                  Other Active
                </p>
                {otherSectors.map(([sector, count]) => (
                  <div key={sector} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-border-base shrink-0" />
                    <span className="text-[11px] text-text-muted flex-1 truncate">
                      {sector}
                    </span>
                    <span className="text-[11px] text-text-muted shrink-0">{count}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Section 3 — Largest deals */}
      <div className="px-5 py-4 border-b border-border-base">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
          Largest Deals
        </p>
        {largestDeals.length === 0 ? (
          <p className="text-[11px] text-text-muted">No valued deals yet</p>
        ) : (
          <div>
            {largestDeals.map((deal, i) => {
              const stage = getDealStage(deal);
              const statusColor = STATUS_COLORS[stage] ?? "text-text-muted";
              const displayValue = deal.value || deal.valuation;
              return (
                <div
                  key={deal.id}
                  className={cn(
                    "py-3",
                    i < largestDeals.length - 1 && "border-b border-border-subtle",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-text-primary truncate">
                        {deal.displayCompany}
                      </p>
                      <p className="text-[10px] text-text-muted mt-0.5">
                        {deal.deal_type || "Deal"}
                        {" · "}
                        <span className={statusColor}>{stage}</span>
                      </p>
                    </div>
                    <span className="text-[12px] font-medium text-gold shrink-0">
                      {formatValue(displayValue)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 4 — By deal type */}
      <div className="px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
          By Deal Type
        </p>
        {topTypes.length === 0 ? (
          <p className="text-[11px] text-text-muted">No data yet</p>
        ) : (
          <div className="space-y-2.5">
            {topTypes.map(([type, count]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-[11px] text-text-primary w-[88px] truncate shrink-0">
                  {type}
                </span>
                <div className="flex-1 h-[3px] bg-border-base rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gold rounded-full"
                    style={{ width: `${(count / maxTypeCount) * 100}%` }}
                  />
                </div>
                <span className="text-[11px] text-text-muted w-4 text-right shrink-0">
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
