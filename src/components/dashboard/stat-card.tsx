"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { formatChange, type DisplayUnit } from "@/lib/format-change";

interface StatCardProps {
  label: string;
  value: string;
  /** Relative percent change. */
  change: number;
  /**
   * Absolute delta in the same units as `value`. Required when
   * `displayUnit === "bps"` so the change can be rendered in basis points.
   */
  changeAbs?: number;
  /** "percent" (default) or "bps". See src/lib/format-change.ts. */
  displayUnit?: DisplayUnit;
  accentGold?: boolean;
  sparkData?: number[];
  detailRows?: { label: string; value: string }[];
  /** When true, card renders "Markets closed · last: {value}" instead of percent-change. */
  stale?: boolean;
  /** Optional edit-mode overlay (swap dropdown + minus button). */
  editOverlay?: React.ReactNode;
}

export function StatCard({
  label,
  value,
  change,
  changeAbs,
  displayUnit = "percent",
  accentGold = false,
  sparkData = [],
  detailRows = [],
  stale = false,
  editOverlay,
}: StatCardProps) {
  const [hovered, setHovered] = useState(false);

  const changeDisplay = formatChange({ pct: change, change: changeAbs, unit: displayUnit });
  const isPositive = changeDisplay.isPositive;
  const changeColor = isPositive ? "text-signal-up" : "text-signal-dn";

  return (
    <div
      className={cn(
        "relative bg-white border border-border-base rounded-2xl overflow-hidden",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        !editOverlay &&
          "hover:-translate-y-0.5 hover:border-border-hover hover:shadow-[0_2px_12px_rgba(201,146,42,0.06)]",
        "group",
      )}
      onMouseEnter={() => !editOverlay && setHovered(true)}
      onMouseLeave={() => !editOverlay && setHovered(false)}
    >
      {editOverlay}
      {/* Top accent line */}
      <div
        className={cn(
          "absolute top-0 left-0 h-[3px] transition-all duration-[var(--duration-slow)] ease-[var(--ease-out)]",
          accentGold
            ? "bg-gradient-to-r from-gold to-gold-light"
            : "bg-border-base",
          hovered ? "w-full" : "w-12",
        )}
      />

      <div className="px-3 pt-3 pb-2.5">
        {/* Label */}
        <p className="font-sans text-[11px] text-text-muted">
          {label}
        </p>

        {/* Value + change */}
        {stale ? (
          <div className="mt-1.5">
            <div className="flex items-baseline gap-2">
              <span
                className="font-display text-[22px] font-semibold text-espresso"
              >
                {value}
              </span>
              <span
                className={cn(
                  "font-display text-[11px] font-semibold",
                  changeColor,
                )}
              >
                {changeDisplay.text}
              </span>
            </div>
            <span className="block font-sans text-[10px] text-text-muted mt-0.5">
              Markets closed · last close
            </span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2 mt-1.5">
            <span
              className={cn(
                "font-display text-[21px] font-bold",
                accentGold ? "text-gold" : "text-espresso",
              )}
            >
              {value}
            </span>
            <span
              className={cn(
                "font-display text-[11px] font-semibold",
                changeColor,
              )}
            >
              {changeDisplay.text}
            </span>
          </div>
        )}

        {/* Spark area */}
        <div className="h-[30px] mt-1.5 relative">
          {/* Bar chart (fades out on hover) */}
          <div
            className={cn(
              "absolute inset-0 flex items-end gap-[2px]",
              "transition-opacity duration-[var(--duration-base)]",
              hovered ? "opacity-0" : "opacity-100",
            )}
          >
            {sparkData.length > 0 ? (
              sparkData.map((val, i) => {
                const max = Math.max(...sparkData);
                const min = Math.min(...sparkData);
                const range = max - min || 1;
                const height = ((val - min) / range) * 100;
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex-1 rounded-t-sm",
                      accentGold ? "bg-gold/20" : "bg-border-base",
                    )}
                    style={{ height: `${Math.max(height, 8)}%` }}
                  />
                );
              })
            ) : (
              Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm bg-border-subtle"
                  style={{ height: `${20 + ((i * 37) % 60)}%` }}
                />
              ))
            )}
          </div>

          {/* Sparkline (fades in on hover) */}
          <div
            className={cn(
              "absolute inset-0",
              "transition-opacity duration-[var(--duration-base)]",
              hovered ? "opacity-100" : "opacity-0",
            )}
          >
            {sparkData.length > 1 && (
              <Sparkline data={sparkData} color={accentGold ? "var(--gold)" : isPositive ? "var(--signal-up)" : "var(--signal-dn)"} />
            )}
          </div>
        </div>

        {/* Hover detail rows */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
            hovered ? "max-h-20 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0",
          )}
        >
          <div className="border-t border-border-subtle pt-2 space-y-1.5">
            {detailRows.map((row, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="font-sans text-[10px] text-text-muted">{row.label}</span>
                <span className="font-display text-[11px] font-semibold text-text-primary">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const width = 200;
  const height = 30;
  const padding = 2;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((val - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(" L ")}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
