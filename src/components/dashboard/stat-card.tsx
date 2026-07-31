"use client";

import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/ui";
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
  /** Retained for call-site compatibility; the editorial stat cell renders no sparkline. */
  sparkData?: number[];
  /**
   * When two rows are present (e.g. Bullish / Bearish for the Signals cell)
   * they render inline as "N up / N down" in place of the percent delta.
   */
  detailRows?: { label: string; value: string }[];
  /** When true, cell shows "last close" instead of a percent-change. */
  stale?: boolean;
  /** Optional edit-mode overlay (swap dropdown + minus button). */
  editOverlay?: React.ReactNode;
  /** Left hairline divider between cells in the stat band (all but the first). */
  showDivider?: boolean;
}

/**
 * Parse a pre-formatted stat string ("5,431.60", "4.21%", "128") into a
 * count-up target plus a formatter that reproduces the original shape
 * (thousands separators, decimal places, and a trailing "%"). Returns null
 * for anything non-numeric ("—", "$1.2T") so the caller renders it static.
 */
function numericShape(
  value: string,
): { target: number; format: (n: number) => string } | null {
  const trimmed = value.trim();
  const suffix = trimmed.endsWith("%") ? "%" : "";
  const core = suffix ? trimmed.slice(0, -1) : trimmed;
  const hasComma = core.includes(",");
  const bare = core.replace(/,/g, "");
  if (bare === "" || !Number.isFinite(Number(bare))) return null;
  const dot = bare.indexOf(".");
  const decimals = dot >= 0 ? bare.length - dot - 1 : 0;
  const target = Number(bare);
  const format = (n: number) => {
    const rounded = Number(n.toFixed(decimals));
    const body = hasComma
      ? rounded.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : rounded.toFixed(decimals);
    return body + suffix;
  };
  return { target, format };
}

/**
 * StatCard — a single editorial figure cell in the dashboard stat band.
 * IBM Plex Mono throughout with tabular figures; the value counts up on mount
 * (reduced-motion safe via AnimatedNumber). Hover reveals a gold baseline
 * rather than lifting the cell.
 */
export function StatCard({
  label,
  value,
  change,
  changeAbs,
  displayUnit = "percent",
  accentGold = false,
  detailRows = [],
  stale = false,
  editOverlay,
  showDivider = false,
}: StatCardProps) {
  const changeDisplay = formatChange({ pct: change, change: changeAbs, unit: displayUnit });
  const changeColor = changeDisplay.isPositive ? "text-signal-up" : "text-signal-dn";
  const shape = numericShape(value);
  const valueColor = accentGold ? "text-gold" : "text-espresso";
  const breakdown = detailRows.length >= 2 ? detailRows : null;

  return (
    <div
      className={cn(
        "dash-figcell relative px-5 py-3.5 md:px-6 md:py-4",
        showDivider && "border-l border-[rgba(212,168,75,0.14)]",
      )}
    >
      {editOverlay}
      <p className="font-data text-[10px] tracking-[0.01em] text-text-muted m-0 mb-1.5">
        {label}
      </p>
      <p className="flex items-baseline gap-2 m-0">
        <span
          className={cn(
            "font-data text-[22px] font-semibold tabular-nums leading-none",
            valueColor,
          )}
        >
          {shape ? <AnimatedNumber value={shape.target} format={shape.format} /> : value}
        </span>
        {stale ? (
          <span className="font-data text-[11px] text-text-muted leading-none">
            · last close
          </span>
        ) : breakdown ? (
          <span className="font-data text-[12px] leading-none tabular-nums">
            <span className="text-signal-up">{breakdown[0].value}↑</span>{" "}
            <span className="text-signal-dn">{breakdown[1].value}↓</span>
          </span>
        ) : (
          <span
            className={cn(
              "font-data text-[12px] font-semibold leading-none tabular-nums",
              changeColor,
            )}
          >
            {changeDisplay.text}
          </span>
        )}
      </p>
    </div>
  );
}
