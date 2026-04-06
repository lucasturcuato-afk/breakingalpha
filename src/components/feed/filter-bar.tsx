"use client";

import { cn } from "@/lib/utils";

export type FeedFilter = "all" | "earnings" | "m&a" | "macro" | "sector" | "alerts" | "saved";

interface FilterBarProps {
  active: FeedFilter;
  onChange: (filter: FeedFilter) => void;
  counts?: Partial<Record<FeedFilter, number>>;
}

const filters: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "earnings", label: "Earnings" },
  { key: "m&a", label: "M&A" },
  { key: "macro", label: "Macro" },
  { key: "sector", label: "Sector" },
  { key: "alerts", label: "Alerts" },
  { key: "saved", label: "Saved" },
];

export function FilterBar({ active, onChange, counts = {} }: FilterBarProps) {
  return (
    <div className="sticky top-0 z-10 bg-parchment border-b border-border-base px-6 py-2.5 flex items-center gap-1.5">
      {filters.map((f) => {
        const isActive = active === f.key;
        const count = counts[f.key];
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
              "font-sans text-[12px] font-medium",
              "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
              "cursor-pointer",
              isActive
                ? "bg-espresso text-cream"
                : "text-text-muted hover:bg-parchment-mid hover:text-text-primary",
            )}
          >
            {f.label}
            {count !== undefined && count > 0 && (
              <span
                className={cn(
                  "text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded px-1",
                  isActive
                    ? "bg-gold text-cream"
                    : "bg-border-base text-text-muted",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
