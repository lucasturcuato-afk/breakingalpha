"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

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

interface FinnhubSuggestion {
  symbol: string;
  description: string;
}

interface ClearbitSuggestion {
  name: string;
  domain: string;
}

interface WatchlistAddInputProps {
  addType: AddType;
  onAddTypeChange: (t: AddType) => void;
  onAdd: (identifier: string, displayName?: string) => Promise<void>;
  addError: string;
  onClearError: () => void;
  trackedIdentifiers: string[];
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
  const [selectedTicker, setSelectedTicker] = useState<FinnhubSuggestion | null>(null);
  const [companyConfirmed, setCompanyConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tickerSuggestions, setTickerSuggestions] = useState<FinnhubSuggestion[]>([]);
  const [companySuggestions, setCompanySuggestions] = useState<ClearbitSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trackedSet = new Set(trackedIdentifiers.map((id) => id.toUpperCase()));

  // Reset when mode changes
  useEffect(() => {
    setQuery("");
    setSelectedTicker(null);
    setCompanyConfirmed(false);
    setTickerSuggestions([]);
    setCompanySuggestions([]);
    setSearching(false);
    setOpen(false);
    onClearError();
  }, [addType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search for ticker (Finnhub) and company (Clearbit) modes
  useEffect(() => {
    if (addType === "sector") {
      setTickerSuggestions([]);
      setCompanySuggestions([]);
      setSearching(false);
      return;
    }
    const q = query.trim();
    if (q.length < 1) {
      setTickerSuggestions([]);
      setCompanySuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        if (addType === "ticker") {
          const res = await fetch(`/api/finnhub-search?q=${encodeURIComponent(q)}`);
          if (res.ok) {
            const json = await res.json();
            setTickerSuggestions(Array.isArray(json.results) ? json.results : []);
          } else {
            setTickerSuggestions([]);
          }
        } else {
          // company mode — Clearbit autocomplete
          const res = await fetch(`/api/company-search?q=${encodeURIComponent(q)}`);
          if (res.ok) {
            const json = await res.json();
            setCompanySuggestions(Array.isArray(json.results) ? json.results : []);
          } else {
            setCompanySuggestions([]);
          }
        }
      } catch {
        setTickerSuggestions([]);
        setCompanySuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, addType]);

  // Sector suggestions (static)
  const sectorSuggestions =
    addType === "sector" && query.length >= 1
      ? SECTORS.filter((s) => s.toLowerCase().includes(query.toLowerCase()))
      : [];

  // Unified dropdown items for rendering + keyboard nav
  const dropdownItems =
    addType === "sector"
      ? sectorSuggestions.map((s) => ({ label: s, sublabel: "Sector", value: s, displayName: undefined as string | undefined }))
      : addType === "ticker"
        ? tickerSuggestions.map((s) => ({ label: s.symbol, sublabel: s.description, value: s.symbol, displayName: s.description }))
        : companySuggestions.map((c) => ({ label: c.name, sublabel: c.domain, value: c.name, displayName: c.name }));

  const showSearchingItem =
    (addType === "ticker" || addType === "company") && searching && query.trim().length >= 1;
  const showAddPrivate =
    addType === "company" && !searching && companySuggestions.length === 0 && query.trim().length >= 2;
  const hasDropdownItems = dropdownItems.length > 0;
  const hasDropdown = open && (showSearchingItem || hasDropdownItems || showAddPrivate);

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
      if (addType === "sector") {
        const item = dropdownItems[idx];
        if (!item) return;
        setQuery(item.value);
        setOpen(false);
        setHighlighted(0);
        return;
      }
      if (addType === "ticker") {
        const s = tickerSuggestions[idx];
        if (!s) return;
        setSelectedTicker(s);
        setQuery(`${s.symbol} — ${s.description}`);
        setOpen(false);
        setHighlighted(0);
        return;
      }
      // company mode
      const c = companySuggestions[idx];
      if (!c) return;
      setQuery(c.name);
      setCompanyConfirmed(true);
      setOpen(false);
      setHighlighted(0);
    },
    [dropdownItems, tickerSuggestions, companySuggestions, addType],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedTicker(null);
    setCompanyConfirmed(false);
    onClearError();
    setHighlighted(0);
    setOpen(val.length >= 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hasDropdown || !hasDropdownItems) {
      if (e.key === "Enter") handleSubmit();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, dropdownItems.length - 1));
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
      if (!selectedTicker) {
        await onAdd("", undefined); // triggers validation message in parent
        return;
      }
      setSubmitting(true);
      await onAdd(selectedTicker.symbol, selectedTicker.description);
      setQuery("");
      setSelectedTicker(null);
      setTickerSuggestions([]);
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

    // company — must be confirmed via dropdown selection or "Add as private"
    if (!companyConfirmed) return;
    const value = query.trim();
    if (!value) return;
    setSubmitting(true);
    await onAdd(value, value);
    setQuery("");
    setCompanyConfirmed(false);
    setCompanySuggestions([]);
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
    <div>
      {/* Type selector — outside the card so it reads as a tab row above the input */}
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

      <div className="bg-white border border-border-base rounded-xl p-4">
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
              disabled={
                submitting ||
                query.trim().length < 1 ||
                (addType === "ticker" && !selectedTicker) ||
                (addType === "company" && !companyConfirmed)
              }
              className="px-4 py-2 rounded-lg bg-gold text-cream font-sans text-[11px] font-bold hover:bg-gold-dark transition-colors cursor-pointer flex-shrink-0 disabled:opacity-50"
            >
              ADD
            </button>
          </div>

          {/* Dropdown */}
          {hasDropdown && (
            <div className="absolute z-50 left-0 right-10 mt-1 bg-white border border-border-base rounded-xl shadow-lg overflow-hidden">
              {showSearchingItem ? (
                <div className="px-3 py-2 font-sans text-[12px] text-text-muted">
                  Searching...
                </div>
              ) : hasDropdownItems ? (
                dropdownItems.map((s, i) => {
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
                })
              ) : showAddPrivate ? (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setCompanyConfirmed(true);
                    setOpen(false);
                    setHighlighted(0);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-parchment-mid transition-colors"
                >
                  <span className="font-sans text-[12px] text-text-muted">+</span>
                  <span className="font-sans text-[12px] text-text-muted">
                    Add &ldquo;{query.trim()}&rdquo; as private company
                  </span>
                </button>
              ) : null}
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

        {/* Company mode hint */}
        {addType === "company" && !addError && query.trim().length === 0 && (
          <p className="font-sans text-[10px] text-text-faint mt-1.5">
            For private companies (e.g. Anthropic, SpaceX), type the name and select from suggestions.
          </p>
        )}
      </div>
    </div>
  );
}
