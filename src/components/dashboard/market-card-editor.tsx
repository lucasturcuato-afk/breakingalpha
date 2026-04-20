"use client";

/**
 * MarketCardEditor — edit-mode UI layered on top of a StatCard.
 *
 * Renders:
 *   • A chevron-select that lets the user swap the card's symbol to any other
 *     symbol in MARKET_CARD_OPTIONS that isn't already selected elsewhere on
 *     the row.
 *   • A minus button that removes the card (disabled when count <= 2).
 *
 * The surrounding page composes this + StatCard together so the edit affordances
 * overlay the existing card chrome without duplicating its render logic.
 */

import { cn } from "@/lib/utils";
import { Minus, ChevronDown } from "lucide-react";

export interface MarketCardOption {
  symbol: string;
  label: string;
}

// All supported symbols for the dashboard metric cards. Keep in sync with
// SYMBOL_MAP in src/app/api/market-indices/route.ts. SIGNALS is client-side
// only (story count) and never hits the API.
export const MARKET_CARD_OPTIONS: MarketCardOption[] = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "Nasdaq 100" },
  { symbol: "DIA", label: "Dow Jones" },
  { symbol: "VIX", label: "VIX" },
  { symbol: "TNX", label: "10Y Yield" },
  { symbol: "BTC-USD", label: "Bitcoin" },
  { symbol: "GC=F", label: "Gold" },
  { symbol: "CL=F", label: "Oil (WTI)" },
  { symbol: "DX-Y.NYB", label: "DXY" },
  { symbol: "SIGNALS", label: "Signals Today" },
];

interface MarketCardEditorProps {
  /** The symbol this editor is attached to — shown in the select. */
  currentSymbol: string;
  /** All symbols currently on the row — used to disable already-picked options. */
  selectedSymbols: string[];
  /** Called when user picks a new symbol from the dropdown. */
  onSwap: (newSymbol: string) => void;
  /** Called when user clicks the minus button. */
  onRemove: () => void;
  /** Disable the minus button (row already at min count). */
  disableRemove: boolean;
}

export function MarketCardEditor({
  currentSymbol,
  selectedSymbols,
  onSwap,
  onRemove,
  disableRemove,
}: MarketCardEditorProps) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex flex-col items-stretch justify-between p-2",
        // Soft gold-tinted scrim so the card behind reads as "in edit mode".
        "bg-parchment/85 dark:bg-overlay/85 backdrop-blur-[1px]",
        "border border-gold/30 rounded-2xl",
      )}
    >
      {/* Top row: minus button */}
      <div className="flex items-start justify-end">
        <button
          type="button"
          aria-label="Remove card"
          disabled={disableRemove}
          onClick={onRemove}
          className={cn(
            "h-6 w-6 rounded-full border border-border-base bg-white dark:bg-elevated",
            "flex items-center justify-center cursor-pointer",
            "transition-colors hover:border-signal-dn hover:text-signal-dn",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border-base disabled:hover:text-inherit",
          )}
        >
          <Minus size={12} />
        </button>
      </div>

      {/* Center: symbol select */}
      <div className="flex items-center justify-center">
        <div className="relative w-full max-w-[160px]">
          <select
            aria-label="Select metric"
            value={currentSymbol}
            onChange={(e) => onSwap(e.target.value)}
            className={cn(
              "w-full appearance-none cursor-pointer",
              "bg-white dark:bg-elevated",
              "border border-gold/40 hover:border-gold rounded-lg",
              "pl-2.5 pr-7 py-1.5",
              "font-sans text-[11px] font-semibold text-text-primary",
              "focus:outline-none focus:ring-1 focus:ring-gold",
            )}
          >
            {MARKET_CARD_OPTIONS.map((opt) => {
              const takenByOther =
                opt.symbol !== currentSymbol &&
                selectedSymbols.includes(opt.symbol);
              return (
                <option
                  key={opt.symbol}
                  value={opt.symbol}
                  disabled={takenByOther}
                >
                  {opt.label}
                </option>
              );
            })}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gold"
          />
        </div>
      </div>

      {/* Bottom spacer (keeps select vertically centered). */}
      <div aria-hidden className="h-6" />
    </div>
  );
}

/** Label lookup used by page-level code when rendering a friendly card name. */
export function labelForSymbol(symbol: string): string {
  return (
    MARKET_CARD_OPTIONS.find((o) => o.symbol === symbol)?.label ?? symbol
  );
}
