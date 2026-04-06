"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { X, Plus } from "lucide-react";

interface WatchlistStepProps {
  tickers: string[];
  onAdd: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}

const suggestions = ["AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "BRK.B", "JPM", "V"];

export function WatchlistStep({ tickers, onAdd, onRemove }: WatchlistStepProps) {
  const [input, setInput] = useState("");

  const handleAdd = useCallback(() => {
    const ticker = input.trim().toUpperCase();
    if (ticker && !tickers.includes(ticker)) {
      onAdd(ticker);
      setInput("");
    }
  }, [input, tickers, onAdd]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd],
  );

  const remainingSuggestions = suggestions.filter((s) => !tickers.includes(s));

  return (
    <div>
      <h2 className="font-display text-[22px] font-extrabold text-espresso mb-1">
        Seed your watchlist
      </h2>
      <p className="font-sans text-[13px] text-text-secondary mb-5">
        Add at least 3 tickers to start tracking. You can always add more later.
      </p>

      {/* Input */}
      <div className="flex gap-2 mb-4">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter ticker (e.g. AAPL)"
          className="font-data uppercase"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!input.trim()}
          className={cn(
            "h-9 px-3 rounded-lg bg-gold text-cream font-sans text-[12px] font-semibold",
            "hover:bg-gold-dark transition-colors cursor-pointer",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Selected tickers */}
      {tickers.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {tickers.map((t) => (
            <div
              key={t}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold-muted border border-gold-border"
            >
              <span className="font-data text-[12px] font-bold text-gold-dark">{t}</span>
              <button
                type="button"
                onClick={() => onRemove(t)}
                className="text-gold-dark hover:text-signal-dn transition-colors cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Suggestions */}
      {remainingSuggestions.length > 0 && (
        <div>
          <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint mb-2">
            Popular tickers
          </p>
          <div className="flex flex-wrap gap-1.5">
            {remainingSuggestions.map((ticker) => (
              <button
                key={ticker}
                type="button"
                onClick={() => onAdd(ticker)}
                className={cn(
                  "px-2.5 py-1 rounded-md border border-border-base bg-white",
                  "font-data text-[11px] font-semibold text-text-secondary",
                  "hover:border-border-hover hover:text-text-primary transition-colors",
                  "cursor-pointer",
                )}
              >
                + {ticker}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Progress */}
      <p className="mt-4 font-sans text-[11px] text-text-muted">
        {tickers.length}/3 tickers added
        {tickers.length >= 3 && (
          <span className="text-signal-up font-semibold"> — Ready to go!</span>
        )}
      </p>
    </div>
  );
}
