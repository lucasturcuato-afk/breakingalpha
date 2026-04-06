"use client";

import { cn } from "@/lib/utils";
import { Bookmark as BookmarkIcon } from "lucide-react";
import { useCallback, type MouseEvent } from "react";

interface BookmarkButtonProps {
  saved: boolean;
  onToggle: (saved: boolean) => void;
  size?: number;
  className?: string;
}

function BookmarkButton({ saved, onToggle, size = 14, className }: BookmarkButtonProps) {
  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onToggle(!saved);
    },
    [saved, onToggle],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={saved ? "Remove bookmark" : "Save for later"}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-1.5",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        "hover:bg-gold-muted",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold",
        "cursor-pointer",
        saved ? "text-gold" : "text-text-faint hover:text-gold-dark",
        className,
      )}
    >
      <BookmarkIcon
        size={size}
        className={cn(
          "transition-all duration-[var(--duration-base)]",
          saved && "fill-gold",
        )}
      />
    </button>
  );
}

export { BookmarkButton, type BookmarkButtonProps };
