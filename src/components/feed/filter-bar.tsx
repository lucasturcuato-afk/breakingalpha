"use client";

import { memo, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Bell, Bookmark } from "lucide-react";

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

// ── Filter pill ─────────────────────────────────────────────────────────────
// Matches the Thesis Board filter-tab treatment exactly (see thesis-board/page.tsx
// circa line 535): filled espresso pill when active, transparent with subtle
// border when inactive. Count nested inside the pill at 70% opacity.

interface FilterPillProps {
  label: string;
  count: number;
  isActive: boolean;
  onToggle: (label: string) => void;
}

const FilterPill = memo(function FilterPill({ label, count, isActive, onToggle }: FilterPillProps) {
  const handleClick = useCallback(() => onToggle(label), [onToggle, label]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "font-sans text-[11px] px-3 py-1.5 rounded-full border transition-all cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0",
        isActive
          ? "bg-espresso text-cream border-espresso"
          : "bg-transparent text-text-secondary border-border-base hover:border-border-hover",
      )}
    >
      <span>{label}</span>
      <span className="font-data text-[9px] opacity-70">{count}</span>
    </button>
  );
});

// ── Utility chip (Alerts / Saved) ───────────────────────────────────────────
// Intentionally NOT a FilterPill — these are functional toggles ("show only
// bearish", "show only saved") rather than filter categories, so they keep a
// gold-tinted treatment that reads as a mode switch rather than a filter pick.

interface UtilChipProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onToggle: () => void;
  badge?: number;
}

function UtilChip({ label, icon, isActive, onToggle, badge }: UtilChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "font-sans text-[11px] px-3 py-1.5 rounded-full border transition-all cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap",
        isActive
          ? "bg-gold-muted text-gold border-gold-border"
          : "bg-transparent text-text-secondary border-border-base hover:border-border-hover",
      )}
    >
      {icon}
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="font-data text-[9px] opacity-70">{badge}</span>
      )}
    </button>
  );
}

// ── FilterBar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  selectedVerticals: string[];
  selectedActivityTypes: string[];
  onVerticalToggle: (v: string) => void;
  onActivityTypeToggle: (a: string) => void;
  showAlertsOnly: boolean;
  onAlertsToggle: () => void;
  showSavedOnly: boolean;
  onSavedToggle: () => void;
  alertCount?: number;
  verticalCounts?: ReadonlyMap<string, number>;
  activityCounts?: ReadonlyMap<string, number>;
}

function FilterBarInner({
  selectedVerticals,
  selectedActivityTypes,
  onVerticalToggle,
  onActivityTypeToggle,
  showAlertsOnly,
  onAlertsToggle,
  showSavedOnly,
  onSavedToggle,
  alertCount = 0,
  verticalCounts,
  activityCounts,
}: FilterBarProps) {
  // O(1) membership per chip instead of O(k) Array.includes.
  const verticalSelectedSet = useMemo(() => new Set(selectedVerticals), [selectedVerticals]);
  const activitySelectedSet = useMemo(() => new Set(selectedActivityTypes), [selectedActivityTypes]);

  return (
    <div className="bg-parchment dark:bg-surface px-4 py-2.5 space-y-2">
      {/* Row 1 — SECTORS */}
      <div className="flex items-center gap-3">
        <span className="font-sans text-[10px] font-semibold text-text-muted w-[56px] flex-shrink-0">
          Sectors
        </span>
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto flex-1">
          {INDUSTRY_VERTICALS.map((label) => (
            <FilterPill
              key={label}
              label={label}
              count={verticalCounts?.get(label) ?? 0}
              isActive={verticalSelectedSet.has(label)}
              onToggle={onVerticalToggle}
            />
          ))}
        </div>
      </div>

      {/* Row 2 — ACTIVITY */}
      <div className="flex items-center gap-3">
        <span className="font-sans text-[10px] font-semibold text-text-muted w-[56px] flex-shrink-0">
          Activity
        </span>
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto flex-1">
          {ACTIVITY_TYPES.map((label) => (
            <FilterPill
              key={label}
              label={label}
              count={activityCounts?.get(label) ?? 0}
              isActive={activitySelectedSet.has(label)}
              onToggle={onActivityTypeToggle}
            />
          ))}
        </div>
      </div>

      {/* Row 3 — Utility (right-aligned) */}
      <div className="flex items-center justify-end gap-1.5">
        <UtilChip
          label="Alerts"
          icon={<Bell size={11} />}
          isActive={showAlertsOnly}
          onToggle={onAlertsToggle}
          badge={alertCount}
        />
        <UtilChip
          label="Saved"
          icon={<Bookmark size={11} />}
          isActive={showSavedOnly}
          onToggle={onSavedToggle}
        />
      </div>
    </div>
  );
}

/**
 * Memoized so unrelated parent re-renders (60s poll, mood tick, sort change)
 * don't re-reconcile the 22 filter pills. Re-renders only when a filter-state
 * or counts prop ref changes.
 */
export const FilterBar = memo(FilterBarInner);
