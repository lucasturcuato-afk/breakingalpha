"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { BookmarkButton } from "@/components/ui/bookmark";
import { Star, Sparkles } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";

interface CompanyHeaderProps {
  name: string;
  ticker: string;
  sector: string;
  price?: string;
  change?: number;
  marketCap?: string;
  status?: "active" | "watching" | "archived";
  saved?: boolean;
  onBookmark?: (saved: boolean) => void;
}

export function CompanyHeader({
  name,
  ticker,
  sector,
  price,
  change,
  marketCap,
  status = "active",
  saved = false,
  onBookmark,
}: CompanyHeaderProps) {
  const [memoOpen, setMemoOpen] = useState(false);
  const isPositive = (change ?? 0) >= 0;

  return (
    <div className="px-6 py-5 border-b border-border-base bg-cream">
      {/* Top row: name + actions */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-[24px] font-extrabold text-espresso">
              {name}
            </h1>
            <span className="font-data text-[14px] font-bold text-text-muted">
              {ticker}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant="default">{sector}</Badge>
            <Badge
              variant={
                status === "active" ? "bullish" : status === "watching" ? "neutral" : "muted"
              }
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <BookmarkButton saved={saved} onToggle={onBookmark ?? (() => {})} size={16} />
          <button
            type="button"
            onClick={async () => {
              try {
                await fetch("/api/watchlist", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ identifier: name || ticker, type: ticker ? "ticker" : "company" }),
                });
              } catch (e) {
                console.error("Failed to add to watchlist:", e);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
              "bg-parchment-mid border border-border-base",
              "font-sans text-[11px] font-medium text-text-secondary",
              "hover:border-border-hover transition-colors cursor-pointer",
            )}
          >
            <Star size={11} />
            Add to Watchlist
          </button>
          <button
            type="button"
            onClick={() => setMemoOpen(true)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
              "bg-gold text-cream",
              "font-sans text-[11px] font-semibold",
              "hover:bg-gold-dark transition-colors cursor-pointer",
            )}
          >
            <Sparkles size={11} />
            Generate Memo
          </button>
        </div>
      </div>

      {/* Price row */}
      {price && (
        <div className="flex items-center gap-4 mt-3">
          <span className="font-data text-[20px] font-bold text-espresso">${price}</span>
          {change !== undefined && (
            <span
              className={cn(
                "font-data text-[13px] font-semibold",
                isPositive ? "text-signal-up" : "text-signal-dn",
              )}
            >
              {isPositive ? "+" : ""}{change.toFixed(2)}%
            </span>
          )}
          {marketCap && (
            <span className="font-sans text-[12px] text-text-muted">
              Mkt Cap: <span className="font-data font-semibold">{marketCap}</span>
            </span>
          )}
        </div>
      )}
      <MemoModal
        isOpen={memoOpen}
        onClose={() => setMemoOpen(false)}
        title={name || ticker}
        content={`Company: ${name} (${ticker})\nSector: ${sector}\n${price ? `Price: $${price}` : ""}\n${change !== undefined ? `Change: ${change.toFixed(2)}%` : ""}`}
        type="deal"
      />
    </div>
  );
}
