"use client";

import { cn } from "@/lib/utils";

interface CiteProps {
  n: number;
  onClick?: (n: number) => void;
  sourceExists?: boolean;
  color?: string;
  className?: string;
  testId?: string;
}

export function Cite({ n, onClick, sourceExists = true, color = "var(--gold)", className, testId }: CiteProps) {
  return (
    <button
      type="button"
      onClick={() => sourceExists && onClick?.(n)}
      disabled={!sourceExists}
      data-testid={testId ?? "cite-marker"}
      data-cite-index={n}
      className={cn(
        "inline-flex items-center justify-center align-baseline mx-0.5 px-1 rounded",
        "font-data text-[10px] font-semibold leading-none border transition-colors",
        sourceExists
          ? "cursor-pointer hover:opacity-80"
          : "border-border-base bg-parchment-mid text-text-faint cursor-not-allowed line-through",
        className,
      )}
      style={sourceExists ? { color, borderColor: color, background: "transparent" } : undefined}
      title={sourceExists ? `Jump to source [${n}]` : `Source [${n}] not provided`}
    >
      [{n}]
    </button>
  );
}
