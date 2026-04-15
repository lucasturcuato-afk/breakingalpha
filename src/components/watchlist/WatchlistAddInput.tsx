"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { TICKERS_DEDUPED, type TickerEntry } from "@/data/tickers";

const SECTORS = [
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

export type AddType = "ticker" | "company" | "sector";

interface WatchlistAddInputProps {
  addType: AddType;
  onAddTypeChange: (t: AddType) => void;
  onAdd: (identifier: string, displayName?: string) => Promise<void>;
  addError: string;
  onClearError: () => void;
  trackedIdentifiers: string[];
}

function matchesTicker(entry: TickerEntry, query: string): boolean {
  const q = query.toLowerCase();
  return (
    entry.ticker.toLowerCase().includes(q) ||
    entry.name.toLowerCase().includes(q)
  );
}

export function WatchlistAddInput({
  addType,
  onAddTypeChange,
  onAdd,
  addError,
  onClearError,
  trackedIdentifiers,
}: WatchlistAddInputProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // For ticker mode: must select from list
  const [selectedTicker, setSelectedTicker] = useState<TickerEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trackedSet = new Set(trackedIdentifiers.map((id) => id.toUpperCase()));

  // Reset when mode changes
  useEffect(() => {
    setQuery("");
    setSelectedTicker(null);
    setOpen(false);
    onClearError();
  }, [addType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered ticker suggestions
  const tickerSuggestions =
    addType === "ticker" || addType === "company"
      ? TICKERS_DEDUPED.filter((t) => query.length >= 1 && matchesTicker(t, query)).slice(0, 8)
      : [];

  const sectorSuggestions =
    addType === "sector" && query.length >= 1
      ? SECTORS.filter((s) => s.toLowerCase().includes(query.toLowerCase()))
      : [];

  const suggestions =
    addType === "sector"
      ? sectorSuggestions.map((s) => ({ label: s, sublabel: "Sector", value: s, displayName: undefined }))
      : tickerSuggestions.map((t) => ({
          label: t.ticker,
          sublabel: t.name,
          value: t.ticker,
          displayName: t.name,
        }));

  const hasDropdown = open && suggestions.length > 0;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectSuggestion = useCallback(
    (idx: number) => {
      const s = suggestions[idx];
      if (!s) return;
      if (addType === "ticker") {
        setSelectedTicker(tickerSuggestions[idx] ?? null);
        setQuery(`${s.label} — ${s.sublabel}`);
      } else {
        setQuery(s.value);
        setSelectedTicker(null);
      }
      setOpen(false);
      setHighlighted(0);
    },
    [suggestions, addType, tickerSuggestions],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedTicker(null);
    onClearError();
    setHighlighted(0);
    setOpen(val.length >= 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hasDropdown) {
      if (e.key === "Enter") handleSubmit();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectSuggestion(highlighted);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;

    if (addType === "ticker") {
      // Must select from list
      if (!selectedTicker) {
        // Try to find an exact ticker match as convenience
        const exact = TICKERS_DEDUPED.find(
          (t) => t.ticker.toUpperCase() === query.trim().toUpperCase(),
        );
        if (!exact) {
          onClearError();
          // surface error via parent
          await onAdd("", undefined); // triggers validation in parent
          return;
        }
        setSubmitting(true);
        await onAdd(exact.ticker, exact.name);
        setQuery("");
        setSelectedTicker(null);
        setSubmitting(false);
        return;
      }
      setSubmitting(true);
      await onAdd(selectedTicker.ticker, selectedTicker.name);
      setQuery("");
      setSelectedTicker(null);
      setSubmitting(false);
      return;
    }

    if (addType === "sector") {
      const sectorMatch = SECTORS.find(
        (s) => s.toLowerCase() === query.trim().toLowerCase(),
      );
      const value = sectorMatch ?? query.trim();
      if (!value) return;
      setSubmitting(true);
      await onAdd(value);
      setQuery("");
      setSubmitting(false);
      return;
    }

    // company — free text allowed
    const value = query.trim();
    if (!value) return;
    // Check if it's a known ticker; if so, use the display name
    const known = TICKERS_DEDUPED.find(
      (t) => t.name.toLowerCase() === value.toLowerCase(),
    );
    setSubmitting(true);
    await onAdd(value, known?.name);
    setQuery("");
    setSubmitting(false);
  };

  const placeholder =
    addType === "ticker"
      ? "Search ticker or company name..."
      : addType === "company"
        ? "e.g. Anthropic, OpenAI, Stripe..."
        : "e.g. Technology, Healthcare...";

  // Validation hint for ticker mode
  const needsSelection = addType === "ticker" && query.length > 0 && !selectedTicker;

  return (
    <div className="bg-white border border-border-base rounded-xl p-4">
      {/* Type selector */}
      <div className="flex gap-1.5 mb-2.5">
        {(["ticker", "company", "sector"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onAddTypeChange(t)}
            className={cn(
              "px-3 py-1 rounded-md font-data text-[10px] cursor-pointer transition-colors",
              addType === t
                ? "bg-gold-muted border border-gold-border text-gold font-semibold"
                : "bg-parchment-mid border border-border-base text-text-muted hover:text-text-primary",
            )}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Sector quick-select buttons (when in sector mode and no query) */}
      {addType === "sector" && query.length === 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {SECTORS.map((s) => {
            const tracked = trackedSet.has(s.toUpperCase());
            return (
              <button
                key={s}
                type="button"
                disabled={tracked}
                onClick={() => onAdd(s)}
                className={cn(
                  "px-2 py-1 rounded-md font-data text-[9px] cursor-pointer transition-colors border",
                  tracked
                    ? "opacity-40 cursor-default border-border-base text-text-faint bg-parchment-mid"
                    : "border-gold/40 bg-gold-muted text-gold hover:bg-gold/10",
                )}
              >
                {s}{tracked ? " ✓" : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* Input + add button */}
      <div ref={containerRef} className="relative">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => query.length >= 1 && setOpen(true)}
            placeholder={placeholder}
            className={cn(
              "flex-1 h-9 rounded-lg border bg-parchment-mid px-3 py-2",
              "font-sans text-[13px] text-text-primary placeholder:text-text-faint",
              "transition-colors focus:outline-none focus:ring-1",
              needsSelection
                ? "border-amber-300 focus:border-amber-400 focus:ring-amber-200"
                : "border-border-base hover:border-border-hover focus:border-gold focus:ring-gold-border",
            )}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-gold text-cream font-sans text-[11px] font-bold hover:bg-gold-dark transition-colors cursor-pointer flex-shrink-0 disabled:opacity-50"
          >
            ADD
          </button>
        </div>

        {/* Dropdown */}
        {hasDropdown && (
          <div className="absolute z-50 left-0 right-10 mt-1 bg-white border border-border-base rounded-xl shadow-lg overflow-hidden">
            {suggestions.map((s, i) => {
              const isTracked = trackedSet.has(s.value.toUpperCase());
              return (
                <button
                  key={s.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent input blur before selection
                    if (!isTracked) selectSuggestion(i);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                    i === highlighted && !isTracked ? "bg-gold-muted" : "hover:bg-parchment-mid",
                    isTracked ? "opacity-40 cursor-default" : "cursor-pointer",
                  )}
                >
                  <div className="min-w-0">
                    <span className="font-data text-[12px] font-semibold text-espresso">
                      {s.label}
                    </span>
                    {s.sublabel && s.sublabel !== s.label && (
                      <span className="font-sans text-[11px] text-text-muted ml-2 truncate">
                        {s.sublabel}
                      </span>
                    )}
                  </div>
                  {isTracked && (
                    <span className="font-data text-[9px] text-text-faint flex-shrink-0">
                      tracked
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Error / hint */}
      {addError && (
        <p className="font-sans text-[11px] text-signal-dn mt-1.5">{addError}</p>
      )}
      {needsSelection && !addError && (
        <p className="font-sans text-[11px] text-amber-600 mt-1.5">
          Select a ticker from the dropdown
        </p>
      )}
      {addType === "company" && (
        <p className="font-sans text-[10px] text-text-faint mt-1.5">
          For private companies (e.g. Anthropic), type the name and press ADD.
        </p>
      )}
    </div>
  );
}
