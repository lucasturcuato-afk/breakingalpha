"use client";

import { ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThumbsControlProps {
  value: "up" | "down" | null;
  onChange: (v: "up" | "down" | null) => void;
  size?: "sm" | "md";
  className?: string;
}

export function ThumbsControl({
  value,
  onChange,
  size = "sm",
  className,
}: ThumbsControlProps) {
  const iconSize = size === "sm" ? 12 : 14;
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <button
        type="button"
        aria-label="Helpful"
        aria-pressed={value === "up"}
        onClick={(e) => {
          e.stopPropagation();
          onChange(value === "up" ? null : "up");
        }}
        className={cn(
          "rounded p-1 transition-colors cursor-pointer",
          "hover:bg-parchment-mid focus:outline-none focus:ring-1 focus:ring-gold",
          value === "up" && "text-gold",
          value !== "up" && "text-text-faint",
        )}
      >
        <ThumbsUp size={iconSize} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="Not helpful"
        aria-pressed={value === "down"}
        onClick={(e) => {
          e.stopPropagation();
          onChange(value === "down" ? null : "down");
        }}
        className={cn(
          "rounded p-1 transition-colors cursor-pointer",
          "hover:bg-parchment-mid focus:outline-none focus:ring-1 focus:ring-gold",
          value === "down" && "text-gold",
          value !== "down" && "text-text-faint",
        )}
      >
        <ThumbsDown size={iconSize} strokeWidth={1.75} />
      </button>
    </div>
  );
}
