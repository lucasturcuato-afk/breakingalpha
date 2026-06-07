"use client";

import { Info } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  content: string;
  side?: "top" | "right" | "bottom" | "left";
  iconSize?: number;
  className?: string;
}

export function InfoTooltip({
  content,
  side = "top",
  iconSize = 12,
  className,
}: InfoTooltipProps) {
  return (
    <Tooltip content={content} side={side} wrap>
      <button
        type="button"
        className={cn(
          "inline-flex items-center justify-center cursor-help",
          "text-text-faint hover:text-text-muted transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold rounded-sm",
          className,
        )}
        aria-label="More info"
        tabIndex={0}
      >
        <Info size={iconSize} strokeWidth={1.5} />
      </button>
    </Tooltip>
  );
}
